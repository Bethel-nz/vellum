import { expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileLabel, promptFor, readSlice, relabel, tagText, tokens } from './tags'
import type { Tag } from './threads'

const dir = mkdtempSync(path.join(tmpdir(), 'vellum-tags-'))
writeFileSync(path.join(dir, 'a.ts'), ['one', 'two', 'three', 'four', 'five'].join('\n'))

test('a range reads, writes and parses as #path:12-18', () => {
  const range: Tag = { type: 'file', value: 'a.ts', line: 2, endLine: 4 }
  expect(tagText(range)).toBe('#a.ts:2-4')
  expect(tagText({ type: 'file', value: 'a.ts', line: 2 })).toBe('#a.ts:2')
  const found = tokens('look at #a.ts:2-4, then #a.ts:5', [range, { type: 'file', value: 'a.ts', line: 5 }])
  expect(found.filter((t) => t.kind === 'tag').map((t) => t.kind === 'tag' && t.tag)).toEqual([range, { type: 'file', value: 'a.ts', line: 5 }])
  // A backwards range is just its first line.
  expect(tokens('#a.ts:4-2', [range]).find((t) => t.kind === 'tag')).toMatchObject({ tag: { line: 4 } })
  expect(readSlice(dir, 'a.ts', 2, 4)).toEqual({ start: 2, lines: ['two', 'three', 'four'] })
  expect(readSlice(dir, 'a.ts', 4, 99)).toEqual({ start: 4, lines: ['four', 'five'] })
})

test('Claude gets the range quoted, numbered', () => {
  const prompt = promptFor('why #a.ts:2-4', [{ type: 'file', value: 'a.ts', line: 2, endLine: 4 }], { workspace: dir })
  expect(prompt).toContain('why a.ts:2-4')
  expect(prompt).toContain('Refer only to lines 2–4 of a.ts')
  expect(prompt).toContain('2 | two\n3 | three\n4 | four')
})

test('a file is written as the shortest end of its path that tells it apart', () => {
  expect(fileLabel('core/printed.ts', ['core/printed.ts'])).toBe('printed.ts')
  expect(fileLabel('core/printed.ts', ['core/printed.ts', 'ui/printed.ts'])).toBe('core/printed.ts')
  expect(fileLabel('a/b/c.ts', ['a/b/c.ts', 'x/c.ts'])).toBe('b/c.ts')
  // A file that is the end of another's path has nothing shorter.
  expect(fileLabel('c.ts', ['c.ts', 'x/c.ts'])).toBe('c.ts')
  expect(fileLabel('x/c.ts', ['c.ts', 'x/c.ts'])).toBe('x/c.ts')
})

test('a short name finds its tag, and Claude still gets the whole path', () => {
  const tag: Tag = { type: 'file', value: 'core/printed.ts' }
  expect(tokens('see #printed.ts:20-24 and #core/printed.ts', [tag]).filter((t) => t.kind === 'tag').map((t) => t.kind === 'tag' && t.tag)).toEqual([
    { type: 'file', value: 'core/printed.ts', line: 20, endLine: 24 },
    { type: 'file', value: 'core/printed.ts' },
  ])
  // A short name only matches whole path segments.
  expect(tokens('#ts', [tag]).some((t) => t.kind === 'tag')).toBe(false)
  expect(promptFor('why #printed.ts', [tag])).toBe('why @core/printed.ts')
})

test('relabel writes the shortest names, and lengthens both when two files share one', () => {
  const a: Tag = { type: 'file', value: 'core/printed.ts' }
  const b: Tag = { type: 'file', value: 'ui/printed.ts' }
  expect(relabel('see #core/printed.ts:3 now', [a])).toBe('see #printed.ts:3 now')
  expect(relabel('see #printed.ts:3 and #ui/printed.ts', [a, b])).toBe('see #core/printed.ts:3 and #ui/printed.ts')
  expect(relabel('plain text, #1 and an@email.com', [a])).toBe('plain text, #1 and an@email.com')
})
