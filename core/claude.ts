// One long-lived headless `claude -p` process per open thread.
//
// We only drive the official binary: user turns go in as stream-json lines on
// stdin, every stdout line is handed back raw (the caller appends it to the
// thread's .jsonl and reduces it). If the process exits it is restarted lazily
// on the next message with --resume <session id>.

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { createTwoFilesPatch } from 'diff'
import type { Profile } from './profiles'
import { profileEnv } from './profiles'
import { relPath, type VellumRecord } from './threads'

export type RunnerTarget = {
  threadId: string
  workspace: string
  profile: Profile
  sessionId?: string
}

type Listener = {
  /** A raw stdout line and its parsed form. */
  line(raw: string, ev: any): void
  /** A record Vellum derived itself (patches, errors). */
  record(rec: VellumRecord): void
}

const live = new Set<ClaudeRunner>()

export class ClaudeRunner {
  #proc: ReturnType<typeof Bun.spawn> | undefined
  #target: RunnerTarget
  #listener: Listener
  #stderr = ''
  #sawResult = true
  #stopping = false

  constructor(target: RunnerTarget, listener: Listener) {
    this.#target = target
    this.#listener = listener
    live.add(this)
  }

  /** Session id learned from system/init; used for the next --resume. */
  set sessionId(id: string | undefined) {
    this.#target = { ...this.#target, sessionId: id }
  }

  get running() {
    return this.#proc !== undefined
  }

  send(text: string) {
    const proc = this.#ensure()
    const line = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) + '\n'
    this.#sawResult = false
    const stdin = proc.stdin as import('bun').FileSink
    stdin.write(line)
    stdin.flush()
  }

  /** Kill the current turn. The next send() resumes the same session. */
  interrupt() {
    if (!this.#proc) return
    this.#stopping = true
    this.#proc.kill()
  }

  dispose() {
    this.interrupt()
    live.delete(this)
  }

  #ensure() {
    if (this.#proc) return this.#proc
    const { workspace, profile, sessionId } = this.#target
    const argv = [
      'claude', '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose', '--include-partial-messages',
      '--permission-mode', 'acceptEdits',
      ...(sessionId ? ['--resume', sessionId] : []),
    ]
    this.#stderr = ''
    this.#stopping = false
    const proc = Bun.spawn(argv, {
      cwd: workspace,
      env: profileEnv(profile),
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    })
    this.#proc = proc
    this.#read(proc)
    this.#readStderr(proc)
    proc.exited.then((code) => {
      if (this.#proc === proc) this.#proc = undefined
      if (!this.#sawResult) {
        if (this.#stopping) this.#listener.record({ type: 'vellum/stopped' })
        else {
          const tail = this.#stderr.trim().split('\n').slice(-6).join('\n')
          this.#listener.record({ type: 'vellum/error', text: `claude exited with code ${code}${tail ? `\n${tail}` : ''}` })
        }
        this.#sawResult = true
      }
    })
    return proc
  }

  async #read(proc: ReturnType<typeof Bun.spawn>) {
    const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    let buf = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const raw = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        if (!raw.trim()) continue
        let ev: any
        try {
          ev = JSON.parse(raw)
        } catch {
          continue
        }
        this.#handle(raw, ev)
      }
    }
  }

  async #readStderr(proc: ReturnType<typeof Bun.spawn>) {
    const reader = (proc.stderr as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      this.#stderr = (this.#stderr + decoder.decode(value, { stream: true })).slice(-8000)
    }
  }

  #handle(raw: string, ev: any) {
    // Hooks and status chatter are not part of the document.
    if (ev.type === 'system' && ev.subtype !== 'init') return
    if (ev.type === 'rate_limit_event') return
    if (ev.type === 'system' && ev.subtype === 'init') this.sessionId = ev.session_id
    if (ev.type === 'result') this.#sawResult = true
    this.#listener.line(raw, ev)
    if (ev.type === 'assistant') this.#patches(ev)
  }

  /** Build real unified diffs for edit tools, against the file as it is before the tool runs. */
  #patches(ev: any) {
    for (const c of ev.message?.content ?? []) {
      if (c.type !== 'tool_use' || !['Edit', 'Write', 'MultiEdit'].includes(c.name)) continue
      const patch = filePatch(this.#target.workspace, c.name, c.input ?? {})
      if (patch) this.#listener.record({ type: 'vellum/patch', toolUseId: c.id, path: c.input.file_path, patch })
    }
  }
}

const MAX_DIFF_BYTES = 2 * 1024 * 1024

/** The real path of `file` if it lies inside the workspace, else undefined. */
function insideWorkspace(workspace: string, file: string): string | undefined {
  const abs = path.isAbsolute(file) ? file : path.join(workspace, file)
  let root: string
  let target: string
  try {
    root = realpathSync(workspace)
    // A file that does not exist yet (Write) resolves through its folder.
    target = existsSync(abs) ? realpathSync(abs) : path.join(realpathSync(path.dirname(abs)), path.basename(abs))
  } catch {
    return
  }
  const rel = path.relative(root, target)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return
  return target
}

export function filePatch(workspace: string, name: string, input: any): string | undefined {
  const file = String(input.file_path ?? '')
  if (!file) return
  // Only files inside the workspace are read for a diff; anything else falls
  // back to the snippet patch built from the tool input. Credential files are
  // never opened, wherever they are.
  const abs = insideWorkspace(workspace, file)
  if (!abs || /credentials|keychain/i.test(abs)) return
  if (existsSync(abs) && statSync(abs).size > MAX_DIFF_BYTES) return
  const before = existsSync(abs) ? readFileSync(abs, 'utf8') : ''
  let after = before
  if (name === 'Write') after = String(input.content ?? '')
  else {
    const edits = name === 'MultiEdit' ? (input.edits ?? []) : [input]
    for (const e of edits) {
      const from = String(e.old_string ?? '')
      const to = String(e.new_string ?? '')
      if (!from || !after.includes(from)) return
      after = e.replace_all ? after.split(from).join(to) : after.replace(from, to)
    }
  }
  const label = relPath(workspace, abs)
  return createTwoFilesPatch(label, label, before, after, '', '', { context: 3 })
}

/** Kill every child process on quit. */
export function killAllRunners() {
  for (const r of live) r.dispose()
}
