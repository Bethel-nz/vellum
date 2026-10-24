// The note's folder as a tree for the file pane (ui/FileTree.tsx), read one folder at a time as
// folders open. Folders come first, then files, each in name order. `.git` is left out, and so
// is anything that looks like credentials, under the same rule as previews. In a git repo, what
// git ignores is marked so the tree can dim it (node_modules, dist) without hiding it.

import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'

export type TreeEntry = { name: string; rel: string; dir: boolean; ignored: boolean }

const byName = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/** A folder's entries; `rel` is '' for the note's folder itself. Empty when it can't be read. */
export function listDir(workspace: string, rel = ''): TreeEntry[] {
  let names: string[]
  try {
    names = readdirSync(path.join(workspace, rel))
  } catch {
    return []
  }
  const entries: TreeEntry[] = []
  for (const name of names) {
    if (name === '.git' || /credentials|keychain/i.test(name)) continue
    const child = rel ? `${rel}/${name}` : name
    let dir = false
    try {
      dir = statSync(path.join(workspace, child)).isDirectory()
    } catch {
      continue
    }
    entries.push({ name, rel: child, dir, ignored: false })
  }
  const ignored = gitIgnored(workspace, entries)
  for (const e of entries) e.ignored = ignored.has(e.rel)
  return entries.sort((a, b) => (a.dir === b.dir ? byName.compare(a.name, b.name) : a.dir ? -1 : 1))
}

/** Which of these git ignores. Outside a repo, or without git, nothing is. */
function gitIgnored(workspace: string, entries: TreeEntry[]): Set<string> {
  if (!entries.length) return new Set()
  try {
    const out = Bun.spawnSync(['git', '-C', workspace, 'check-ignore', '--stdin'], {
      stdin: Buffer.from(entries.map((e) => (e.dir ? `${e.rel}/` : e.rel)).join('\n') + '\n'),
      stdout: 'pipe',
      stderr: 'ignore',
    })
    return new Set(out.stdout.toString().split('\n').filter(Boolean).map((l) => l.replace(/\/$/, '')))
  } catch {
    return new Set()
  }
}

/** The folders a file sits in, outermost first: `a/b/c.ts` → `a`, `a/b`. */
export function ancestors(rel: string): string[] {
  const parts = rel.split('/').slice(0, -1)
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'))
}
