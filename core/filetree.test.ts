import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ancestors, createEntry, gitStatus, listDir, matchFiles, parseStatus, renameEntry } from './filetree'

const folder = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vellum-tree-'))
  for (const d of ['src', 'node_modules', '.git', 'Docs']) mkdirSync(path.join(dir, d))
  for (const f of ['b.ts', 'a10.ts', 'a2.ts', '.credentials.json', 'src/x.ts']) writeFileSync(path.join(dir, f), '')
  return dir
}

test('folders first, then files, in name order, numbers counted', () => {
  expect(listDir(folder()).map((e) => e.name)).toEqual(['Docs', 'node_modules', 'src', 'a2.ts', 'a10.ts', 'b.ts'])
})

test('.git and credentials stay out', () => {
  const names = listDir(folder()).map((e) => e.name)
  expect(names).not.toContain('.git')
  expect(names).not.toContain('.credentials.json')
})

test('a folder lists with paths from the note’s folder', () => {
  expect(listDir(folder(), 'src')).toEqual([{ name: 'x.ts', rel: 'src/x.ts', dir: false, ignored: false }])
  expect(listDir(folder(), 'missing')).toEqual([])
})

test('what git ignores is marked', () => {
  const dir = folder()
  Bun.spawnSync(['git', 'init', '-q', dir])
  writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n*.log\n')
  writeFileSync(path.join(dir, 'run.log'), '')
  const ignored = listDir(dir).filter((e) => e.ignored).map((e) => e.name)
  expect(ignored).toEqual(['node_modules', 'run.log'])
})

test('ancestors', () => {
  expect(ancestors('a/b/c.ts')).toEqual(['a', 'a/b'])
  expect(ancestors('c.ts')).toEqual([])
})

test('new files and folders stay inside the folder and never replace anything', () => {
  const dir = folder()
  expect(createEntry(dir, 'src', 'y.ts', 'file')).toEqual({ rel: 'src/y.ts' })
  expect(existsSync(path.join(dir, 'src/y.ts'))).toBe(true)
  expect(createEntry(dir, '', 'lib/deep', 'folder')).toEqual({ rel: 'lib/deep' })
  expect(createEntry(dir, 'src', 'y.ts', 'file')).toEqual({ error: 'y.ts is already there.' })
  for (const bad of ['../out.ts', 'a/../../b', '.git/x', '.credentials.json', '  '])
    expect('error' in createEntry(dir, '', bad, 'file')).toBe(true)
  const outside = mkdtempSync(path.join(tmpdir(), 'vellum-out-'))
  symlinkSync(outside, path.join(dir, 'link'))
  expect('error' in createEntry(dir, 'link', 'x.ts', 'file')).toBe(true)
  expect(existsSync(path.join(outside, 'x.ts'))).toBe(false)
})

test('search puts names that start with the query first', () => {
  const files = ['docs/button-guide.md', 'src/Button.tsx', 'src/components/IconButton.tsx', 'README.md']
  expect(matchFiles(files, 'button')).toEqual(['src/Button.tsx', 'docs/button-guide.md', 'src/components/IconButton.tsx'])
  expect(matchFiles(files, '  ')).toEqual([])
})

test('git status, as letters by path from the note’s folder', async () => {
  const out = [' M app/a.ts', 'A  app/new.ts', '?? app/scratch.md', 'R  app/b.ts', 'app/old.ts', ' D app/gone.ts', ' M other/x.ts', ''].join('\0')
  expect([...parseStatus(out, '/repo', '/repo/app')]).toEqual([['a.ts', 'M'], ['new.ts', 'A'], ['scratch.md', 'U'], ['b.ts', 'R'], ['gone.ts', 'D']])
  const dir = folder()
  expect(await gitStatus(dir)).toBeUndefined()
  Bun.spawnSync(['git', 'init', '-q', dir])
  writeFileSync(path.join(dir, 'new.ts'), '')
  expect((await gitStatus(dir))?.get('new.ts')).toBe('U')
})

test('rename keeps a thing in its folder and never replaces another', () => {
  const dir = folder()
  expect(renameEntry(dir, 'src/x.ts', 'y.ts')).toEqual({ rel: 'src/y.ts' })
  expect(existsSync(path.join(dir, 'src/y.ts'))).toBe(true)
  expect(renameEntry(dir, 'src/y.ts', '../b.ts')).toMatchObject({ error: expect.any(String) })
  expect(renameEntry(dir, 'a2.ts', 'b.ts')).toEqual({ error: 'b.ts is already there.' })
})
