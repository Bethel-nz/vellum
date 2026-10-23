// One long-lived headless `claude -p` process per open thread.
//
// We only drive the official binary: user turns go in as stream-json lines on
// stdin, every stdout line is handed back raw (the caller appends it to the
// thread's .jsonl and reduces it). If the process exits it is restarted lazily
// on the next message with --resume <session id>.
//
// Permission asks come over the CLI's own control channel: `--permission-prompts host
// --permission-prompt-tool stdio` makes it write `control_request`s (`can_use_tool`) to
// stdout and wait for our `control_response` on stdin. The same channel switches the
// permission mode live (`set_permission_mode`) and turns thinking off
// (`set_max_thinking_tokens: 0`). Effort is a spawn flag, so changing it restarts the
// process between turns. See spikes/permission-host.ts and spikes/control-init.ts.

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { createTwoFilesPatch } from 'diff'
import { alwaysLabel, defaultMode, describe, type Ask, type PermissionMode, type Think } from './asks'
import type { Profile } from './profiles'
import { profileEnv } from './profiles'
import { relPath, type VellumRecord } from './threads'

export type RunnerTarget = {
  threadId: string
  workspace: string
  profile: Profile
  sessionId?: string
  mode?: PermissionMode
  think?: Think
}

type Listener = {
  /** A raw stdout line and its parsed form. */
  line(raw: string, ev: any): void
  /** A record Vellum derived itself (patches, errors). */
  record(rec: VellumRecord): void
  /** Claude is waiting for your OK on a tool. */
  ask(a: Ask): void
  /** An ask went away unanswered (the turn ended or the process exited). */
  askGone(requestId: string): void
  /** The CLI changed the mode itself (e.g. leaving plan mode). */
  modeChanged?(mode: PermissionMode): void
}

const live = new Set<ClaudeRunner>()

export class ClaudeRunner {
  #proc: ReturnType<typeof Bun.spawn> | undefined
  #target: RunnerTarget
  #listener: Listener
  #stderr = ''
  #sawResult = true
  #stopping = false
  #asks = new Map<string, Ask>()
  #seq = 0
  /** Respawn before the next turn (effort changed while a turn ran). */
  #stale = false

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

  get mode(): PermissionMode {
    return this.#target.mode ?? defaultMode
  }

