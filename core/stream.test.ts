import { expect, test } from 'bun:test'
import { blockStarts, chunks, safeEnd, settlePoints } from './stream'

const at = (md: string, needle: string) => md.indexOf(needle)

test('paragraphs, headings and fences are chunks of their own', () => {
  const md = 'First para.\n\n## Heading\nAfter it.\n\n```ts\nconst a = 1\n```\nTail'
  expect(chunks(md).map((c) => c.text.trim())).toEqual(['First para.', '## Heading', 'After it.', '```ts\nconst a = 1\n```', 'Tail'])
})

test('a list carries on across a blank line', () => {
  const md = '- one\n\n- two\n\nAfter.'
  expect(chunks(md).map((c) => c.text.trim())).toEqual(['- one\n\n- two', 'After.'])
})

test('a blank line, a heading and a closed fence settle; a half-done sentence does not', () => {
  const md = 'One.\n\n# Two\n```\nx\n```\nhalf a sent'
  const points = settlePoints(md)
  expect(points).toContain(at(md, '# Two'))
  expect(points).toContain(at(md, '```'))
  expect(points).toContain(at(md, 'half'))
  expect(points.at(-1)).toBe(at(md, 'half'))
})

test('a sentence settles once two lines have built up, not before', () => {
  expect(settlePoints('Short. And more')).toEqual([])
  const md = 'A first line\nthat wraps. Then more'
  expect(settlePoints(md)).toEqual([at(md, 'Then')])
})

test('an open fence settles every six lines, and a forced reveal stops at whole lines', () => {
  const md = '```\n1\n2\n3\n4\n5\n6\n7\n8'
  expect(settlePoints(md)).toEqual([at(md, '7')])
  expect(safeEnd(md)).toBe(at(md, '8'))
  expect(safeEnd('Hello wor')).toBe('Hello '.length)
  expect(safeEnd('Hello world ')).toBe('Hello world '.length)
})

test('chunk starts never land inside a fence', () => {
  const md = '```md\n# not a heading\n\nnot a break\n```\n'
  expect(blockStarts(md)).toEqual([0])
})
