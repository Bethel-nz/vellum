// Live end-to-end check against the real `claude` CLI (spends two small turns).
//   bun scripts/check-live.ts
// Turn 1 streams a reply, writes a file (edit block) and runs a command (shell block).
// Then the app is restarted, the first paragraph is edited in place, and turn 2 must
// resume the same Claude session and answer from the edited text.
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
  const app = await launch({ command: 'bun', args: ['app.tsx'], env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home } })
  const composer = app.getByTestId('composer')
  await composer.waitFor({ timeoutMs: 60_000 })
  if (before) await before(app)
  await composer.click()
  await composer.fill(text)
  await composer.press('ctrl-enter')
  await app.getByText('Working…').waitFor({ timeoutMs: 20_000 })
  const started = Date.now()
  while ((await app.getByText('Working…').count()) > 0 && Date.now() - started < 180_000) await wait(1000)
  await wait(800)
  await app.screenshot({ path: shot })
  await app.close()
  console.log('turn done in', Math.round((Date.now() - started) / 1000), 's')
}

await turn(
  'My favourite colour is blue.\n\nCreate notes.txt containing the single word hello, then run `cat notes.txt`. Answer in one short sentence.',
  'screenshots/live-1.png',
)
await turn('What is my favourite colour, and which file did you create? Answer in five words or fewer.', 'screenshots/live-2.png', async (app) => {
  // Edit the first paragraph (block u-0) in place, then let the commit timer fire.
  const first = app.getByTestId('para-u-0')
  await first.click()
  await first.fill('My favourite colour is green.\n\nCreate notes.txt containing the single word hello, then run `cat notes.txt`. Answer in one short sentence.')
  await wait(900)
})

const lines = readFileSync(path.join(home, 'threads', `${id}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
const inits = lines.filter((l) => l.type === 'system' && l.subtype === 'init').map((l) => l.session_id)
console.log('session ids:', [...new Set(inits)])
console.log('results:', lines.filter((l) => l.type === 'result').map((l) => `${l.subtype}/${l.is_error}: ${String(l.result).slice(0, 80)}`))
console.log('edits recorded:', lines.filter((l) => l.type === 'vellum/edit').length, 'synced:', lines.filter((l) => l.type === 'vellum/synced').length)
console.log('notes.txt:', JSON.stringify(readFileSync(path.join(ws, 'notes.txt'), 'utf8')))
console.log('md exists:', readFileSync(path.join(home, 'threads', `${id}.md`), 'utf8').split('\n').slice(0, 12).join('\n'))
console.log('home', home)