  /** Switch the permission mode: live if the process is up, else at the next spawn. */
  setMode(mode: PermissionMode) {
    this.#target = { ...this.#target, mode }
    if (this.#proc) this.#control({ subtype: 'set_permission_mode', mode })
  }

  /** Thinking off applies live; on and max change `--effort`, so the process restarts between turns. */
  setThink(think: Think) {
    const before = this.#target.think ?? 'on'
    this.#target = { ...this.#target, think }
    if (!this.#proc || before === think) return
    const effortChanged = (before === 'max') !== (think === 'max')
    if (think === 'off') this.#control({ subtype: 'set_max_thinking_tokens', max_thinking_tokens: 0 })
    if (effortChanged || before === 'off') {
      if (this.#sawResult) this.#restart()
      else this.#stale = true
    }
  }

  /** Answer an ask. `always` adds the CLI's suggested rule; a deny can carry what to do instead. */
  answer(requestId: string, decision: { allow: true; always?: boolean } | { allow: false; message?: string }) {
    const ask = this.#asks.get(requestId)
    if (!ask || !this.#proc) return
    this.#asks.delete(requestId)
    const response = decision.allow
      ? { behavior: 'allow', updatedInput: ask.input, ...(decision.always && ask.suggestions ? { updatedPermissions: ask.suggestions } : {}) }
      : { behavior: 'deny', message: decision.message?.trim() || 'The user said no.' }
    this.#write({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } })
  }

  send(text: string) {
    if (this.#stale && this.#sawResult) this.#restart()
    const proc = this.#ensure()
    const line = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) + '\n'
    this.#sawResult = false
    const stdin = proc.stdin as import('bun').FileSink
    stdin.write(line)
    stdin.flush()
  }

  #write(o: unknown) {
    const stdin = this.#proc?.stdin as import('bun').FileSink | undefined
    if (!stdin) return
    stdin.write(JSON.stringify(o) + '\n')
    stdin.flush()
  }

  #control(request: Record<string, unknown>) {
    this.#write({ type: 'control_request', request_id: `vellum-${++this.#seq}`, request })
  }

  /** Quietly end an idle process so the next turn respawns with the new flags. */
  #restart() {
    this.#stale = false
    if (!this.#proc) return
    this.#stopping = true
    this.#proc.kill()
    this.#proc = undefined
  }

  #dropAsks() {
    for (const id of this.#asks.keys()) this.#listener.askGone(id)
    this.#asks.clear()
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
    const { workspace, profile, sessionId, mode, think } = this.#target
    const argv = [
      'claude', '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose', '--include-partial-messages',
      '--permission-mode', mode ?? defaultMode,
      '--permission-prompts', 'host', '--permission-prompt-tool', 'stdio',
      ...(think === 'max' ? ['--effort', 'max'] : []),
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
    // The host opens the control channel before the first turn, as an SDK host does.
    this.#control({ subtype: 'initialize', hooks: null })
    if (think === 'off') this.#control({ subtype: 'set_max_thinking_tokens', max_thinking_tokens: 0 })
    proc.exited.then((code) => {
      if (this.#proc === proc) this.#proc = undefined
      // Asks belong to the process that made them; a respawned one has its own.
      if (!this.#proc) this.#dropAsks()
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
    // The control channel is a conversation with the host, not part of the document.
    if (ev.type === 'control_request') return this.#onControl(ev)
    if (ev.type === 'control_cancel_request') {
      if (this.#asks.delete(ev.request_id)) this.#listener.askGone(ev.request_id)
      return
    }
    if (ev.type === 'control_response') return
    if (ev.type === 'system' && ev.subtype === 'status' && ev.permissionMode && ev.permissionMode !== this.#target.mode) {
      this.#target = { ...this.#target, mode: ev.permissionMode }
      this.#listener.modeChanged?.(ev.permissionMode)
    }
    // Hooks and status chatter are not part of the document.
    if (ev.type === 'system' && ev.subtype !== 'init') return
    if (ev.type === 'rate_limit_event') return
    if (ev.type === 'system' && ev.subtype === 'init') this.sessionId = ev.session_id
    if (ev.type === 'result') {
      this.#sawResult = true
      this.#dropAsks()
    }
    this.#listener.line(raw, ev)
    if (ev.type === 'result' && this.#stale) this.#restart()
    if (ev.type === 'assistant') this.#patches(ev)
  }

  #onControl(ev: any) {
    const req = ev.request ?? {}
    if (req.subtype !== 'can_use_tool') {
      // Nothing else is registered (no hooks, no SDK MCP servers), so nothing else is expected.
      this.#write({ type: 'control_response', response: { subtype: 'error', request_id: ev.request_id, error: `Vellum does not handle ${req.subtype}` } })
      return
    }
    const { title, detail } = describe(req.tool_name, req.input, this.#target.workspace, req.display_name)
    const suggestions = Array.isArray(req.permission_suggestions) && req.permission_suggestions.length ? req.permission_suggestions : undefined
    const ask: Ask = {
      requestId: ev.request_id,
      threadId: this.#target.threadId,
      tool: req.tool_name,
      title,
      detail,
      input: req.input ?? {},
      suggestions,
      alwaysLabel: alwaysLabel(suggestions),
      at: new Date().toISOString(),
    }
    this.#asks.set(ask.requestId, ask)
    this.#listener.ask(ask)
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

/** Text of a workspace file for tag previews and line quotes, under the same rules as diffs. */
export function readWorkspaceFile(workspace: string, file: string): string | undefined {
  const abs = insideWorkspace(workspace, file)
  if (!abs || /credentials|keychain/i.test(abs) || !existsSync(abs)) return
  try {
    if (!statSync(abs).isFile() || statSync(abs).size > MAX_DIFF_BYTES) return
    return readFileSync(abs, 'utf8')
  } catch {
    return
  }
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
