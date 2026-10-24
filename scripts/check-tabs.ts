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
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } }).exited
const app = await launch({ command: 'bun', args: ['app.tsx'], env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
// A held sheet closes after its scrim. Observe the removal instead of racing a fixed sleep.
const closed = async (id: string) => {
  const deadline = Date.now() + 3000
  while (await app.getByTestId(id).count()) {
    if (Date.now() >= deadline) return false
    await wait(25)
  }
  return true
}

const shot = (n: string) => app.screenshot({ path: 'screenshots/tabs-' + n + '.png' })
const titleY = async () => Math.round((await app.getByTestId('page').bounds()).y)
/** Polls until `ok`, for the strip's slide: under load it can still be moving after a fixed wait. */
const until = async (ok: () => Promise<boolean>, ms = 4000) => {
  for (const end = Date.now() + ms; Date.now() < end; await wait(100)) if (await ok()) return true
  return false
}
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

  // + asks where, starting on this note's folder; Create adds the tab
  const before = await tabCount()
  await app.getByTestId('new-thread').click()
  await wait(1200)
  expect('+ asks where', (await app.getByTestId('choose-folder').count()) === 1)
  await app.getByTestId('create-thread').click()
  await wait(900)
  expect('Create adds a tab', (await tabCount()) === before + 1, `${before} → ${await tabCount()}`)
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
  await app.getByTestId('history-input').bounds()
  await wait(32)
  await app.getByTestId('history-input').press('escape')
  await wait(400)
  expect('esc closes History', await closed('history-input'))
  await app.getByTestId('open-history').click()
  await app.getByTestId('history-input').waitFor({ timeoutMs: 3000 })
  await wait(500)
  // Just past the panel's edge, wherever that is.
  const panel = await app.getByTestId('history').bounds()
  await app.mouse.click({ x: Math.round(panel.x + panel.width + 60), y: 400 })
  await wait(400)
  expect('a click beside it closes History', await closed('history-input'))

  // the current pill opens the note menu
  await app.getByTestId('title-menu').click()
  await wait(600)
  expect('current pill opens the note menu', (await app.getByTestId('title-menu-panel').count()) === 1)
  await app.getByTestId('title-menu-panel').press('escape')
  await wait(400)

  // ⌘⇧T hides the pinned strip and brings it back
  await c.press('cmd-shift-t')
  await until(async () => (await titleY()) < shown - 20)
  const hidden = await titleY()
  expect('⌘⇧T hides the strip', hidden < shown - 20, `title y ${shown} → ${hidden}`)
  await shot('2-hidden')
  await c.press('cmd-shift-t')
  expect('⌘⇧T shows it again', await until(async () => (await titleY()) === shown))

  // auto: writing tucks the strip away, the top edge brings it back
  await c.press('cmd-,')
  // Tabs sits below the fold: jump to it first.
  await app.getByTestId('settings-go-tabs').click()
  await wait(400)
  await app.getByTestId('set-tabs-auto').click()
  await wait(300)
  expect('settings save auto', (await Bun.file(path.join(home, 'settings.json')).json()).tabs === 'auto')
  await app.getByTestId('set-tabs-auto').press('escape')
  await closed('settings')
  await wait(32)
  await c.click()
  await c.fill('A few words')
  expect('auto mode tucks away while writing', await until(async () => (await titleY()) < shown - 20))
  await shot('3-auto-writing')
  await app.mouse.move({ x: 400, y: 6 })
  expect('top edge reveals it', await until(async () => (await titleY()) === shown))
  await shot('4-auto-reveal')
} finally {
  await app.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
