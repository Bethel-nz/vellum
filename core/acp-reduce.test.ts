// The reducer against a real ACP turn (spikes/acp-turn.ts, sanitized into fixtures/acp-turn.jsonl):
// Claude wrote hello.txt (asked first), ran `cat hello.txt`, and replied "done".
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { newThread, reduce, type Block, type Thread } from './threads'

const records = readFileSync(path.join(import.meta.dir, 'fixtures/acp-turn.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l))

function replay(extra: unknown[] = []): Thread {
  let t = newThread({ id: 't', title: 'Untitled', profileId: 'main', workspace: '/ws', createdAt: '2026-10-23T00:00:00.000Z' })
  t = reduce(t, { type: 'acp/session', sessionId: 's-1', agent: 'claude', profileId: 'main' })
  t = reduce(t, { type: 'vellum/user', text: 'Create hello.txt', tags: [], at: '2026-10-23T00:00:01.000Z' })
  for (const r of [...records, ...extra]) t = reduce(t, r)
  return t
}

const kinds = (bs: Block[]) => bs.map((b) => b.kind)

test('a turn becomes your paragraph, an edit, a shell run and the reply', () => {
  const t = replay()
  expect(t.claudeSessionId).toBe('s-1')
  expect(kinds(t.blocks)).toEqual(['user', 'edit', 'shell', 'assistant'])
  expect(t.running).toBe(false)
})

test('the edit names the file relative to the folder, with the real change and its status', () => {
  const edit = replay().blocks.find((b) => b.kind === 'edit')!
  if (edit.kind !== 'edit') throw new Error()
  expect(edit.path).toBe('hello.txt')
  expect(edit.status).toBe('ok')
  expect(edit.added).toBe(1)
  expect(edit.removed).toBe(0)
  expect(edit.patch).toContain('+hi')
})

test('the shell run has its command, output and exit code', () => {
  const sh = replay().blocks.find((b) => b.kind === 'shell')!
  if (sh.kind !== 'shell') throw new Error()
  expect(sh.command).toBe('cat hello.txt')
  expect(sh.output).toBe('hi')
  expect(sh.exitCode).toBe(0)
  expect(sh.source).toBe('agent')
})

test('the reply stops streaming when the turn ends, and context comes from usage', () => {
  const t = replay()
  const a = t.blocks.find((b) => b.kind === 'assistant')!
  if (a.kind !== 'assistant') throw new Error()
  expect(a.markdown).toBe('done')
  expect(a.streaming).toBe(false)
  expect(t.context?.window).toBe(1000000)
  expect(t.context?.used).toBeGreaterThan(0)
  expect(t.model).toBe('claude-haiku-5-5')
})

test('chunks of one message join; a tool call in between starts a new paragraph', () => {
  const chunk = (text: string) => ({ type: 'acp/update', update: { sessionUpdate: 'agent_message_chunk', messageId: 'm9', content: { type: 'text', text } } })
  let t = replay()
  t = reduce(t, { type: 'vellum/user', text: 'again', tags: [], at: '2026-10-23T00:00:02.000Z' })
  t = reduce(t, chunk('Look'))
  t = reduce(t, chunk('ing.'))
  t = reduce(t, { type: 'acp/update', update: { sessionUpdate: 'tool_call', toolCallId: 'r1', name: 'Read', _meta: { claudeCode: { toolName: 'Read' } }, rawInput: { file_path: '/ws/a.ts' }, status: 'pending' } })
  t = reduce(t, chunk(' Done.'))
  const replies = t.blocks.filter((b) => b.kind === 'assistant').slice(-2) as Extract<Block, { kind: 'assistant' }>[]
  expect(replies.map((b) => b.markdown)).toEqual(['Looking.', ' Done.'])
  const act = t.blocks.find((b) => b.kind === 'activity')
  expect(act?.kind === 'activity' && act.items[0]?.detail).toBe('a.ts')
})

test('a run of thought chunks counts as one thought', () => {
  const thought = { type: 'acp/update', update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '…' } } }
  let t = replay()
  t = reduce(t, { type: 'vellum/user', text: 'think', tags: [], at: '2026-10-23T00:00:02.000Z' })
  for (let i = 0; i < 5; i++) t = reduce(t, thought)
  const act = t.blocks[t.blocks.length - 1]!
  expect(act.kind === 'activity' && act.thoughts).toBe(1)
})

test('a cancelled turn marks unfinished tools as stopped', () => {
  let t = replay()
  t = reduce(t, { type: 'vellum/user', text: 'go', tags: [], at: '2026-10-23T00:00:02.000Z' })
  t = reduce(t, { type: 'acp/update', update: { sessionUpdate: 'tool_call', toolCallId: 'g1', name: 'Grep', _meta: { claudeCode: { toolName: 'Grep' } }, rawInput: { pattern: 'x' }, status: 'pending' } })
  t = reduce(t, { type: 'acp/end', stopReason: 'cancelled' })
  const act = t.blocks[t.blocks.length - 1]!
  expect(act.kind === 'activity' && act.items[0]?.status).toBe('error')
  expect(t.running).toBe(false)
})
