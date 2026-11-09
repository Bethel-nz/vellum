// Self-check for the note: two tabs, editing your own text, editing a reply, the title menu,
// rename, ⇧⌘W / ⌘1, and the trust notice for a folder with project config: nothing sends from
// it until you trust it, and then what you wrote goes.
//   bun scripts/check-note.ts
import path from 'node:path'
import { launch } from '@gpuix/react/automation'
import { scratchDir } from './scratch'
const home = await scratchDir('vellum-note-')
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } }).exited
// A third note in a folder that ships an MCP config, so it shows up under recent folders.
const risky = path.join(home, 'risky-project')
await Bun.write(path.join(risky, '.mcp.json'), '{"mcpServers":{}}\n')
const meta = { id: '20261001-risky', title: 'Risky folder', profileId: 'main', workspace: risky, createdAt: '2026-10-01T09:00:00.000Z' }
await Bun.write(path.join(home, 'threads', `${meta.id}.jsonl`), JSON.stringify({ type: 'vellum/meta', meta }) + '\n')
// The fake agent: if the gate ever let a turn through, it must not reach a real one.
const app = await launch({ command: 'bun', args: ['app.tsx'], env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home'), VELLUM_AGENT: path.resolve(import.meta.dir, 'fake-acp.ts') } })
let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}
const sentFromRisky = async () => (await Bun.file(path.join(home, 'threads', `${meta.id}.jsonl`)).text()).includes('Wire the radius token')
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const shot = (n: string) => app.screenshot({ path: 'screenshots/note-' + n + '.png' })
try {
  const c = app.getByTestId('composer')
  await c.waitFor({ timeoutMs: 60_000 })
  await wait(1500)
  await shot('1-note')
  // open the second note from Library so there are two tabs
  await app.getByTestId('open-history').click()
  await wait(1500)
  await app.getByTestId('history-20261022-demo02').click()
  await wait(1200)
  await shot('2-two-tabs')
  // back to the first note (tabs are per project, and the second is in another folder), and
  // edit an earlier paragraph of mine
  await app.getByTestId('open-history').click()
  await wait(1500)
  await app.getByTestId('history-20261023-demo01').click()
  await wait(1200)
  const para = app.getByTestId('para-u-6')
  await para.click()
  await para.fill('Thanks. What changed in git, and why?')
  await wait(900)
  await c.click()
  await wait(400)
  await shot('3-edited')
  // click a reply to edit its source
  await app.getByTestId('reply-a-5').click()
  await wait(800)
  await shot('4-reply-editing')
  await c.click()
  await wait(400)
  // title menu
  await app.getByTestId('title-menu').click()
  await wait(1500)
  await shot('5-menu')
  // rename from the menu
  await app.getByTestId('menu-rename').click()
  await wait(600)
  const title = app.getByTestId('title-input')
  await title.fill('Concentric radius')
  await title.press('enter')
  await wait(800)
  console.log('renamed tab:', await app.getByText('Concentric radius').count())
  await shot('6-renamed')
  // ⇧⌘W closes the active tab, ⌘1 goes to the first
  await c.click()
  await c.press('cmd-shift-w')
  await wait(800)
  console.log('tabs after ⇧⌘W:', await app.getByTestId('tab-20261023-demo01').count(), await app.getByTestId('tab-20261022-demo02').count())
  // The project's last tab just closed (tabs are per project), so there may be no composer for ⌘1.
  if (await c.count()) {
    await c.press('cmd-1')
    await wait(600)
  }
  // The trust notice: the note in a folder that ships an MCP config holds what you send.
  await app.getByTestId('open-history').click()
  await wait(1500)
  await app.getByTestId(`history-${meta.id}`).click()
  // The Library stays open after opening a note from it; a press on the page closes it.
  if (await app.getByTestId('history').count()) await app.getByTestId('page').click()
  await wait(400)
  // The folder's config is checked off the frame: give it a moment to land.
  for (let i = 0; i < 30 && !(await app.getByTestId('trust-warning').count()); i++) await wait(100)
  expect('trust notice shown for a folder with .mcp.json', (await app.getByTestId('trust-warning').count()) === 1)
  expect('…naming the file', (await app.getByTestId('trust-warning-files').textContent()).includes('.mcp.json'))
  await shot('7-trust-warning')
  await c.click()
  await c.fill('Wire the radius token')
  await c.press('cmd-enter')
  await wait(1200)
  expect('sending is held: nothing went out', !(await sentFromRisky()))
  await app.getByTestId('trust-folder').click()
  for (let i = 0; i < 50 && !(await sentFromRisky()); i++) await wait(100)
  expect('Trust folder sends what you wrote, kept while held', await sentFromRisky())
  expect('…and the notice is gone', (await app.getByTestId('trust-warning').count()) === 0)
  const settings = await Bun.file(path.join(home, 'settings.json')).json()
  expect('…and that config is remembered as trusted, for this agent and folder', Boolean(settings.trustedConfig?.[`claude:${risky}`]), JSON.stringify(settings.trustedConfig))
  // Config changed after it was trusted asks again on the next send, and keeps what you wrote.
  // (With the first turn stopped: the fake asks to run a command, and mid-turn a message queues.)
  await c.click()
  await c.press('cmd-.')
  for (let i = 0; i < 100 && (await app.getByTestId('stop').count()); i++) await wait(100)
  await Bun.write(path.join(risky, '.mcp.json'), '{"mcpServers":{"x":{"command":"true"}}}\n')
  await c.click()
  await c.fill('Second message')
  await c.press('cmd-enter')
  for (let i = 0; i < 30 && !(await app.getByTestId('trust-warning').count()); i++) await wait(100)
  const thread = async () => (await Bun.file(path.join(home, 'threads', `${meta.id}.jsonl`)).text())
  expect('changed config asks again', (await app.getByTestId('trust-warning').count()) === 1)
  expect('…and nothing went out', !(await thread()).includes('Second message'))
  await app.getByTestId('trust-folder').click()
  for (let i = 0; i < 50 && !(await thread()).includes('Second message'); i++) await wait(100)
  expect('…and trusting it sends what you wrote', (await thread()).includes('Second message'))
  await shot('8-trusted')
} catch (e) {
  failed++
  console.log(`FAIL ${String((e as Error)?.stack ?? e)}`)
} finally {
  await app.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
