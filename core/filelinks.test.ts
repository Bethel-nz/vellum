import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileRef, linkFiles, linkTarget } from './filelinks'

const ws = mkdtempSync(path.join(tmpdir(), 'vellum-filelinks-'))
mkdirSync(path.join(ws, 'ui'))
writeFileSync(path.join(ws, 'ui/theme.ts'), 'x\n')
writeFileSync(path.join(ws, 'README.md'), 'x\n')

test('inline code naming a file in the folder becomes a link to it, lines kept', () => {
  expect(linkFiles('See `ui/theme.ts` and `ui/theme.ts:4-9`.', ws)).toBe('See [`ui/theme.ts`](vellum-file:ui/theme.ts) and [`ui/theme.ts:4-9`](vellum-file:ui/theme.ts#L4-L9).')
  expect(linkFiles('`README.md`', ws)).toBe('[`README.md`](vellum-file:README.md)')
})

test('code that is not a file here stays code', () => {
  expect(linkFiles('`ui/missing.ts`, `bun test`, `ui`, `useState`', ws)).toBe('`ui/missing.ts`, `bun test`, `ui`, `useState`')
  expect(linkFiles('[`ui/theme.ts`](https://x.dev)', ws)).toBe('[`ui/theme.ts`](https://x.dev)')
  expect(fileRef(ws, '../outside.ts')).toBeUndefined()
})

test('a clicked link opens ours and plain links to files, never web links', () => {
  expect(linkTarget(ws, 'vellum-file:ui/theme.ts#L4-L9')).toEqual({ path: 'ui/theme.ts', line: 4, endLine: 9 })
  expect(linkTarget(ws, 'ui/theme.ts#L12')).toEqual({ path: 'ui/theme.ts', line: 12 })
  expect(linkTarget(ws, path.join(ws, 'README.md'))).toEqual({ path: 'README.md' })
  expect(linkTarget(ws, 'https://example.com/ui/theme.ts')).toBeUndefined()
})
