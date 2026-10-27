import { expect, test } from 'bun:test'
import { chunkHunk, commentTags, hunkRows, hunkTags, noteFor, noteLabel, splitHunks } from './changes'
import { promptFor, tagText } from './tags'

const patch = '@@ -1,3 +1,4 @@\n export function concentric(parentRadius: number, inset: number) {\n-  return parentRadius - inset\n+  // Nested rounding shares one centre.\n+  return Math.max(0, parentRadius - inset)\n }\n'

test('a hunk becomes a ± token that spells out the diff and its comments', () => {
  const [h] = splitHunks('ed1', 'ui/theme.ts', patch)
  const [tag] = hunkTags([h!], { [h!.id]: [{ side: 'old', line: 2, code: '  return parentRadius - inset', text: 'clamp it instead' }] })
  expect(tagText(tag!)).toBe('±ui/theme.ts:1')
  const prompt = promptFor(`Keep ${tagText(tag!)} but rename it`, [tag!])
  expect(prompt.startsWith('Keep hunk 1 (ui/theme.ts) but rename it')).toBe(true)
  expect(prompt).toContain('```diff\n--- a/ui/theme.ts\n+++ b/ui/theme.ts\n@@ -1,3 +1,4 @@')
  expect(prompt).toContain('- removed line 2 `return parentRadius - inset`: clamp it instead')
})

test('two hunks at the same place get distinct tokens', () => {
  const [a] = splitHunks('ed1', 'ui/theme.ts', patch)
  const [b] = splitHunks('ed2', 'ui/theme.ts', patch)
  const tags = hunkTags([a!, b!])
  expect(tags.map(tagText)).toEqual(['±ui/theme.ts:1', '±ui/theme.ts:1~2'])
})

test('a range comment names both ends and quotes every line', () => {
  const [h] = splitHunks('ed1', 'ui/theme.ts', patch)
  const rows = hunkRows(h!.patch)
  const note = noteFor(rows, 3, 0, 'this whole block')
  expect(noteLabel(note)).toBe('+1 to +3')
  expect(note.code.split('\n')).toHaveLength(4)
  const [tag] = hunkTags([h!], { [h!.id]: [note] })
  expect(promptFor(tagText(tag!), [tag!])).toContain('- lines +1 to +3\n  ```\n  export function concentric')
})

test('a comment on a hunk you did not pick goes alone: its line, its code and what you said', () => {
  const [h] = splitHunks('ed1', 'ui/theme.ts', patch)
  const [tag] = commentTags([h!], { [h!.id]: [{ side: 'new', line: 3, code: '  return Math.max(0, parentRadius - inset)', text: 'why zero?' }] })
  expect(tagText(tag!)).toBe('±ui/theme.ts:3')
  const prompt = promptFor(`Look at ${tagText(tag!)}`, [tag!])
  expect(prompt.startsWith('Look at ui/theme.ts line 3')).toBe(true)
  expect(prompt).toContain('My comments on ui/theme.ts:\n- new line 3 `return Math.max(0, parentRadius - inset)`: why zero?')
  expect(prompt).not.toContain('```diff')
  expect(commentTags([h!], {})).toEqual([])
})

test('a long hunk splits into chunks that number their lines as the whole does', () => {
  const body = [' a', '-b', '+B', ' c', '-d', '-e', '+E', ' f', '+g']
  const patch = ['@@ -10,7 +20,7 @@ fn', ...body].join('\n')
  const whole = hunkRows(patch)
  const chunks = chunkHunk(patch, 4)
  expect(chunks.map((c) => [c.from, c.rows])).toEqual([[0, 4], [4, 4], [8, 1]])
  // Each chunk's rows are the whole's rows from `from` on: same kinds, same numbers.
  expect(chunks.flatMap((c) => hunkRows(c.patch))).toEqual(whole)
  expect(chunkHunk(patch, 50)).toEqual([{ patch, from: 0, rows: 9 }])
})
