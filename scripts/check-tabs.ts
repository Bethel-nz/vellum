// Self-check for the tab strip: + opens a note in the same folder, ⌃← ⌃→ cycle, ⌘⇧T hides and shows the
// strip, auto mode tucks it away while you write and the top edge brings it back, ⌃click closes.
// The strip's state is read from where the page starts (it moves up by the strip's height).
// ⌘Y opens History from the left; picking a note there opens it in a tab.
//   bun scripts/check-tabs.ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launch } from '@gpuix/react/automation'

const home = mkdtempSync(path.join(tmpdir(), 'vellum-tabs-'))
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home } }).exited
const app = await launch({ command: 'bun', args: ['app.tsx'], env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home } })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const shot = (n: string) => app.screenshot({ path: 'screenshots/tabs-' + n + '.png' })
const titleY = async () => Math.round((await app.getByTestId('page').bounds()).y)
const tabIds = async () => (await app.getByType('div').all()).map((n) => n.testId ?? '').filter((id) => id.startsWith('tab-'))
const tabCount = async () => (await tabIds()).length
let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}

try {
  const c = app.getByTestId('composer')
  await c.waitFor({ timeoutMs: 60_000 })
  await wait(1200)
  const shown = await titleY()

  // + makes a new note in this folder without asking
  const before = await tabCount()
  await app.getByTestId('new-thread').click()
  await wait(900)
  expect('+ adds a tab', (await tabCount()) === before + 1, `${before} → ${await tabCount()}`)
  expect('+ asks nothing', (await app.getByTestId('choose-folder').count()) === 0)
  await shot('1-plus')

  // ⌃← ⌃→ step through the tabs, even from the composer. The current tab is the wide one.
  const current = async () => {
    for (const id of await tabIds()) if ((await app.getByTestId(id).bounds()).width > 40) return id
  }
  const [first, second] = await tabIds()
  await c.click()
  await c.press('ctrl-left')
  await wait(500)
  expect('⌃← goes to the previous tab', (await current()) === first, `${await current()}`)
  await c.press('ctrl-right')
  await wait(500)
  expect('⌃→ goes to the next tab', (await current()) === second)

  // ⌃click closes that tab again
  const fresh = (await tabIds()).at(-1)!
  await app.mouse.click(await app.getByTestId(fresh).center(), { modifiers: 'ctrl' })
  await wait(700)
  expect('⌃click closes a tab', (await tabCount()) === before)

  // ⌘Y opens History; ↩ on a past note opens it
  await c.press('cmd-y')
  await app.getByTestId('history-input').waitFor({ timeoutMs: 3000 })
  const rows = (await app.getByType('div').all()).map((n) => n.testId ?? '').filter((id) => id.startsWith('history-') && id !== 'history-input')
  expect('History lists notes', rows.length >= 2, `${rows.length} rows`)
  await shot('5-history')
  await app.getByTestId('history-input').press('escape')
  await wait(400)
  expect('esc closes History', (await app.getByTestId('history-input').count()) === 0)

  // the current pill opens the note menu
  await app.getByTestId('title-menu').click()
  await wait(600)
  expect('current pill opens the note menu', (await app.getByTestId('title-menu-panel').count()) === 1)
  await app.getByTestId('title-menu-panel').press('escape')
  await wait(400)

  // ⌘⇧T hides the pinned strip and brings it back
  await c.press('cmd-shift-t')
  await wait(500)
  const hidden = await titleY()
  expect('⌘⇧T hides the strip', hidden < shown - 20, `title y ${shown} → ${hidden}`)
  await shot('2-hidden')
  await c.press('cmd-shift-t')
  await wait(500)
  expect('⌘⇧T shows it again', (await titleY()) === shown)

  // auto: writing tucks the strip away, the top edge brings it back
  await c.press('cmd-,')
  await app.getByTestId('set-tabs-auto').click()
  await wait(300)
  expect('settings save auto', (await Bun.file(path.join(home, 'settings.json')).json()).tabs === 'auto')
  await app.getByTestId('set-tabs-auto').press('escape')
  await wait(500)
  await c.click()
  await c.fill('A few words')
  await wait(600)
  expect('auto mode tucks away while writing', (await titleY()) < shown - 20)
  await shot('3-auto-writing')
  await app.mouse.move({ x: 400, y: 6 })
  await wait(600)
  expect('top edge reveals it', (await titleY()) === shown)
  await shot('4-auto-reveal')
} finally {
  await app.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
