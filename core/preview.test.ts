import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { bytesLabel, codeLanguage, hexDump, MAX_LINES, previewKind, readPreview } from './preview'

test('how each file shows', () => {
  expect(previewKind('README.md')).toBe('markdown')
  expect(previewKind('package.json')).toBe('json')
  expect(previewKind('app.tsx')).toBe('code')
  expect(previewKind('Makefile')).toBe('code')
  expect(previewKind('notes.txt')).toBe('text')
  expect(previewKind('LICENSE')).toBe('text')
})

test('a type <code> has no grammar for borrows the nearest one', () => {
  // Ones it has stay its pick.
  expect(codeLanguage('app.tsx')).toBeUndefined()
  expect(codeLanguage('Cargo.toml')).toBeUndefined()
  expect(codeLanguage('a/Makefile')).toBe('bash')
  expect(codeLanguage('Dockerfile.dev')).toBe('bash')
  expect(codeLanguage('.env.local')).toBe('bash')
  expect(codeLanguage('.gitignore')).toBe('bash')
  expect(codeLanguage('Info.plist')).toBe('html')
  expect(codeLanguage('View.swift')).toBe('typescript')
  expect(codeLanguage('Main.java')).toBe('c')
  // Nothing near: plain.
  expect(codeLanguage('schema.sql')).toBeUndefined()
})

test('reading a file, and the reasons one can’t be shown', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vellum-preview-'))
  writeFileSync(path.join(dir, 'a.ts'), 'const a = 1\nconst b = 2\n')
  writeFileSync(path.join(dir, 'big.txt'), Array.from({ length: MAX_LINES + 10 }, (_, i) => `line ${i + 1}`).join('\n'))
  writeFileSync(path.join(dir, 'bin.dat'), Buffer.from([1, 2, 0, 3]))
  mkdirSync(path.join(dir, 'sub'))
  const a = readPreview(dir, 'a.ts')
  expect(a.ok && a.kind === 'code' && a.lines === 2 && a.text === 'const a = 1\nconst b = 2').toBe(true)
  const big = readPreview(dir, 'big.txt')
  expect(big.ok && big.lines === MAX_LINES + 10 && big.shown === MAX_LINES && big.text.split('\n').length === MAX_LINES).toBe(true)
  expect(readPreview(dir, 'bin.dat')).toMatchObject({ ok: true, kind: 'binary', bytes: 4, text: '00000000  01 02 00 03                                       |....|' })
  expect(readPreview(dir, 'sub')).toMatchObject({ ok: false, reason: expect.stringContaining('folder') })
  expect(readPreview(dir, 'gone.ts')).toMatchObject({ ok: false, reason: expect.stringContaining('exist') })
  expect(readPreview(dir, '../outside.ts')).toMatchObject({ ok: false })
})

test('an image shows as itself, with its size', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vellum-preview-'))
  const png = path.resolve(import.meta.dir, '../assets/check-image.png')
  writeFileSync(path.join(dir, 'shot.png'), readFileSync(png))
  const p = readPreview(dir, 'shot.png')
  expect(p.ok && p.kind === 'image' && (p.size?.width ?? 0) > 0 && p.bytes > 0).toBe(true)
})

test('hexdump -C layout, and sizes', () => {
  expect(hexDump(Buffer.from('Hello, world!\n\0\x01ABC'))).toBe(
    '00000000  48 65 6c 6c 6f 2c 20 77  6f 72 6c 64 21 0a 00 01  |Hello, world!...|\n00000010  41 42 43                                          |ABC|',
  )
  expect(bytesLabel(512)).toBe('512 bytes')
  expect(bytesLabel(2048)).toBe('2.0 KB')
  expect(bytesLabel(245 * 1024)).toBe('245 KB')
  expect(bytesLabel(3.5 * 1024 * 1024)).toBe('3.5 MB')
})
