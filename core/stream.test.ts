import { expect, test } from 'bun:test'
import { blockStarts, chunks, HOLD_MS, naturalEnds, revealTo, safeEnd } from './stream'

const at = (md: string, needle: string) => md.indexOf(needle)

test('paragraphs, headings and fences are chunks of their own', () => {
  const md = 'First para.\n\n## Heading\nAfter it.\n\n```ts\nconst a = 1\n```\nTail'
  expect(chunks(md).map((c) => c.text.trim())).toEqual(['First para.', '## Heading', 'After it.', '```ts\nconst a = 1\n```', 'Tail'])
})

test('a list carries on across a blank line', () => {
  const md = '- one\n\n- two\n\nAfter.'
  expect(chunks(md).map((c) => c.text.trim())).toEqual(['- one\n\n- two', 'After.'])
})

test('every sentence, block and whole fence line is a natural end; a half sentence is not', () => {
  const md = 'One. Two\n\n# Head\n```\nx.y\nz\n```\nhalf a sent'
  const ends = naturalEnds(md)
  expect(ends).toContain(at(md, 'Two'))
  expect(ends).toContain(at(md, '# Head'))
  expect(ends).toContain(at(md, 'z'))
  expect(ends).toContain(at(md, 'half'))
  expect(ends).not.toContain(at(md, 'y'))
  expect(ends.at(-1)).toBe(at(md, 'half'))
})

test('a reveal stops at the latest end, holds a half sentence, then shows its whole words', () => {
  const md = 'Here it is. And then some wor'
  expect(revealTo(md, 0, 0)).toBe(at(md, 'wor'))
  expect(revealTo(md, 5, 0)).toBe(at(md, 'And'))
  expect(revealTo(md, at(md, 'And'), 0)).toBe(at(md, 'And'))
  expect(revealTo(md, at(md, 'And'), HOLD_MS)).toBe(at(md, 'wor'))
})

test('inside an open fence a reveal goes a whole line at a time', () => {
  const md = '```ts\nconst a = 1\nconst b'
  expect(revealTo(md, 0, 0)).toBe(at(md, 'const b'))
  expect(revealTo(md, at(md, 'const b'), HOLD_MS)).toBe(at(md, 'const b'))
  expect(safeEnd('Hello wor')).toBe('Hello '.length)
  expect(safeEnd('Hello world ')).toBe('Hello world '.length)
})

test('chunk starts never land inside a fence', () => {
  const md = '```md\n# not a heading\n\nnot a break\n```\n'
  expect(blockStarts(md)).toEqual([0])
})
