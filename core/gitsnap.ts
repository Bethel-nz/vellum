// What a turn changed on disk, from git rather than from the agent's tool calls, so a file a
// shell command wrote (a codegen, a `sed`, a formatter) shows up in Changes too.
//
// A snapshot is a git tree of the working tree, tracked and untracked files alike (.gitignore
// respected). It is written through a shadow index and into Vellum's own object store, with the
// repo's objects as an alternate: the repo's index, stash, branches and .git/objects are never
// written. Both live in ~/.vellum/git, one pair per repo, and are kept between turns, so git's
// stat cache makes every snapshot after the first rehash only the files that changed. The first
// one in a repo with a big untracked folder can take a while; the turn doesn't wait for it
// (core/agent.ts) and falls back to the tool calls' own diffs, as outside a repo.
//
// Vellum isn't sandboxed and the agent may have written .git/config during the turn, so a
// snapshot never runs a command the repo's config names: no fsmonitor, no hooks, and every
// filter driver's clean/smudge/process is blanked (files are hashed as they are on disk).

import { mkdirSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { paths } from './store'

/** `config` is the `-c` overrides that keep the repo's filter drivers from running (see `noFilters`). */
export type Snapshot = { root: string; prefix: string; tree: string; env: Record<string, string>; config: string[] }

/** One file in a turn's diff. `path` is relative to the note's workspace. */
export type GitFile = { path: string; patch: string; added: number; removed: number }

/** Long enough for a first snapshot to finish warming the shadow index, even if its turn gave up on it. */
const ADD_LIMIT_MS = 60_000
const LIMIT_MS = 5000
/** A file whose diff is bigger than this is listed with its counts but no hunks. */
const MAX_PATCH = 200_000

/** Config the repo can't override: nothing it names gets run. */
export const SAFE = ['-c', 'core.quotePath=false', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null']

async function git(cwd: string, args: string[], env?: Record<string, string>, limit = LIMIT_MS) {
  const proc = Bun.spawn(['git', ...SAFE, ...args], { cwd, env: { ...process.env, ...env }, stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' })
  let killed = false
  const timer = setTimeout(() => {
    killed = true
    proc.kill()
  }, limit)
  const out = await new Response(proc.stdout).text()
  clearTimeout(timer)
  return { out: (await proc.exited) === 0 ? out : undefined, killed }
}

/** The working tree under `cwd` as a git tree, or undefined outside a repo (or when git fails). */
export async function snapshot(cwd: string): Promise<Snapshot | undefined> {
  const where = (await git(cwd, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-path', 'objects', '--show-prefix'])).out
  if (!where) return
  const [root = '', objects = '', prefix = ''] = where.split('\n')
  const store = path.join(paths.home, 'git', new Bun.CryptoHasher('sha1').update(root).digest('hex').slice(0, 16))
  mkdirSync(path.join(store, 'objects'), { recursive: true })
  const env = { GIT_INDEX_FILE: path.join(store, 'index'), GIT_OBJECT_DIRECTORY: path.join(store, 'objects'), GIT_ALTERNATE_OBJECT_DIRECTORIES: objects }
  // Not only `add`: `write-tree` runs a clean filter too (core/gitsnap.test.ts), so every call gets them.
  const config = await noFilters(root)
  const add = await git(root, [...config, 'add', '-A', '--', prefix || '.'], env, ADD_LIMIT_MS)
  // A killed `git add` leaves its lock behind, and every later snapshot would fail on it.
  if (add.killed) await Bun.file(env.GIT_INDEX_FILE + '.lock').delete().catch(() => {})
  if (add.out === undefined) return
  const tree = (await git(root, [...config, 'write-tree'], env)).out?.trim()
  return tree ? { root, prefix, tree, env, config } : undefined
}

/** `-c` overrides that blank every filter driver the repo's config defines (a .gitattributes names them). */
export async function noFilters(root: string): Promise<string[]> {
  const keys = (await git(root, ['config', '--name-only', '--get-regexp', '^filter\\.'])).out ?? ''
  const drivers = new Set(keys.split('\n').filter(Boolean).map((k) => k.slice('filter.'.length, k.lastIndexOf('.'))))
  return [...drivers].flatMap((d) => ['clean', 'smudge', 'process'].flatMap((k) => ['-c', `filter.${d}.${k}=`]).concat('-c', `filter.${d}.required=false`))
}

/** The files that differ between two snapshots of the same workspace. */
export async function changedFiles(a: Snapshot, b: Snapshot, workspace: string): Promise<GitFile[]> {
  if (a.tree === b.tree) return []
  const patch = (await git(a.root, [...b.config, 'diff-tree', '-p', '-M', '--no-color', '--no-ext-diff', '-r', a.tree, b.tree, '--', a.prefix || '.'], a.env)).out
  if (!patch) return []
  // git names the real path (macOS: /private/var for /var), so the workspace has to be too.
  const ws = realpathSync(workspace)
  return splitFiles(patch).map((f) => ({ ...f, path: path.relative(ws, path.join(a.root, f.path)).split(path.sep).join('/') || f.path }))
}

/** Current staged, unstaged and untracked changes against HEAD, using the same private index. */
export async function uncommittedFiles(workspace: string): Promise<GitFile[] | undefined> {
  const current = await snapshot(workspace)
  if (!current) return
  const head = (await git(current.root, ['rev-parse', '--verify', 'HEAD^{tree}'], current.env)).out?.trim()
  const tree = head || (await git(current.root, [...current.config, 'mktree'], current.env)).out?.trim()
  return tree ? changedFiles({ ...current, tree }, current, workspace) : undefined
}

/** The file as last committed: '' if git hasn't committed it, undefined if ignored or outside a repo. */
export async function committedText(workspace: string, rel: string): Promise<string | undefined> {
  const at = `./${rel}`
  const blob = (await git(workspace, ['--no-optional-locks', 'cat-file', 'blob', `HEAD:${at}`])).out
  if (blob !== undefined) return blob
  const listed = (await git(workspace, ['--no-optional-locks', 'ls-files', '--cached', '--others', '--exclude-standard', '--', at])).out
  return listed?.trim() ? '' : undefined
}

/** A multi-file `git diff` cut into files, each with its own patch and counts. */
export function splitFiles(patch: string): GitFile[] {
  const out: GitFile[] = []
  for (const chunk of patch.split(/^(?=diff --git )/m)) {
    if (!chunk.startsWith('diff --git ')) continue
    const lines = chunk.replace(/\n$/, '').split('\n')
    const file = pathOf(lines)
    if (!file) continue
    let added = 0
    let removed = 0
    let body = false
    for (const l of lines) {
      if (l.startsWith('@@')) body = true
      else if (body && l.startsWith('+')) added++
      else if (body && l.startsWith('-')) removed++
    }
    const text = lines.join('\n')
    out.push({ path: file, patch: text.length > MAX_PATCH ? lines.filter((l) => !body || !/^[+\- ]/.test(l)).slice(0, 4).join('\n') : text, added, removed })
  }
  return out
}

function pathOf(lines: string[]): string | undefined {
  const to = lines.find((l) => l.startsWith('+++ '))?.slice(4)
  if (to && to !== '/dev/null') return to.replace(/^b\//, '')
  const from = lines.find((l) => l.startsWith('--- '))?.slice(4)
  if (from && from !== '/dev/null') return from.replace(/^a\//, '')
  const renamed = lines.find((l) => l.startsWith('rename to '))?.slice('rename to '.length)
  if (renamed) return renamed
  // A binary file or a mode change has no ---/+++ lines: `diff --git a/P b/P`, both halves alike.
  const rest = lines[0]!.slice('diff --git '.length)
  const half = (rest.length - 1) / 2
  return Number.isInteger(half) ? rest.slice(half + 1).replace(/^b\//, '') : undefined
}
