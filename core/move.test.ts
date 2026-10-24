// Moving a note to another account: the account changes, the old session is let go, the note
// shows where it moved, and only the next turn carries the note so far.
import { expect, test } from 'bun:test'
import { handoffContext, newThread, reduce, type Thread } from './threads'

function note(): Thread {
  let t = newThread({ id: 't', title: 'Drafts', profileId: 'main', workspace: '/ws', createdAt: '2026-10-24T00:00:00.000Z' })
  t = reduce(t, { type: 'acp/session', sessionId: 's-1', agent: 'claude', profileId: 'main' })
  t = reduce(t, { type: 'vellum/user', text: 'Sketch the data model for drafts.', tags: [], at: '2026-10-24T00:00:01.000Z' })
  t = reduce(t, { type: 'acp/update', update: { sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: 'A draft is text, tags and images.' } } })
  t = reduce(t, { type: 'acp/end', stopReason: 'end_turn' })
  return t
}
const move = (t: Thread) => reduce(t, { type: 'vellum/profile', profileId: 'work', from: 'Default', to: 'Work', at: '2026-10-24T00:01:00.000Z' })

test('the note moves: new account, no session, a line saying so', () => {
  const t = move(note())
  expect(t.profileId).toBe('work')
  expect(t.claudeSessionId).toBeUndefined()
  expect(t.handoff).toBe(true)
  expect(t.blocks.at(-1)).toMatchObject({ kind: 'moved', from: 'Default', to: 'Work' })
})

test('moving to the account it is on does nothing', () => {
  const t = note()
  const same = reduce(t, { type: 'vellum/profile', profileId: 'main', from: 'Default', to: 'Default', at: '2026-10-24T00:01:00.000Z' })
  expect(same.blocks.length).toBe(t.blocks.length)
  expect(same.claudeSessionId).toBe('s-1')
})

test('the handoff carries your paragraphs and the replies, not the note header', () => {
  const ctx = handoffContext(move(note()))
  expect(ctx).toContain('Sketch the data model for drafts.')
  expect(ctx).toContain('A draft is text, tags and images.')
  expect(ctx).toContain('Moved from Default to Work.')
  expect(ctx).not.toContain('session: s-1')
})

test('only the first turn after the move carries it', () => {
  let t = move(note())
  t = reduce(t, { type: 'vellum/user', text: 'Carry on.', tags: [], at: '2026-10-24T00:02:00.000Z' })
  expect(t.handoff).toBeUndefined()
})

test('a long note keeps its latest part', () => {
  let t = move(note())
  t = reduce(t, { type: 'vellum/user', text: 'x'.repeat(500), tags: [], at: '2026-10-24T00:02:00.000Z' })
  const ctx = handoffContext(t, 200)
  expect(ctx).toContain('The start of the note is left out')
  expect(ctx).not.toContain('Sketch the data model')
})
