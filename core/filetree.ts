// The note's folder as a tree for the file pane (ui/FileTree.tsx), read one folder at a time as
// folders open. Folders come first, then files, each in name order. `.git` is left out, and so
// is anything that looks like credentials, under the same rule as previews. In a git repo, what
// git ignores is marked so the tree can dim it (node_modules, dist) without hiding it.
//
// The tree's new file, new folder and rename work inside the note's folder only, never over
// something that's there, and never in `.git` or under a credentials-looking name. `gitStatus`
// is what the tree marks: git's own status of each file, as a letter.

import { existsSync, mkdirSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync, type Dirent } from 'node:fs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { insideWorkspace } from './files'
import { noFilters, SAFE } from './gitsnap'

export type TreeEntry = { name: string; rel: string; dir: boolean; ignored: boolean }

const byName = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

// Folders are listed from memory. Each listing carries a stamp: the folder's modified time
// (adding, removing or renaming anything in it moves that) and the times of every .gitignore
// that applies. A stamp that still matches costs a few stats, not a git process, so the tree
// can redraw after every edit without stalling a frame. Listing a folder also maps its
// subfolders in the background, so opening one finds it ready.
type Listing = { stamp: string; entries: TreeEntry[] }
const listings = new Map<string, Listing>()
const MAX_LISTINGS = 4000
const AHEAD = 64

/** What a folder's listing depends on, or undefined when the folder isn't there. */
function stampOf(workspace: string, rel: string): string | undefined {
  const folder = statSync(path.join(workspace, rel), { throwIfNoEntry: false })
  if (!folder?.isDirectory()) return
  const rules = [path.join(workspace, '.git', 'info', 'exclude'), path.join(workspace, '.gitignore')]
  for (const dir of rel ? [...ancestors(`${rel}/x`)] : []) rules.push(path.join(workspace, dir, '.gitignore'))
  return [folder.mtimeMs, ...rules.map((f) => statSync(f, { throwIfNoEntry: false })?.mtimeMs ?? 0)].join(':')
}

function remember(key: string, listing: Listing) {
  listings.delete(key)
  listings.set(key, listing)
  // Oldest first: a Map keeps insertion order.
  if (listings.size > MAX_LISTINGS) listings.delete(listings.keys().next().value!)
}

/** A folder's entries; `rel` is '' for the note's folder itself. Empty when it can't be read. */
export function listDir(workspace: string, rel = ''): TreeEntry[] {
  const key = path.join(workspace, rel)
  const stamp = stampOf(workspace, rel)
  if (stamp === undefined) {
    listings.delete(key)
    return []
  }
  const known = listings.get(key)
  if (known?.stamp === stamp) return known.entries
  let names: Dirent[]
  try {
    names = readdirSync(key, { withFileTypes: true })
  } catch {
    return []
  }
  const entries = entriesOf(workspace, rel, names)
  try {
    if (entries.length) markIgnored(entries, ignoredFrom(Bun.spawnSync(ignoreCommand(workspace), { stdin: ignoreInput(entries), stdout: 'pipe', stderr: 'ignore' }).stdout.toString()))
  } catch {}
  remember(key, { stamp, entries })
  void mapAhead(workspace, entries)
  return entries
}

/** Maps a note's folder and the folders in it in the background, before the tree asks. */
export function prepareTree(workspace: string): Promise<void> {
  return mapAhead(workspace, [{ name: '', rel: '', dir: true, ignored: false }], 1)
}

const mapping = new Set<string>()

/** Lists the subfolders of what was just listed, one at a time, off the frame; `deeper` more levels under each. */
async function mapAhead(workspace: string, listed: TreeEntry[], deeper = 0) {
  for (const e of listed.filter((e) => e.dir && !e.ignored).slice(0, AHEAD)) {
    const key = path.join(workspace, e.rel)
    if (mapping.has(key)) continue
    mapping.add(key)
    try {
      const stamp = stampOf(workspace, e.rel)
      if (stamp === undefined) continue
      let entries = listings.get(key)?.stamp === stamp ? listings.get(key)!.entries : undefined
      if (!entries) {
        entries = entriesOf(workspace, e.rel, await readdir(key, { withFileTypes: true }))
        if (entries.length) {
          const proc = Bun.spawn(ignoreCommand(workspace), { stdin: ignoreInput(entries), stdout: 'pipe', stderr: 'ignore' })
          markIgnored(entries, ignoredFrom(await new Response(proc.stdout).text()))
        }
        // Something changed while this was read: leave it to the next listDir.
        if (stampOf(workspace, e.rel) === stamp) remember(key, { stamp, entries })
      }
      if (deeper) await mapAhead(workspace, entries, deeper - 1)
    } catch {
    } finally {
      mapping.delete(key)
    }
  }
}

function entriesOf(workspace: string, rel: string, names: Dirent[]): TreeEntry[] {
  const entries: TreeEntry[] = []
  for (const d of names) {
    const name = d.name
    if (name === '.git' || /credentials|keychain/i.test(name)) continue
    const child = rel ? `${rel}/${name}` : name
    let dir = d.isDirectory()
    // A link counts as what it points to; one that points nowhere is left out.
    if (d.isSymbolicLink()) {
      const target = statSync(path.join(workspace, child), { throwIfNoEntry: false })
      if (!target) continue
      dir = target.isDirectory()
    }
    entries.push({ name, rel: child, dir, ignored: false })
  }
  return entries.sort((a, b) => (a.dir === b.dir ? byName.compare(a.name, b.name) : a.dir ? -1 : 1))
}

