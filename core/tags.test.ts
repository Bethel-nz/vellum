import { expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promptFor, readSlice, tagText, tokens } from './tags'
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
