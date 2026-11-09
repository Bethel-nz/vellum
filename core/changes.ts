// The note's edits, by file and hunk, for the Changes sheet. "This turn" is every edit since your
// last paragraph; "Earlier" is the rest. A file edited several times is one row whose hunks run
// in edit order. A finished turn in a git repo has a `git` block, the turn's diff as git saw it;
// it stands in for that turn's edit blocks, so files a shell command changed are there too. Selected hunks go into your draft as ± pills (hunk tags) carrying the hunk and
// your comments on its lines; `promptFor` spells them out for Claude.

import { applyPatch, createTwoFilesPatch, parsePatch, reversePatch } from 'diff'
import { hunksOnly, type Block, type HunkNote, type Tag, type Thread } from './threads'

export type LineRef = { side: 'old' | 'new'; line: number }

export type Hunk = {
  /** `${blockId}:${index}`: stable across renders and replays. */
  id: string
  path: string
  /** The `@@ -a,b +c,d @@` line. */
  header: string
  /** Header plus body, a patch on its own. */
  patch: string
  added: number
  removed: number
}

export type FileChange = {
  path: string
  added: number
  removed: number
  status: 'running' | 'ok' | 'error'
  hunks: Hunk[]
}

export type ChangeGroup = { label: 'This turn' | 'Earlier'; files: FileChange[] }

export function splitHunks(blockId: string, path: string, patch: string): Hunk[] {
  const out: Hunk[] = []
  let cur: string[] | undefined
  const flush = () => {
    if (!cur) return
    while (cur.length > 1 && cur.at(-1) === '') cur.pop()
    let added = 0
    let removed = 0
    for (const l of cur.slice(1)) {
      if (l.startsWith('+')) added++
      else if (l.startsWith('-')) removed++
    }
    out.push({ id: `${blockId}:${out.length}`, path, header: cur[0]!, patch: cur.join('\n'), added, removed })
  }
  for (const line of hunksOnly(patch).split('\n')) {
    if (line.startsWith('@@')) {
      flush()
      cur = [line]
    } else if (cur && line !== '\\ No newline at end of file') cur.push(line)
  }
  flush()
  return out
}

type Edit = { id: string; path: string; patch: string; added: number; removed: number; status: FileChange['status'] }

function byFile(edits: Edit[]): FileChange[] {
  const files = new Map<string, FileChange>()
  for (const e of edits) {
    const f = files.get(e.path) ?? { path: e.path, added: 0, removed: 0, status: 'ok' as const, hunks: [] }
    f.added += e.added
    f.removed += e.removed
    // The latest edit decides: still running, or failed, wins over an earlier success.
    if (e.status !== 'ok') f.status = e.status
    f.hunks.push(...splitHunks(e.id, e.path, e.patch))
    files.set(e.path, f)
  }
  return [...files.values()]
}

/** Each turn's edits: its git diff when it has one, else its edit blocks. */
function turns(blocks: Block[]): Edit[][] {
  const out: Block[][] = [[]]
  for (const b of blocks) {
    if (b.kind === 'user') out.push([])
    out.at(-1)!.push(b)
  }
  return out.map((turn) => {
    const git = turn.filter((b): b is Extract<Block, { kind: 'git' }> => b.kind === 'git')
    if (git.length) return git.flatMap((g) => g.files.map((f, i) => ({ ...f, id: `${g.id}/${i}`, status: 'ok' as const })))
    return turn.filter((b): b is Extract<Block, { kind: 'edit' }> => b.kind === 'edit' && Boolean(b.patch))
  })
}

export function collectChanges(t: Thread): ChangeGroup[] {
  const all = turns(t.blocks)
  const groups: ChangeGroup[] = [
    { label: 'This turn', files: byFile(all.at(-1)!) },
    { label: 'Earlier', files: byFile(all.slice(0, -1).flat()) },
  ]
  return groups.filter((g) => g.files.length)
}

export const changeCount = (t: Thread) => new Set(turns(t.blocks).flat().map((e) => e.path)).size

export function changeSummary(t: Thread) {
  const edits = turns(t.blocks).flat()
  return { files: new Set(edits.map((edit) => edit.path)).size, added: edits.reduce((sum, edit) => sum + edit.added, 0), removed: edits.reduce((sum, edit) => sum + edit.removed, 0) }
}

/** Where a hunk starts in the new file, from `@@ -a,b +c,d @@`. */
export function hunkStart(header: string): number {
  return Number(/\+(\d+)/.exec(header)?.[1] ?? 1)
}

/** Hunk tags for the draft. The token is `±path:line`, unique within the draft. */
export function hunkTags(hunks: Hunk[], notes: Record<string, HunkNote[]> = {}, taken: Tag[] = []): Extract<Tag, { type: 'hunk' }>[] {
  const used = new Set(taken.filter((t) => t.type === 'hunk').map((t) => t.value))
  return hunks.map((h) => {
    let value = `${h.path}:${hunkStart(h.header)}`
    for (let n = 2; used.has(value); n++) value = `${h.path}:${hunkStart(h.header)}~${n}`
    used.add(value)
    const own = notes[h.id]
    return { type: 'hunk', value, path: h.path, header: h.header, patch: h.patch, added: h.added, removed: h.removed, ...(own?.length ? { notes: own } : {}) }
  })
}

/**
 * Tags for comments on hunks you didn't pick: each carries only its comments, so Claude reads
 * the file, the line and what you said, not the whole hunk. The token is `±path:line` at the first
 * comment's line.
 */
