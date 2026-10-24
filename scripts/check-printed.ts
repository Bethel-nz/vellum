// Self-check for file-printing commands in the note (core/printed.ts): Claude ran `cat`, `sed -n`
// and `cat | grep` on a TypeScript file. The first two show their output as TypeScript, the
// third as shell. Shots go to screenshots/printed-*.png, to look at by eye.
//   bun scripts/check-printed.ts
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launch } from '@gpuix/react/automation'
import { printedFile } from '../core/printed'

const home = mkdtempSync(path.join(tmpdir(), 'vellum-printed-'))
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } }).exited

const id = '20261024-print1'
const source = readFileSync(path.join(import.meta.dir, '../core/printed.ts'), 'utf8')
const lines: unknown[] = [
  { type: 'vellum/meta', meta: { id, title: 'Printed files', profileId: 'main', workspace: path.resolve(import.meta.dir, '..'), createdAt: '2026-10-24T09:00:00.000Z' } },
  { type: 'vellum/user', text: 'Show me how printedFile decides.', tags: [], at: '2026-10-24T09:00:01.000Z' },
]
const run = (n: number, command: string, output: string) => {
  const toolCallId = `toolu_${n}`
  const meta = { claudeCode: { toolName: 'Bash' } }
  lines.push({ type: 'acp/update', update: { _meta: meta, toolCallId, sessionUpdate: 'tool_call', name: 'Bash', rawInput: {}, status: 'pending', title: 'Terminal', kind: 'execute', content: [] } })
  lines.push({ type: 'acp/update', update: { _meta: meta, toolCallId, sessionUpdate: 'tool_call_update', rawInput: { command }, title: command } })
  lines.push({ type: 'acp/update', update: { _meta: meta, toolCallId, sessionUpdate: 'tool_call_update', status: 'completed', rawOutput: output } })
}
const commands = ['cat core/printed.ts', "sed -n '18,45p' core/printed.ts", 'cat core/printed.ts | grep const']
run(1, commands[0]!, source.split('\n').slice(0, 20).join('\n'))
run(2, commands[1]!, source.split('\n').slice(17, 45).join('\n'))
run(3, commands[2]!, source.split('\n').filter((l) => l.includes('const')).join('\n'))
lines.push({ type: 'acp/update', update: { sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: 'It takes the last step, and only a printer with one file counts.' } } })
lines.push({ type: 'acp/end', stopReason: 'end_turn' })
writeFileSync(path.join(home, 'threads', `${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ lastThreadId: id }))

let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}
expect('cat and sed -n name the file; a pipe names none', printedFile(commands[0]!) === 'core/printed.ts' && printedFile(commands[1]!) === 'core/printed.ts' && printedFile(commands[2]!) === undefined)

const app = await launch({ command: 'bun', args: ['app.tsx'], env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } })
try {
  await app.getByTestId('composer').waitFor({ timeoutMs: 60_000 })
  await new Promise((r) => setTimeout(r, 2500))
  await app.screenshot({ path: 'screenshots/printed-end.png' })
  const codes = (await app.getByType('code').all()).length
  expect('the three commands show their output', codes >= 3, `${codes} code blocks`)
} finally {
  await app.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
