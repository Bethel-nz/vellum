// Live end-to-end check through the Claude ACP adapter and the real `claude` (spends two small turns).
//   bun scripts/check-live.ts
// Turn 1 streams a reply, writes a file (edit block) and runs a command (shell block).
// Then the app is restarted, the first paragraph is edited in place, and turn 2 must
// resume the same Claude session and answer from the edited text. Any permission card is allowed.
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launch } from '@gpuix/react/automation'

const root = mkdtempSync(path.join(tmpdir(), 'vellum-live-'))
const home = path.join(root, 'home')
const ws = path.join(root, 'workspace')
mkdirSync(path.join(home, 'threads'), { recursive: true })
mkdirSync(ws, { recursive: true })
writeFileSync(path.join(ws, 'README.md'), '# scratch\n')
const id = 'live-check'
const meta = { id, title: 'Untitled', profileId: 'main', workspace: ws, createdAt: new Date().toISOString() }
writeFileSync(path.join(home, 'threads', `${id}.jsonl`), JSON.stringify({ type: 'vellum/meta', meta }) + '\n')
writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ lastThreadId: id }))

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
type App = Awaited<ReturnType<typeof launch>>
async function turn(text: string, shot: string, before?: (app: App) => Promise<void>) {
  const app = await launch({ command: 'bun', args: ['app.tsx'], env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } })
  try {
    const composer = app.getByTestId('composer')
    await composer.waitFor({ timeoutMs: 60_000 })
    if (before) await before(app)
    await composer.click()
    await composer.fill(text)
    await composer.press('cmd-enter')
    await app.getByText('Working…').waitFor({ timeoutMs: 20_000 })
    const started = Date.now()
    while ((await app.getByText('Working…').count()) > 0 && Date.now() - started < 180_000) {
      if ((await app.getByTestId('approval-allow').count()) === 1) await app.getByTestId('approval-allow').click()
      await wait(1000)
    }
    await wait(800)
    await app.screenshot({ path: shot })
    console.log('turn done in', Math.round((Date.now() - started) / 1000), 's')
  } finally {
    await app.close()
  }
}

await turn(
  'My favourite colour is blue.\n\nCreate notes.txt containing the single word hello, then run `cat notes.txt`. Answer in one short sentence.',
  'screenshots/live-1.png',
)
await turn('What is my favourite colour, and which file did you create? Answer in five words or fewer.', 'screenshots/live-2.png', async (app) => {
  // Edit the first paragraph (block u-0) in place, then let the commit timer fire.
  // The note opens at its end, so scroll up to the paragraph first, and back down after.
  await app.getByTestId('composer').wheel(0, -4000)
  await wait(600)
  const first = app.getByTestId('para-u-0')
  await first.click()
  await first.fill('My favourite colour is green.\n\nCreate notes.txt containing the single word hello, then run `cat notes.txt`. Answer in one short sentence.')
  await wait(900)
  await first.wheel(0, 8000)
  await wait(600)
})

const lines = readFileSync(path.join(home, 'threads', `${id}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
const sessions = [...new Set(lines.filter((l) => l.type === 'acp/session').map((l) => l.sessionId))]
const ends = lines.filter((l) => l.type === 'acp/end').map((l) => l.stopReason)
const errors = lines.filter((l) => l.type === 'vellum/error').map((l) => l.text)
// The last reply, from its chunks.
const lastTurn = lines.slice(lines.map((l) => l.type).lastIndexOf('vellum/user'))
const reply = lastTurn.filter((l) => l.type === 'acp/update' && l.update.sessionUpdate === 'agent_message_chunk').map((l) => l.update.content.text).join('')
let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}
expect('one session across the restart', sessions.length === 1, sessions.join(', '))
expect('both turns ended normally', ends.length === 2 && ends.every((e) => e === 'end_turn'), ends.join(', '))
expect('no errors', errors.length === 0, errors.join(' | '))
expect('notes.txt holds hello', readFileSync(path.join(ws, 'notes.txt'), 'utf8').trim() === 'hello')
expect('the edit reached Claude', lines.some((l) => l.type === 'vellum/edit') && lines.some((l) => l.type === 'vellum/synced'))
expect('the answer uses the edited paragraph', /green/i.test(reply) && !/blue/i.test(reply), reply)
expect('the readable copy is written', readFileSync(path.join(home, 'threads', `${id}.md`), 'utf8').includes('notes.txt'))
console.log('home', home)
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