export function commentTags(hunks: Hunk[], notes: Record<string, HunkNote[]>, taken: Tag[] = []): Extract<Tag, { type: 'hunk' }>[] {
  const used = new Set(taken.filter((t) => t.type === 'hunk').map((t) => t.value))
  return hunks.flatMap((h) => {
    const own = notes[h.id]
    if (!own?.length) return []
    let value = `${h.path}:${own[0]!.line}`
    for (let n = 2; used.has(value); n++) value = `${h.path}:${own[0]!.line}~${n}`
    used.add(value)
    return [{ type: 'hunk' as const, value, path: h.path, header: h.header, patch: h.patch, added: h.added, removed: h.removed, notes: own, comments: true as const }]
  })
}

/** One row of a hunk as the diff draws it: its line numbers, its marker and its code. */
export type HunkRow = { old?: number; new?: number; kind: '+' | '-' | ' '; code: string }

export function hunkRows(patch: string): HunkRow[] {
  const [, a = '1', c = '1'] = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(patch) ?? []
  let o = Number(a)
  let n = Number(c)
  const out: HunkRow[] = []
  for (const l of patch.split('\n').slice(1)) {
    if (l === '' || l.startsWith('\\')) continue
    const kind = l[0] as HunkRow['kind']
    if (kind === '+') out.push({ new: n++, kind, code: l.slice(1) })
    else if (kind === '-') out.push({ old: o++, kind, code: l.slice(1) })
    else out.push({ old: o++, new: n++, kind: ' ', code: l.slice(1) })
  }
  return out
}

/**
 * A long hunk as patches of at most `size` rows, each with its own `@@` line, so a list can build
 * only the part in view. `from` is the chunk's first row in `hunkRows(patch)`. A hunk that fits is
 * one chunk: its own patch.
 */
export function chunkHunk(patch: string, size: number): { patch: string; from: number; rows: number }[] {
  const [head = '', ...body] = patch.split('\n')
  const lines = body.filter((l) => l !== '' && !l.startsWith('\\'))
  if (lines.length <= size) return [{ patch, from: 0, rows: lines.length }]
  const [, a = '1', c = '1'] = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(head) ?? []
  let o = Number(a)
  let n = Number(c)
  const out: { patch: string; from: number; rows: number }[] = []
  for (let from = 0; from < lines.length; from += size) {
    const part = lines.slice(from, from + size)
    const removed = part.filter((l) => l[0] !== '+').length
    const added = part.filter((l) => l[0] !== '-').length
    out.push({ patch: [`@@ -${o},${removed} +${n},${added} @@`, ...part].join('\n'), from, rows: part.length })
    o += removed
    n += added
  }
  return out
}

/** The row a line reference points at: new numbers for + and context rows, old for − rows. */
export function rowOf(rows: HunkRow[], ref: LineRef): number {
  return rows.findIndex((r) => (ref.side === 'new' ? r.new === ref.line : r.kind === '-' && r.old === ref.line))
}

export const refOf = (r: HunkRow): LineRef => (r.kind === '-' ? { side: 'old', line: r.old! } : { side: 'new', line: r.new! })

/** A note over rows a..b (either order). */
export function noteFor(rows: HunkRow[], a: number, b: number, text: string): HunkNote {
  const [from, to] = a <= b ? [a, b] : [b, a]
  const start = refOf(rows[from]!)
  const end = refOf(rows[to]!)
  const code = rows.slice(from, to + 1).map((r) => r.code).join('\n')
  return { ...start, ...(to > from ? { endSide: end.side, endLine: end.line } : {}), code, text }
}

const mark = (side: 'old' | 'new', line: number) => `${side === 'old' ? '−' : '+'}${line}`
/** "−2", or "−2 to +4" for a range. */
export function noteLabel(n: HunkNote): string {
  return n.endLine ? `${mark(n.side, n.line)} to ${mark(n.endSide ?? n.side, n.endLine)}` : mark(n.side, n.line)
}

/** Rows a note covers, for its wash over the diff. */
export function noteRows(rows: HunkRow[], n: HunkNote): [number, number] | undefined {
  const a = rowOf(rows, n)
  const b = n.endLine ? rowOf(rows, { side: n.endSide ?? n.side, line: n.endLine }) : a
  return a < 0 || b < 0 ? undefined : [Math.min(a, b), Math.max(a, b)]
}

/** The note's edits as one whole-file diff, by undoing its hunks newest first; undefined if one no longer fits. */
export function wholeFileDiff(rel: string, current: string, hunks: Hunk[]): string | undefined {
  let before = current
  for (const h of [...hunks].reverse()) {
    const [patch] = parsePatch(`--- a/${rel}\n+++ b/${rel}\n${h.patch.endsWith('\n') ? h.patch : `${h.patch}\n`}`)
    if (!patch) return undefined
    const back = applyPatch(before, reversePatch(patch))
    if (back === false) return undefined
    before = back
  }
  return fullDiff(rel, before, current)
}

/** Two versions of a file as one diff with every line in it; undefined when they're the same. */
export function fullDiff(rel: string, before: string, after: string): string | undefined {
  if (before === after) return undefined
  const whole = createTwoFilesPatch(rel, rel, before, after, '', '', { context: Number.MAX_SAFE_INTEGER })
  // The same header every other <diff> here gets, not `Index:` and a rule.
  return `--- a/${rel}\n+++ b/${rel}\n${whole.slice(whole.indexOf('@@'))}`
}
