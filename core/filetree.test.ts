import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ancestors, listDir } from './filetree'

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
