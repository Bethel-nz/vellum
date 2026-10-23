// The note's edits, by file and hunk, for the Changes sheet. "This turn" is every edit since your
// last paragraph; "Earlier" is the rest. A file edited several times is one row whose hunks run
// in edit order. Selected hunks go back to Claude as a ```diff fence you can still edit.

import { hunksOnly, type Block, type Thread } from './threads'

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

function byFile(edits: Extract<Block, { kind: 'edit' }>[]): FileChange[] {
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

export function collectChanges(t: Thread): ChangeGroup[] {
  const lastUser = t.blocks.map((b) => b.kind).lastIndexOf('user')
  const edits = t.blocks.map((b, i) => [b, i] as const).filter((x): x is [Extract<Block, { kind: 'edit' }>, number] => x[0].kind === 'edit' && Boolean(x[0].patch))
  const groups: ChangeGroup[] = [
    { label: 'This turn', files: byFile(edits.filter(([, i]) => i > lastUser).map(([b]) => b)) },
    { label: 'Earlier', files: byFile(edits.filter(([, i]) => i <= lastUser).map(([b]) => b)) },
  ]
  return groups.filter((g) => g.files.length)
}

export const changeCount = (t: Thread) => new Set(t.blocks.flatMap((b) => (b.kind === 'edit' && b.patch ? [b.path] : []))).size

/** The paragraph that hands selected hunks back to Claude. */
export function keepPrompt(hunks: Hunk[]): string {
  const byPath = new Map<string, Hunk[]>()
  for (const h of hunks) byPath.set(h.path, [...(byPath.get(h.path) ?? []), h])
  const body = [...byPath.entries()].map(([p, hs]) => [`--- a/${p}`, `+++ b/${p}`, ...hs.map((h) => h.patch)].join('\n')).join('\n')
  return `Keep exactly these changes:\n\n\`\`\`diff\n${body}\n\`\`\``
}
