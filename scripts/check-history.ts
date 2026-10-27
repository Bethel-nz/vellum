// Self-check for Past notes with many notes (ui/SearchResults.tsx): 400 of them, and the list only
// builds the rows near its viewport. The arrows bring the row they move to into view, search
// narrows the list, and the timings say how long opening and typing take. Shots go to
// screenshots/history-*.png.
//   bun scripts/check-history.ts
import path from 'node:path'
import { launch } from '@gpuix/react/automation'
import { scratchDir } from './scratch'

const home = await scratchDir('vellum-history-')
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } }).exited
const workspace = path.resolve(import.meta.dir, '..')
const N = 400
const ids: string[] = []
const words = ['radius', 'tree', 'pane', 'search', 'trash', 'composer', 'tabs', 'theme', 'agent', 'diff']
for (let i = 0; i < N; i++) {
  // Newest first: note 0 is the most recent.
  const at = new Date(Date.parse('2026-10-20T12:00:00.000Z') - i * 3_600_000).toISOString()
  const id = `2026${String(i).padStart(6, '0')}-hist`
  ids.push(id)
  const topic = words[i % words.length]!
  await Bun.write(path.join(home, 'threads', `${id}.jsonl`), [
      { type: 'vellum/meta', meta: { id, title: `Note ${i} about the ${topic}`, profileId: 'main', workspace, createdAt: at, updatedAt: at } },
      { type: 'vellum/user', text: `Look at the ${topic} again. `.repeat(40), tags: [], at },
    ].map((l) => JSON.stringify(l)).join('\n') + '\n')
}

const app = await launch({ command: 'bun', args: ['app.tsx'], env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const shot = (n: string) => app.screenshot({ path: `screenshots/history-${n}.png` })
const count = (id: string) => app.getByTestId(id).count()
let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}
try {
  await app.getByTestId('composer').waitFor({ timeoutMs: 60_000 })
  await wait(1200)
  let t = performance.now()
  await app.getByTestId('open-history').click()
  await app.getByTestId(`history-${ids[0]}`).waitFor({ timeoutMs: 10_000 })
  console.log(`     opened in ${Math.round(performance.now() - t)}ms`)
  await wait(600)
  const results = (await app.getByTestId('history-results').textContent())?.replace(/[^\x20-\x7e]/g, '')
  // The fixture's own notes come too.
  expect(`all ${N} notes count`, Number(results?.split(' ')[0]) >= N, results)
  const built = (await Promise.all(ids.map((id) => count(`history-${id}`)))).filter(Boolean).length
  expect('only the rows near the viewport are built', built > 3 && built < 40, `${built} of ${N}`)
  expect('the last note isn’t built', (await count(`history-${ids.at(-1)}`)) === 0)
  await shot('1-open')

  // The arrows move the highlight; the row it lands on is built and comes into view.
  for (let i = 0; i < 30; i++) await app.getByTestId('history-input').press('down')
  await wait(500)
  // The fixture's notes are newer, so they come first.
  const extra = Number(results?.split(' ')[0]) - N
  const target = ids[30 - extra]!
  expect('30 rows down is lit and in view', (await count(`history-delete-${target}`)) === 1)
  await shot('2-arrows')

  t = performance.now()
  await app.getByTestId('history-input').fill('note 3')
  await app.getByTestId(`history-${ids[3]}`).waitFor({ timeoutMs: 5_000 })
  console.log(`     searched in ${Math.round(performance.now() - t)}ms`)
  await wait(400)
  const narrowed = (await app.getByTestId('history-results').textContent())?.replace(/[^\x20-\x7e]/g, '')
  // Note 3, 30–39 and 300–399.
  expect('search narrows the list', narrowed === '111 results', narrowed)
  for (let i = 0; i < 3; i++) await app.getByTestId('history-input').press('up')
  await wait(500)
  const wrapped = (await Promise.all(ids.map((id) => count(`history-${id}`)))).filter(Boolean).length
  expect('↑ from the top wraps to the end, and the window follows', (await count(`history-${ids[397]}`)) === 1 && wrapped < 50, String(wrapped))
  await shot('3-search')
} finally {
  await app.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
