// Self-check for pane-scoped selection (app.tsx's active pane): a drag that starts in the note
// selects the note's text and none of the open file's, a drag that starts in the file selects
// only the file's, and the note still selects once the pointer is back over it.
//   bun scripts/check-pane-select.ts
import path from 'node:path'
import { launch } from '@gpuix/react/automation'
import { remove, scratchDir } from './scratch'

const home = await scratchDir('vellum-pane-select-')
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } }).exited
const id = '20261026-pane01'
const workspace = path.resolve(import.meta.dir, '..')
const lines = [
  { type: 'vellum/meta', meta: { id, title: 'Read a file', profileId: 'main', workspace, createdAt: '2026-10-26T09:00:00.000Z' } },
  { type: 'vellum/user', text: 'What does #core/printed.ts do?', tags: [{ type: 'file', value: 'core/printed.ts' }], at: '2026-10-26T09:00:01.000Z' },
  { type: 'acp/update', update: { sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: 'It prints the last step of a run, and only that step, so the log stays short.' } } },
  { type: 'acp/end', stopReason: 'end_turn' },
]
await Bun.write(path.join(home, 'threads', `${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
await Bun.write(path.join(home, 'settings.json'), JSON.stringify({ lastThreadId: id }))

let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}
const app = await launch({ command: 'bun', args: ['app.tsx'], env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home'), VELLUM_WINDOW: '1280x800' } })
try {
  await app.getByTestId('composer').waitFor({ timeoutMs: 60_000 })
  await app.getByTestId('chip-0').click()
  await app.getByTestId('file-preview').waitFor({ timeoutMs: 5000 })
  await Bun.sleep(800)
  const page = await app.getByTestId('page').bounds()
  const file = await app.getByTestId('file-preview').bounds()
  // The answer's line, in window points at 1280×800: the tree doesn't carry markdown's text.
  const answer = { x: 40, y: 124, width: 430, height: 18 }

  const selected = async () => ((await app.call('getSelectedText', {})) as { text: string | null }).text ?? ''
  // Hover first, as a hand does, then press and drag in steps.
  const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    await app.call('clearSelection', {})
    await app.mouse.move(from)
    await Bun.sleep(60)
    await app.mouse.down(from)
    for (let i = 1; i <= 10; i++) await app.mouse.move({ x: from.x + (to.x - from.x) * i / 10, y: from.y + (to.y - from.y) * i / 10 }, { pressedButton: 0 })
    await app.mouse.up(to)
    await Bun.sleep(150)
    return selected()
  }
  const inNote = { x: answer.x + 4, y: answer.y + answer.height / 2 }
  const inFile = { x: file.x + file.width / 2, y: file.y + file.height * 0.45 }

  const noteOnly = await drag(inNote, { x: answer.x + answer.width - 4, y: answer.y + answer.height / 2 })
  expect('the note still selects its own text', /prints the last step/.test(noteOnly), JSON.stringify(noteOnly.slice(0, 60)))
  const fileOnly = await drag(inFile, { x: inFile.x + 200, y: inFile.y + 40 })
  expect('the file selects its own text', /printedFile|const/.test(fileOnly), JSON.stringify(fileOnly.slice(0, 60)))
  const noteOut = await drag(inNote, inFile)
  expect('a drag from the note into the file stays in the note', /prints the last step/.test(noteOut) && !/printed\.ts|\bconst\b|function/.test(noteOut), JSON.stringify(noteOut.slice(0, 120)))
  const fileOut = await drag(inFile, { x: page.x + 40, y: page.y + 60 })
  expect('a drag from the file into the note stays in the file', fileOut !== '' && !/prints the last step|What does/.test(fileOut), JSON.stringify(fileOut.slice(0, 120)))
  const back = await drag(inNote, { x: answer.x + answer.width - 4, y: answer.y + answer.height / 2 })
  expect('and the note selects again once the pointer is back', /prints the last step/.test(back), JSON.stringify(back.slice(0, 60)))
} finally {
  await app.close()
  await remove(home)
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
