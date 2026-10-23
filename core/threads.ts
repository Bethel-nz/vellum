// Threads: the block model, the stream-json → block reducer, and persistence.
//
// A thread is one note. Your paragraphs and Claude's replies are both editable
// text; tool work (activity, edits, terminals) sits between them as embeds.
// Edits are recorded with `seen`, the text Claude last saw, so the next turn
// can tell Claude what changed.
//
// <id>.jsonl is the source of truth: every raw `claude` stdout line, plus Vellum's
// own records (type "vellum/..."). Replaying the file through `reduce` rebuilds
// the thread exactly. <id>.md is a readable copy, rewritten on change.

import { appendFileSync, existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createTwoFilesPatch } from 'diff'
import type { Grid } from './ghostty'
import { paths } from './store'

export type Tag = { type: 'file' | 'skill' | 'folder'; value: string }

export type ToolCall = {
  id: string
  name: string
  detail: string
  status: 'running' | 'ok' | 'error'
  error?: string
}

export type Block =
  | { kind: 'user'; id: string; text: string; tags: Tag[]; at: string; seen?: string }
  | { kind: 'assistant'; id: string; markdown: string; at: string; streaming: boolean; seen?: string }
  | { kind: 'activity'; id: string; summary: string; thoughts: number; items: ToolCall[] }
  | { kind: 'edit'; id: string; path: string; patch: string; added: number; removed: number; status: 'running' | 'ok' | 'error'; error?: string }
  | {
      kind: 'shell'
      id: string
      command: string
      source: 'agent' | 'user'
      termId: string
      exitCode?: number
      /** Agent commands: the tool_result text. User commands: plain text once exited. */
      output?: string
      /** User commands: the last grid, frozen on exit. */
      grid?: Grid
    }
  | { kind: 'error'; id: string; text: string; login?: boolean }

export type ThreadMeta = {
  id: string
  title: string
  profileId: string
  workspace: string
  createdAt: string
}

export type Thread = ThreadMeta & {
  claudeSessionId?: string
  model?: string
  blocks: Block[]
  running: boolean
  updatedAt: string
  /** Reducer bookkeeping; not persisted. */
  r: {
    /** stream key "msgId:index" → assistant block id */
    streams: Record<string, string>
    /** tool_use id → block id that owns it */
    tools: Record<string, string>
    activityId?: string
    /** Next block number. Ids are deterministic so replayed edits find their block. */
    n: number
  }
}

// ---------------------------------------------------------------- records

export type VellumRecord =
  | { type: 'vellum/meta'; meta: ThreadMeta }
  | { type: 'vellum/title'; title: string }
  /** A turn. `text` is what was newly written; it may be empty when only earlier text was edited. */
  | { type: 'vellum/user'; text: string; tags: Tag[]; at: string }
  /** You changed a paragraph of yours or a reply of Claude's. */
  | { type: 'vellum/edit'; blockId: string; text: string }
  /** Claude has been told about every edit so far. */
  | { type: 'vellum/synced' }
  | { type: 'vellum/patch'; toolUseId: string; path: string; patch: string }
  | { type: 'vellum/shell'; termId: string; command: string; at: string }
  | { type: 'vellum/shell-exit'; termId: string; exitCode: number; output: string; grid: Grid }
  | { type: 'vellum/error'; text: string; login?: boolean }
  | { type: 'vellum/stopped' }

export function newThread(meta: ThreadMeta): Thread {
  return { ...meta, blocks: [], running: false, updatedAt: meta.createdAt, r: { streams: {}, tools: {}, n: 0 } }
}

// ---------------------------------------------------------------- edits

/** The text a block shows (yours or Claude's), or undefined for embeds. */
export function textOfBlock(b: Block): string | undefined {
  return b.kind === 'user' ? b.text : b.kind === 'assistant' ? b.markdown : undefined
}

/** Paragraphs edited since Claude last saw them. */
export function pendingEdits(t: Thread) {
  return t.blocks.filter(
    (b): b is Extract<Block, { kind: 'user' | 'assistant' }> =>
      (b.kind === 'user' || b.kind === 'assistant') && b.seen !== undefined,
  )
}