// Which entries git ignores. Outside a repo, or without git, nothing is.
const ignoreCommand = (workspace: string) => ['git', ...SAFE, '-C', workspace, 'check-ignore', '--stdin']
const ignoreInput = (entries: TreeEntry[]) => Buffer.from(entries.map((e) => (e.dir ? `${e.rel}/` : e.rel)).join('\n') + '\n')
const ignoredFrom = (out: string) => new Set(out.split('\n').filter(Boolean).map((l) => l.replace(/\/$/, '')))
function markIgnored(entries: TreeEntry[], ignored: Set<string>) {
  for (const e of entries) e.ignored = ignored.has(e.rel)
}

/** The folders a file sits in, outermost first: `a/b/c.ts` → `a`, `a/b`. */
export function ancestors(rel: string): string[] {
  const parts = rel.split('/').slice(0, -1)
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'))
}

/** Makes an empty file or a folder named `name` in `dir` (from the note's folder; '' is the folder itself). */
export function createEntry(workspace: string, dir: string, name: string, kind: 'file' | 'folder'): { rel: string } | { error: string } {
  const clean = name.trim().replace(/^\/+|\/+$/g, '')
  if (!clean) return { error: 'Give it a name.' }
  const rel = dir ? `${dir}/${clean}` : clean
  const parts = rel.split('/')
  if (path.isAbsolute(clean) || parts.some((p) => !p || p === '.' || p === '..' || p === '.git') || /credentials|keychain/i.test(rel)) return { error: 'Pick a name inside this folder.' }
  // A folder that's a link out of the note's folder doesn't count as inside it.
  if (dir && !insideWorkspace(workspace, dir)) return { error: 'Pick a name inside this folder.' }
  const abs = path.join(workspace, rel)
  if (existsSync(abs)) return { error: `${clean} is already there.` }
  try {
    if (kind === 'folder') mkdirSync(abs, { recursive: true })
    else {
      mkdirSync(path.dirname(abs), { recursive: true })
      writeFileSync(abs, '', { flag: 'wx' })
    }
  } catch {
    return { error: `Couldn’t make ${clean}.` }
  }
  return { rel }
}

/** Files whose path holds `query`, names that start with it first. */
export function matchFiles(files: string[], query: string, limit = 100): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const rank = (f: string) => {
    const name = f.slice(f.lastIndexOf('/') + 1).toLowerCase()
    return name.startsWith(q) ? 0 : name.includes(q) ? 1 : 2
  }
  return files
    .filter((f) => f.toLowerCase().includes(q))
    .sort((a, b) => rank(a) - rank(b) || a.length - b.length || byName.compare(a, b))
    .slice(0, limit)
}

/** A file's git status as one letter: Modified, Added, Untracked, Renamed, Deleted. */
export type GitMark = 'M' | 'A' | 'U' | 'R' | 'D'

/** Every changed file's status, by path from the note's folder; undefined outside a git repo. */
export async function gitStatus(workspace: string): Promise<Map<string, GitMark> | undefined> {
  const git = async (...args: string[]) => {
    // The repo's config can name programs for git to run (an fsmonitor, hooks, the filter
    // drivers `status` runs to compare a file); Vellum isn't sandboxed, so none of them run
    // (core/gitsnap.ts). Nor does it write the repo's index while it only looks.
    const proc = Bun.spawn(['git', ...SAFE, '--no-optional-locks', '-C', workspace, ...args], { stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' })
    const out = await new Response(proc.stdout).text()
    return (await proc.exited) === 0 ? out : undefined
  }
  const root = (await git('rev-parse', '--show-toplevel'))?.trim()
  // Not into submodules: each has its own config, with filters of its own.
  const out = root ? await git(...(await noFilters(root)), 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=all') : undefined
  if (!root || out === undefined) return undefined
  // git names the top by its real path; /tmp and the like are links.
  let base = workspace
  try {
    base = realpathSync(workspace)
  } catch {}
  return parseStatus(out, root, base)
}

/** `git status --porcelain -z`, whose paths are from the repo's top, as paths from the note's folder. */
export function parseStatus(out: string, root: string, workspace: string): Map<string, GitMark> {
  const marks = new Map<string, GitMark>()
  const parts = out.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]!
    if (entry.length < 4) continue
    const xy = entry.slice(0, 2)
    // A rename or copy names the old path next.
    if (xy[0] === 'R' || xy[0] === 'C') i++
    const rel = path.relative(workspace, path.join(root, entry.slice(3)))
    if (!rel || rel.startsWith('..')) continue
    const mark: GitMark = xy === '??' ? 'U' : xy[0] === 'A' ? 'A' : xy[0] === 'R' ? 'R' : xy.includes('D') ? 'D' : 'M'
    marks.set(rel.split(path.sep).join('/'), mark)
  }
  return marks
}

/** Renames a file or folder in place: the same folder, a new name. */
export function renameEntry(workspace: string, rel: string, name: string): { rel: string } | { error: string } {
  const clean = name.trim()
  if (!clean) return { error: 'Give it a name.' }
  if (clean.includes('/') || clean === '.' || clean === '..' || clean === '.git' || /credentials|keychain/i.test(clean)) return { error: 'Pick a name without a slash.' }
  if (!insideWorkspace(workspace, rel)) return { error: 'Only what’s inside this folder can be renamed.' }
  const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
  const next = dir ? `${dir}/${clean}` : clean
  if (next === rel) return { rel }
  if (existsSync(path.join(workspace, next))) return { error: `${clean} is already there.` }
  try {
    renameSync(path.join(workspace, rel), path.join(workspace, next))
  } catch {
    return { error: `Couldn’t rename it to ${clean}.` }
  }
  return { rel: next }
}
