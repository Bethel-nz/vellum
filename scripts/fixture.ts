// Writes a demo thread into $VELLUM_HOME so the UI can be checked without spending a turn.
// Event shapes follow what `claude -p --output-format stream-json` emitted in spike 2.
//
//   VELLUM_HOME=/tmp/vellum-demo bun scripts/fixture.ts

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createTwoFilesPatch } from 'diff'

const home = process.env.VELLUM_HOME
if (!home) throw new Error('set VELLUM_HOME to a scratch folder')
const workspace = path.resolve(import.meta.dir, '..')
mkdirSync(path.join(home, 'threads'), { recursive: true })
writeFileSync(
  path.join(home, 'profiles.json'),
  JSON.stringify([
    { id: 'main', name: 'Default', color: '#1447e6', configDir: null, workspaces: [workspace], loggedIn: true },
    { id: 'work', name: 'Work', color: '#c2453a', configDir: path.join(home, 'profiles/work/claude'), workspaces: [] },
  ]),
)

const id = '20261023-demo01'
const at = '2026-10-23T14:21:00.000Z'
const msg = 'msg_demo_1'
const before = `export function concentric(parentRadius: number, inset: number) {\n  return parentRadius - inset\n}\n`
const after = `export function concentric(parentRadius: number, inset: number) {\n  // Nested rounding shares one centre.\n  return Math.max(0, parentRadius - inset)\n}\n`
const lines: unknown[] = [
  { type: 'vellum/meta', meta: { id, title: 'Tighten the concentric radius helper', profileId: 'main', workspace, createdAt: at } },
  { type: 'vellum/user', text: 'Clamp concentric() at zero and run the tests.\nKeep it small.', tags: [{ type: 'file', value: 'ui/theme.ts' }], at },
  { type: 'system', subtype: 'init', session_id: 'demo-session', model: 'claude-opus-5-5' },
  { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, api_message_id: msg },
  { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: "I'll look at the helper first." } }, api_message_id: msg },
  {
    type: 'assistant',
    message: {
      id: msg,
      content: [
        { type: 'text', text: "I'll look at the helper first." },
        { type: 'thinking', thinking: '...' },
        { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: path.join(workspace, 'ui/theme.ts') } },
        { type: 'tool_use', id: 't2', name: 'Grep', input: { pattern: 'concentric\\(' } },
        { type: 'thinking', thinking: '...' },
        { type: 'tool_use', id: 't3', name: 'Read', input: { file_path: path.join(workspace, 'app.tsx') } },
      ],
    },
  },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }, { type: 'tool_result', tool_use_id: 't2', content: 'ok' }, { type: 'tool_result', tool_use_id: 't3', content: 'ok' }] } },
  { type: 'assistant', message: { id: 'msg_demo_2', content: [{ type: 'tool_use', id: 't4', name: 'Edit', input: { file_path: path.join(workspace, 'ui/theme.ts'), old_string: 'return parentRadius - inset', new_string: '// Nested rounding shares one centre.\n  return Math.max(0, parentRadius - inset)' } }] } },
  { type: 'vellum/patch', toolUseId: 't4', path: 'ui/theme.ts', patch: createTwoFilesPatch('ui/theme.ts', 'ui/theme.ts', before, after, '', '', { context: 3 }) },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't4', content: 'The file has been updated.' }] } },
  { type: 'assistant', message: { id: 'msg_demo_3', content: [{ type: 'tool_use', id: 't5', name: 'Bash', input: { command: 'bun test ui/theme.test.ts' } }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't5', content: 'bun test v1.4.3\n\nui/theme.test.ts:\n✓ concentric clamps at zero [0.21ms]\n✓ concentric keeps the centre [0.04ms]\n\n 2 pass\n 0 fail\nRan 2 tests across 1 file. [12.00ms]' }] } },
  { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, api_message_id: 'msg_demo_4' },
  {
    type: 'assistant',
    message: {
      id: 'msg_demo_4',
      content: [
        {
          type: 'text',
          text: 'Done. `concentric()` now clamps at **zero**, so a panel inset deeper than its parent radius gets square corners instead of a negative radius.\n\n- `ui/theme.ts` — one line changed, plus a comment\n- Tests: 2 pass\n\n```ts\nconcentric(14, 4) // 10\nconcentric(4, 10) // 0\n```',
        },
      ],
    },
  },
  { type: 'result', subtype: 'success', is_error: false, result: 'Done.' },
  { type: 'vellum/user', text: 'Thanks — what changed in git?', tags: [], at: '2026-10-23T14:24:00.000Z' },
  { type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' },
]
writeFileSync(path.join(home, 'threads', `${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')

const id2 = '20261022-demo02'
writeFileSync(
  path.join(home, 'threads', `${id2}.jsonl`),
  [
    { type: 'vellum/meta', meta: { id: id2, title: 'Sketch the glass tokens', profileId: 'work', workspace: '/Users/APPLE/dev/other', createdAt: '2026-10-22T10:00:00.000Z' } },
    { type: 'vellum/user', text: 'Sketch the glass tokens', tags: [], at: '2026-10-22T10:00:00.000Z' },
  ]
    .map((l) => JSON.stringify(l))
    .join('\n') + '\n',
)
writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ lastThreadId: id, ...(process.env.MATERIAL ? { material: process.env.MATERIAL } : {}) }))
console.log('fixture written to', home)