const quote = (text: string) => (text.trim() ? text.trim().split('\n').map((l) => `> ${l}`).join('\n') : '> (empty)')

/** A short note to Claude describing edits made to the note since its last reply. */
export function describeEdits(t: Thread): string {
  const edits = pendingEdits(t)
  if (!edits.length) return ''
  const parts = edits.map((b) => {
    const who = b.kind === 'assistant' ? 'Part of your earlier reply' : 'Something I wrote earlier'
    return `${who} was:\n${quote(b.seen!)}\n\nIt now reads:\n${quote(textOfBlock(b)!)}`
  })
  return `I edited the note since your last reply.\n\n${parts.join('\n\n')}`
}

// ---------------------------------------------------------------- reducer

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((c: any) => (c?.type === 'text' ? c.text : '')).filter(Boolean).join('\n')
  }
  return ''
}

export function countPatch(patch: string) {
  let added = 0
  let removed = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) added++
    else if (line.startsWith('-')) removed++
  }
  return { added, removed }
}

const realCache = new Map<string, string>()
function real(p: string) {
  let r = realCache.get(p)
  if (r === undefined) {
    try {
      r = realpathSync(p)
    } catch {
      r = p
    }
    realCache.set(p, r)
  }
  return r
}

/** Path relative to the workspace when it is inside it (macOS reports /var as /private/var). */
export function relPath(workspace: string, file: string) {
  if (!file) return file
  for (const base of [workspace, real(workspace)]) {
    const rel = path.relative(base, file)
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) return rel
  }
  return file
}

/** Drop the ---/+++ file header: the edit block already names the file. */
export function hunksOnly(patch: string) {
  return patch
    .split('\n')
    .filter((l) => !l.startsWith('Index: ') && !/^=+$/.test(l) && !l.startsWith('--- ') && !l.startsWith('+++ '))
    .join('\n')
}

