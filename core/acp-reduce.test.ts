// The reducer against a real ACP turn (spikes/acp-turn.ts, sanitized into fixtures/acp-turn.jsonl):
// Claude wrote hello.txt (asked first), ran `cat hello.txt`, and replied "done".
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { changeCount, collectChanges } from './changes'
import { newThread, reduce, type Block, type Thread } from './threads'
import { normalizeToolCall } from './tools'

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

test('Claude, Codex and OpenCode normalize to the same tool interface', () => {
  const shapes = [
    { _meta: { claudeCode: { toolName: 'Bash' } }, rawInput: { command: 'printf hello' }, rawOutput: 'hello' },
    { name: 'exec_command', kind: 'execute', rawInput: { command: ['printf', 'hello'] }, rawOutput: { output: 'hello', exit_code: 0 } },
    { kind: 'execute', rawInput: { command: 'printf hello' }, rawOutput: { metadata: { exit: 0 } }, content: [{ type: 'content', content: { type: 'text', text: 'hello' } }] },
  ]
  for (const shape of shapes) {
    const call = normalizeToolCall({ ...shape, toolCallId: 'call', status: 'completed' })
    expect({ id: call.id, name: call.name, command: call.input?.command, output: call.output, status: call.status }).toEqual({ id: 'call', name: 'Bash', command: 'printf hello', output: 'hello', status: 'ok' })
  }
})

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

test('OpenCode content is the result, rather than its completion metadata', () => {
  const t = replay([
    { type: 'acp/update', update: { sessionUpdate: 'tool_call', toolCallId: 'oc-shell', kind: 'execute', rawInput: { command: 'printf hello' }, status: 'pending' } },
    { type: 'acp/update', update: { sessionUpdate: 'tool_call_update', toolCallId: 'oc-shell', status: 'completed', rawOutput: { metadata: { status: 'completed', exit: 0, truncated: false } }, content: [{ type: 'content', content: { type: 'text', text: 'hello' } }] } },
  ])
  const shell = t.blocks.find((b) => b.kind === 'shell' && b.termId === 'oc-shell')
  expect(shell?.kind === 'shell' && shell.command).toBe('printf hello')
  expect(shell?.kind === 'shell' && shell.output).toBe('hello')
})

test('metadata-only completion keeps streamed shell output and the actual exit code', () => {
  const t = replay([
    { type: 'acp/update', update: { sessionUpdate: 'tool_call', toolCallId: 'oc-stream', kind: 'execute', rawInput: { command: 'failing-command' }, status: 'pending' } },
    { type: 'acp/update', update: { sessionUpdate: 'tool_call_update', toolCallId: 'oc-stream', status: 'in_progress', content: [{ type: 'content', content: { type: 'text', text: 'Something failed' } }] } },
    { type: 'acp/update', update: { sessionUpdate: 'tool_call_update', toolCallId: 'oc-stream', status: 'failed', rawOutput: { metadata: { exit: 2 } } } },
  ])
  const shell = t.blocks.find((b) => b.kind === 'shell' && b.termId === 'oc-stream')
  expect(shell?.kind === 'shell' && shell.output).toBe('Something failed')
  expect(shell?.kind === 'shell' && shell.exitCode).toBe(2)
})

test('Codex terminal deltas append and exit metadata keeps the command output', () => {
  const t = replay([
    { type: 'acp/update', update: { sessionUpdate: 'tool_call', toolCallId: 'codex-stream', kind: 'execute', rawInput: { command: ['printf', 'hello'] }, status: 'pending' } },
    { type: 'acp/update', update: { sessionUpdate: 'tool_call_update', toolCallId: 'codex-stream', _meta: { terminal_output_delta: { data: 'hel', terminal_id: 'codex-stream' } } } },
    { type: 'acp/update', update: { sessionUpdate: 'tool_call_update', toolCallId: 'codex-stream', _meta: { terminal_output_delta: { data: 'lo', terminal_id: 'codex-stream' } } } },
    { type: 'acp/update', update: { sessionUpdate: 'tool_call_update', toolCallId: 'codex-stream', status: 'completed', rawOutput: { exit_code: 0 } } },
  ])
  const shell = t.blocks.find((b) => b.kind === 'shell' && b.termId === 'codex-stream')
  expect(shell?.kind === 'shell' && shell.command).toBe('printf hello')
  expect(shell?.kind === 'shell' && shell.output).toBe('hello')
  expect(shell?.kind === 'shell' && shell.exitCode).toBe(0)
})

test('generic tools keep input and human-readable output separately', () => {
  const t = replay([
    { type: 'acp/update', update: { sessionUpdate: 'tool_call', toolCallId: 'oc-read', kind: 'read', name: 'Read', rawInput: { path: '/ws/hello.txt' }, status: 'pending' } },
    { type: 'acp/update', update: { sessionUpdate: 'tool_call_update', toolCallId: 'oc-read', status: 'completed', rawOutput: { metadata: { truncated: false } }, content: [{ type: 'content', content: { type: 'text', text: 'file contents' } }] } },
  ])
  const activity = t.blocks.find((b) => b.kind === 'activity' && b.items.some((item) => item.id === 'oc-read'))
  const call = activity?.kind === 'activity' ? activity.items.find((item) => item.id === 'oc-read') : undefined
  expect(call?.input?.file_path).toBe('/ws/hello.txt')
  expect(call?.output).toBe('file contents')
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
  expect(act.kind === 'activity' && act.thinking).toBe('……………')
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

test("git's view of a turn stands in for its edits in Changes, and names what the edits missed", () => {
  const lock = { path: 'bun.lock', patch: 'diff --git a/bun.lock b/bun.lock\n--- a/bun.lock\n+++ b/bun.lock\n@@ -1 +1,2 @@\n x\n+y', added: 1, removed: 0 }
  const hello = { path: 'hello.txt', patch: 'diff --git a/hello.txt b/hello.txt\nnew file mode 100644\n--- /dev/null\n+++ b/hello.txt\n@@ -0,0 +1 @@\n+hi', added: 1, removed: 0 }
  let t = replay([{ type: 'vellum/git-changes', files: [hello] }])
  // a second turn end in the same turn (a note sent with a "no") replaces it: the diff is cumulative
  t = reduce(t, { type: 'vellum/git-changes', files: [hello, lock] })
  const git = t.blocks.filter((b) => b.kind === 'git')
  expect(git).toHaveLength(1)
  if (git[0]!.kind !== 'git') throw new Error()
  expect(git[0]!.also).toEqual(['bun.lock'])
  const [turn] = collectChanges(t)
  expect(turn!.label).toBe('This turn')
  expect(turn!.files.map((f) => f.path)).toEqual(['hello.txt', 'bun.lock'])
  expect(changeCount(t)).toBe(2)
  // the next message starts a turn of its own; the git'd one moves to Earlier as it was
  t = reduce(t, { type: 'vellum/user', text: 'Now edit it', tags: [], at: '2026-10-23T00:00:09.000Z' })
  expect(collectChanges(t).map((g) => [g.label, g.files.map((f) => f.path)])).toEqual([['Earlier', ['hello.txt', 'bun.lock']]])
})
