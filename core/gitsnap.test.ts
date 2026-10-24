import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = mkdtempSync(path.join(tmpdir(), 'vellum-gitsnap-'))
process.env.VELLUM_HOME ??= path.join(root, 'vellum')
const { changedFiles, snapshot, splitFiles } = await import('./gitsnap')

const repo = path.join(root, 'repo')
const sh = (cwd: string, ...argv: string[]) => {
  const r = Bun.spawnSync(argv, { cwd, stderr: 'pipe' })
  if (r.exitCode) throw new Error(r.stderr.toString())
  return r.stdout.toString()
}

test('a turn shows tracked edits, new and deleted files, not ignored ones, and leaves git alone', async () => {
  mkdirSync(path.join(repo, 'src'), { recursive: true })
  sh(repo, 'git', 'init', '-q')
  writeFileSync(path.join(repo, '.gitignore'), 'dist/\n')
  writeFileSync(path.join(repo, 'src/a.ts'), 'one\ntwo\nthree\n')
  writeFileSync(path.join(repo, 'src/gone.ts'), 'bye\n')
  writeFileSync(path.join(repo, 'notes.md'), 'untracked before the turn\n')
  sh(repo, 'git', 'add', '.gitignore', 'src')
  sh(repo, 'git', '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base')
  const statusBefore = sh(repo, 'git', 'status', '--porcelain')

  const a = await snapshot(repo)
  expect(a).toBeDefined()
  writeFileSync(path.join(repo, 'src/a.ts'), 'one\n2\nthree\n')
  rmSync(path.join(repo, 'src/gone.ts'))
  writeFileSync(path.join(repo, 'src/new.ts'), 'fresh\n')
  writeFileSync(path.join(repo, 'notes.md'), 'untracked, then edited\n')
  mkdirSync(path.join(repo, 'dist'))
  writeFileSync(path.join(repo, 'dist/out.js'), 'built\n')
  const b = await snapshot(repo)

  const files = await changedFiles(a!, b!, repo)
  expect(files.map((f) => [f.path, f.added, f.removed]).sort()).toEqual([
    ['notes.md', 1, 1],
    ['src/a.ts', 1, 1],
    ['src/gone.ts', 0, 1],
    ['src/new.ts', 1, 0],
  ])
  expect(files.find((f) => f.path === 'src/a.ts')!.patch).toContain('@@ -1,3 +1,3 @@\n one\n-two\n+2')
  // the user's index is untouched: what was staged and untracked before still is
  writeFileSync(path.join(repo, 'src/a.ts'), 'one\ntwo\nthree\n')
  writeFileSync(path.join(repo, 'src/gone.ts'), 'bye\n')
  rmSync(path.join(repo, 'src/new.ts'))
  rmSync(path.join(repo, 'dist'), { recursive: true })
  writeFileSync(path.join(repo, 'notes.md'), 'untracked before the turn\n')
  expect(sh(repo, 'git', 'status', '--porcelain')).toBe(statusBefore)
})

test('a workspace inside a repo sees only its own folder, with paths relative to it', async () => {
  const ws = path.join(repo, 'src')
  const a = await snapshot(ws)
  writeFileSync(path.join(ws, 'a.ts'), 'one\ntwo\n3\n')
  writeFileSync(path.join(repo, 'outside.md'), 'not ours\n')
  const b = await snapshot(ws)
  expect((await changedFiles(a!, b!, ws)).map((f) => f.path)).toEqual(['a.ts'])
})

test('outside a repo there is no snapshot', async () => {
  const plain = mkdtempSync(path.join(tmpdir(), 'vellum-plain-'))
  expect(await snapshot(plain)).toBeUndefined()
})

test('a binary file and a rename keep their paths', () => {
  const diff = [
    'diff --git a/img/logo.png b/img/logo.png',
    'new file mode 100644',
    'index 0000000..1111111',
    'Binary files /dev/null and b/img/logo.png differ',
    'diff --git a/old name.ts b/new name.ts',
    'similarity index 90%',
    'rename from old name.ts',
    'rename to new name.ts',
    '--- a/old name.ts',
    '+++ b/new name.ts',
    '@@ -1 +1 @@',
    '-a',
    '+b',
    '',
  ].join('\n')
  expect(splitFiles(diff).map((f) => [f.path, f.added, f.removed])).toEqual([
    ['img/logo.png', 0, 0],
    ['new name.ts', 1, 1],
  ])
})

test("the repo's own object store is never written", async () => {
  const count = () => sh(repo, 'git', 'count-objects', '-v')
  const before = count()
  const a = await snapshot(repo)
  writeFileSync(path.join(repo, 'brand-new.txt'), 'never in .git/objects\n')
  const b = await snapshot(repo)
  expect((await changedFiles(a!, b!, repo)).map((f) => f.path)).toEqual(['brand-new.txt'])
  expect(count()).toBe(before)
  rmSync(path.join(repo, 'brand-new.txt'))
})