/** Fallback patch from the tool input alone (line numbers relative to the snippet). */
export function patchFromInput(name: string, input: any): string {
  const file = String(input?.file_path ?? '')
  if (name === 'Write') return createTwoFilesPatch(file, file, '', String(input?.content ?? ''), '', '', { context: 3 })
  if (name === 'MultiEdit') {
    return (input?.edits ?? [])
      .map((e: any) => createTwoFilesPatch(file, file, String(e.old_string ?? ''), String(e.new_string ?? ''), '', '', { context: 3 }))
      .join('\n')
  }
  return createTwoFilesPatch(file, file, String(input?.old_string ?? ''), String(input?.new_string ?? ''), '', '', { context: 3 })
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

function toolDetail(workspace: string, name: string, input: any): string {
  const p = input?.file_path ?? input?.path ?? input?.notebook_path
  if (p) return relPath(workspace, String(p))
  if (input?.pattern) return String(input.pattern)
  if (input?.query) return String(input.query)
  if (input?.url) return String(input.url)
  if (input?.description) return String(input.description)
  if (input?.command) return String(input.command)
  if (input?.skill) return String(input.skill)
  return name
}

export function summarize(thoughts: number, items: ToolCall[]): string {
  const n = (k: (t: ToolCall) => boolean) => items.filter(k).length
  const parts: string[] = []
  const plural = (count: number, one: string, many: string) => (count === 1 ? one : many.replace('#', String(count)))
  if (thoughts) parts.push(plural(thoughts, 'thought once', 'thought # times'))
  const reads = n((t) => t.name === 'Read')
  const searches = n((t) => t.name === 'Grep' || t.name === 'Glob' || t.name === 'LS')
  const web = n((t) => t.name === 'WebSearch' || t.name === 'WebFetch')
  const agents = n((t) => t.name === 'Task' || t.name === 'Agent')
  const todos = n((t) => t.name === 'TodoWrite')
  const skills = n((t) => t.name === 'Skill')
  const other = items.length - reads - searches - web - agents - todos - skills
  if (reads) parts.push(plural(reads, 'read 1 file', 'read # files'))
  if (searches) parts.push(plural(searches, 'ran 1 search', 'ran # searches'))
  if (web) parts.push(plural(web, 'looked up 1 page', 'looked up # pages'))
  if (agents) parts.push(plural(agents, 'ran 1 agent', 'ran # agents'))
  if (skills) parts.push(plural(skills, 'used 1 skill', 'used # skills'))
  if (todos) parts.push('updated the plan')
  if (other) parts.push(plural(other, 'used 1 tool', 'used # tools'))
  const failed = n((t) => t.status === 'error')
  if (failed) parts.push(`${failed} failed`)
  const s = parts.join(', ')
  return s ? s[0]!.toUpperCase() + s.slice(1) : 'Working'
}

/**
 * Apply one record (raw claude event or vellum record) to a thread.
 * Returns a new Thread; unchanged blocks keep their identity so React can skip them.
 */
export function reduce(thread: Thread, ev: any): Thread {
  const t: Thread = { ...thread, blocks: thread.blocks, r: thread.r }
  let blocks = thread.blocks
  let copied = false
  const mut = () => {
    if (!copied) {
      blocks = blocks.slice()
      copied = true
    }
    return blocks
  }
  const push = (b: Block) => mut().push(b)
  const indexOf = (id: string) => blocks.findIndex((b) => b.id === id)
  const patchBlock = (id: string, f: (b: any) => any) => {
    const i = indexOf(id)
    if (i >= 0) mut()[i] = { ...f(blocks[i]) }
  }
  const r = { ...thread.r, streams: thread.r.streams, tools: thread.r.tools }
  const bid = (prefix: string) => `${prefix}-${(r.n++).toString(36)}`
  const now = new Date().toISOString()

  const activity = () => {
    if (r.activityId && indexOf(r.activityId) >= 0) return r.activityId
    const id = bid('act')
    push({ kind: 'activity', id, summary: 'Working', thoughts: 0, items: [] })
    r.activityId = id
    return id
  }
  const resummarize = (id: string) =>
    patchBlock(id, (b) => ({ ...b, summary: summarize(b.thoughts, b.items) }))

  switch (ev?.type) {
    case 'vellum/meta':
      Object.assign(t, ev.meta)
      break
    case 'vellum/title':
      t.title = ev.title
      break
    case 'vellum/user':
      if (ev.text) push({ kind: 'user', id: bid('u'), text: ev.text, tags: ev.tags ?? [], at: ev.at })
      t.running = true
      r.activityId = undefined
      t.updatedAt = ev.at
      break
    case 'vellum/edit': {
      const b = blocks[indexOf(ev.blockId)]
      if (b?.kind !== 'user' && b?.kind !== 'assistant') break
      const before = b.seen ?? textOfBlock(b)!
      const seen = ev.text === before ? undefined : before
      patchBlock(b.id, (x) => (x.kind === 'user' ? { ...x, text: ev.text, seen } : { ...x, markdown: ev.text, seen }))
      t.updatedAt = now
      break
    }
    case 'vellum/synced':
      for (const b of blocks) if ((b.kind === 'user' || b.kind === 'assistant') && b.seen !== undefined) patchBlock(b.id, (x) => ({ ...x, seen: undefined }))
      break
    case 'vellum/shell':
      push({ kind: 'shell', id: bid('sh'), command: ev.command, source: 'user', termId: ev.termId })
      r.activityId = undefined
      t.updatedAt = ev.at
      break
    case 'vellum/shell-exit': {
      const b = blocks.find((x) => x.kind === 'shell' && x.termId === ev.termId)
      if (b) patchBlock(b.id, (x) => ({ ...x, exitCode: ev.exitCode, output: ev.output, grid: ev.grid }))
      break
    }
    case 'vellum/patch': {
      const id = r.tools[ev.toolUseId]
      if (id) {
        const counts = countPatch(ev.patch)
        patchBlock(id, (b) => ({ ...b, patch: ev.patch, ...counts }))
      }
      break
    }
    case 'vellum/error':
      push({ kind: 'error', id: bid('err'), text: ev.text, login: ev.login })
      t.running = false
      break
    case 'vellum/stopped':
      t.running = false
      for (const b of blocks) if (b.kind === 'assistant' && b.streaming) patchBlock(b.id, (x) => ({ ...x, streaming: false }))
      break

    case 'system':
      if (ev.subtype === 'init') {
        t.claudeSessionId = ev.session_id
        if (ev.model) t.model = ev.model
      }
      break

    case 'stream_event': {
      if (ev.parent_tool_use_id) break
      const e = ev.event
      const key = `${ev.api_message_id ?? ''}:${e?.index}`
      if (e?.type === 'content_block_start' && e.content_block?.type === 'text') {
        const id = bid('a')
        r.streams = { ...r.streams, [key]: id }
        push({ kind: 'assistant', id, markdown: e.content_block.text ?? '', at: now, streaming: true })
        r.activityId = undefined
      } else if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
        const id = r.streams[key]
        if (id) patchBlock(id, (b) => ({ ...b, markdown: b.markdown + e.delta.text }))
      }
      break
    }

    case 'assistant': {
      if (ev.parent_tool_use_id) break
      const msgId: string = ev.message?.id ?? ''
      for (const c of ev.message?.content ?? []) {
        if (c.type === 'text') {
          // Prefer the block that streamed this text; the final event is authoritative.
          const streamed = Object.entries(r.streams)
            .filter(([k]) => k.startsWith(msgId + ':'))
            .map(([, id]) => blocks[indexOf(id)])
            .find((b): b is Extract<Block, { kind: 'assistant' }> => b?.kind === 'assistant' && b.streaming && c.text.startsWith(b.markdown))
          if (streamed) patchBlock(streamed.id, (b) => ({ ...b, markdown: c.text, streaming: false }))
          else if (c.text.trim()) {
            push({ kind: 'assistant', id: bid('a'), markdown: c.text, at: now, streaming: false })
            r.activityId = undefined
          }
        } else if (c.type === 'thinking' || c.type === 'redacted_thinking') {
          const id = activity()
          patchBlock(id, (b) => ({ ...b, thoughts: b.thoughts + 1 }))
          resummarize(id)
        } else if (c.type === 'tool_use') {
          const name: string = c.name
          const input = c.input ?? {}
          if (EDIT_TOOLS.has(name)) {
            const file = String(input.file_path ?? input.notebook_path ?? '')
            const patch = patchFromInput(name, input)
            const id = bid('ed')
            push({ kind: 'edit', id, path: relPath(t.workspace, file), patch, ...countPatch(patch), status: 'running' })
            r.tools = { ...r.tools, [c.id]: id }
            r.activityId = undefined
          } else if (name === 'Bash') {
            const id = bid('sh')
            push({ kind: 'shell', id, command: String(input.command ?? ''), source: 'agent', termId: c.id })
            r.tools = { ...r.tools, [c.id]: id }
            r.activityId = undefined
          } else {
            const id = activity()
            const call: ToolCall = { id: c.id, name, detail: toolDetail(t.workspace, name, input), status: 'running' }
            patchBlock(id, (b) => ({ ...b, items: [...b.items, call] }))
            resummarize(id)
            r.tools = { ...r.tools, [c.id]: id }
          }
        }
      }
      break
    }

    case 'user': {
      if (ev.parent_tool_use_id) break
      const content = ev.message?.content
      if (!Array.isArray(content)) break
      for (const c of content) {
        if (c?.type !== 'tool_result') continue
        const id = r.tools[c.tool_use_id]
        const i = id ? indexOf(id) : -1
        if (i < 0) continue
        const b = blocks[i]!
        const text = textOf(c.content)
        const failed = Boolean(c.is_error)
        if (b.kind === 'shell') {
          patchBlock(b.id, (x) => ({ ...x, output: text, exitCode: failed ? 1 : 0 }))
        } else if (b.kind === 'edit') {
          patchBlock(b.id, (x) => ({ ...x, status: failed ? 'error' : 'ok', error: failed ? text : undefined }))
        } else if (b.kind === 'activity') {
          patchBlock(b.id, (x) => ({
            ...x,
            items: x.items.map((it: ToolCall) =>
              it.id === c.tool_use_id ? { ...it, status: failed ? 'error' : 'ok', error: failed ? text.slice(0, 400) : undefined } : it,
            ),
          }))
          resummarize(b.id)
        }
      }
      break
    }

    case 'result': {
      t.running = false
      for (const b of blocks) if (b.kind === 'assistant' && b.streaming) patchBlock(b.id, (x) => ({ ...x, streaming: false }))
      const failed = ev.is_error || (ev.subtype && ev.subtype !== 'success')
      if (failed) {
        const text = String(ev.result ?? ev.subtype ?? 'The turn failed')
        push({ kind: 'error', id: bid('err'), text, login: /not logged in|\/login/i.test(text) })
      }
      t.updatedAt = now
      break
    }
  }

  t.blocks = blocks
  t.r = r
  return t
}

// ---------------------------------------------------------------- persistence

const jsonlPath = (id: string) => path.join(paths.threads, `${id}.jsonl`)
const mdPath = (id: string) => path.join(paths.threads, `${id}.md`)

export function appendLine(id: string, line: string) {
  appendFileSync(jsonlPath(id), line.endsWith('\n') ? line : line + '\n')
}

export function appendRecord(id: string, rec: VellumRecord) {
  appendLine(id, JSON.stringify(rec))
}

export function loadThreads(): Thread[] {
  if (!existsSync(paths.threads)) return []
  const out: Thread[] = []
  for (const file of readdirSync(paths.threads)) {
    if (!file.endsWith('.jsonl')) continue
    const lines = readFileSync(path.join(paths.threads, file), 'utf8').split('\n')
    let thread: Thread | undefined
    for (const line of lines) {
      if (!line.trim()) continue
      let ev: any
      try {
        ev = JSON.parse(line)
      } catch {
        continue
      }
      if (!thread) {
        if (ev.type !== 'vellum/meta') break
        thread = newThread(ev.meta)
      }
      thread = reduce(thread, ev)
    }
    if (thread) {
      // A process that died mid-turn left no result; the thread is idle now.
      if (thread.running) thread = reduce(thread, { type: 'vellum/stopped' })
      out.push(thread)
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

function yaml(v: unknown) {
  return JSON.stringify(v ?? '')
}

export function toMarkdown(t: Thread): string {
  const out: string[] = [
    '---',
    `id: ${t.id}`,
    `title: ${yaml(t.title)}`,
    `profile: ${t.profileId}`,
    `workspace: ${yaml(t.workspace)}`,
    `session: ${t.claudeSessionId ?? ''}`,
    `created: ${t.createdAt}`,
    '---',
    '',
    `# ${t.title}`,
    '',
  ]
  for (const b of t.blocks) {
    switch (b.kind) {
      case 'user':
        out.push(b.text, '')
        break
      case 'assistant':
        out.push(b.markdown, '')
        break
      case 'activity':
        out.push(`*${b.summary}*`, '')
        break
      case 'edit':
        out.push(`Edit \`${b.path}\` +${b.added} −${b.removed}`, '', '```diff', b.patch.trimEnd(), '```', '')
        break
      case 'shell':
        out.push('```console', `$ ${b.command}`, (b.output ?? '').trimEnd(), b.exitCode !== undefined ? `# exit ${b.exitCode}` : '', '```', '')
        break
      case 'error':
        out.push(`> **Error:** ${b.text}`, '')
        break
    }
  }
  return out.join('\n')
}

export function writeMarkdown(t: Thread) {
  writeFileSync(mdPath(t.id), toMarkdown(t))
}

export function titleFrom(text: string) {
  const line = text.trim().split('\n')[0] ?? ''
  return line.length > 60 ? line.slice(0, 57) + '…' : line || 'Untitled'
}

export function newThreadId() {
  const d = new Date()
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  return `${stamp}-${Math.random().toString(36).slice(2, 8)}`
}
