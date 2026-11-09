// Self-check for the Settings page (ui/Settings.tsx): ⌘, opens it over the note, under the tab
// strip; sidebar items switch pages; esc, Done and a tab each go back to the note. Then, against
// scripts/fake-acp.ts: a new note starts in the mode and effort set under New notes, its session
// carries your Instructions, its reply reaches the notification inbox (and desktop delivery is
// logged on macOS), and "At launch: New note" opens the New note dialog.
//   bun scripts/check-settings.ts
import path from 'node:path'
import { launch } from '@gpuix/react/automation'
import { names, present, scratchDir } from './scratch'

const home = await scratchDir('vellum-settings-')
const windows = process.platform === 'win32'
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } }).exited
const log = path.join(home, 'fake-acp.log')
const notified = path.join(home, 'notify.log')
await Bun.write(log, '')
const env = { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home'), VELLUM_AGENT: path.resolve(import.meta.dir, 'fake-acp.ts'), FAKE_ACP_LOG: log, VELLUM_NOTIFY_LOG: notified }
let app = await launch({ command: 'bun', args: ['app.tsx'], env })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const shot = (n: string) => app.screenshot({ path: `screenshots/settings-${n}.png` })
let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}
const count = (id: string) => app.getByTestId(id).count()
let c = app.getByTestId('composer')
const until = async (ok: () => Promise<boolean> | boolean, ms = 8000) => {
  const start = Date.now()
  while (!(await ok()) && Date.now() - start < ms) await wait(150)
  return ok()
}
const sent = async () => (await Bun.file(log).text()).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).in).filter(Boolean)
const settings = async () => JSON.parse(await Bun.file(path.join(home, 'settings.json')).text())
const open = async () => {
  await c.click()
  await c.press(windows ? 'ctrl-,' : 'cmd-,')
  await app.getByTestId('settings').waitFor({ timeoutMs: 3000 })
  await wait(500)
}

try {
  await c.waitFor({ timeoutMs: 60_000 })
  await wait(2500)
  await open()
  const page = await app.getByTestId('settings').bounds()
  const strip = await app.getByTestId('open-history').bounds()
  expect('⌘, opens Settings as a page under the strip', page.y >= strip.y + strip.height - 2 && page.width > 600, JSON.stringify(page))
  await shot('1-open')

  const motionRow = async () => {
    const b = await app.getByTestId('set-motion').bounds().catch(() => undefined)
    return b && b.y >= page.y && b.y + b.height <= page.y + page.height ? Math.round(b.y - page.y) : undefined
  }
  const before = await motionRow()
  await app.getByTestId('settings-go-appearance').click()
  await wait(400)
  const after = await motionRow()
  expect('Appearance groups theme, tabs and motion', after !== undefined && (await count('settings-accounts')) === 0 && (await count('settings-appearance')) === 1, `${before} → ${after}`)
  await shot('2-motion')
  await app.getByTestId('settings-go-accounts').click()
  await wait(400)
  const accounts = await app.getByTestId('settings-accounts').bounds()
  expect('Accounts replaces the Appearance page', (await count('settings-appearance')) === 0 && accounts.y >= page.y && accounts.y - page.y < 120, `${Math.round(accounts.y - page.y)}`)

  await app.getByTestId('settings-go-appearance').click()
  await app.getByTestId('set-tabs-auto').click()
  await wait(200)
  await app.getByTestId('set-tabs-pinned').click()
  await wait(200)
  await app.getByTestId('settings').press('escape')
  expect('esc goes back to the note', await until(async () => (await count('settings')) === 0))

  await open()
  await app.getByTestId('settings-done').click()
  expect('Done goes back to the note', await until(async () => (await count('settings')) === 0))

  await open()
  const tabs = (await app.getByType('div').all()).map((n) => n.testId ?? '').filter((t) => /^tab-/.test(t))
  if (tabs[0]) {
    await app.mouse.click(await app.getByTestId(tabs[0]).center())
    expect('a tab goes back to the note', await until(async () => (await count('settings')) === 0), tabs[0])
  } else expect('a tab goes back to the note', false, 'no tab found')

  // New notes, Instructions, Notifications.
  await open()
  await app.getByTestId('settings-go-vellum').click()
  await wait(400)
  await app.getByTestId('set-new-mode-plan').click()
  await app.getByTestId('set-new-effort-max').click()
  // The account is a menu, so any number of accounts fit.
  const second = JSON.parse(await Bun.file(path.join(home, 'profiles.json')).text())[1]?.id
  await app.getByTestId('set-new-account').click()
  await app.getByTestId('set-new-account-menu').waitFor({ timeoutMs: 3000 })
  await wait(700)
  await shot('3-account-menu')
  await app.getByTestId(`set-new-account-${second}`).click()
  await wait(300)
  expect('Account is picked from a menu', (await settings()).newNoteProfile === second && (await count('set-new-account-menu')) === 0, `${second} → ${(await settings()).newNoteProfile}`)
  await app.getByTestId('settings-search').fill('notifications')
  await wait(250)
  if (windows) {
    const text = await app.getByTestId('settings').textContent()
    expect('Settings explains desktop alerts are unavailable on Windows', (await count('set-notify-all')) === 0 && text.includes('Desktop alerts are unavailable on Windows') && text.includes('Unavailable on this platform'))
  } else await app.getByTestId('set-notify-all').click()
  await app.getByTestId('settings-search').fill('instructions')
  await wait(250)
  await app.getByTestId('set-instructions').fill('Answer in haiku.')
  await wait(300)
  await shot('3-new-notes')
  const saved = (await settings())
  expect('New notes and Instructions save', saved.newNoteMode === 'plan' && saved.newNoteThink === 'max' && saved.instructions === 'Answer in haiku.', JSON.stringify(saved))
  if (!windows) expect('Notifications save', saved.notify === 'all', JSON.stringify(saved.notify))
  await app.getByTestId('settings-done').click()
  await wait(400)

  await app.getByTestId('new-thread').click()
  await c.waitFor({ timeoutMs: 5_000 })
  await wait(1200)
  const metas = (await Promise.all(names(path.join(home, 'threads'), '*.jsonl').map((f) => Bun.file(path.join(home, 'threads', f)).text()))).map((t) => JSON.parse(t.split('\n')[0]!).meta)
  const made = metas.sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0]
  expect('the new note starts on the account picked', made?.profileId === second, made?.profileId)
  await c.fill('stream a short answer')
  await wait(200)
  await c.press(windows ? 'ctrl-enter' : 'cmd-enter')
  const created = async () => (await sent()).filter((m) => m.method === 'session/new').at(-1)
  expect('a new note’s session carries your instructions', await until(async () => /Answer in haiku\./.test(JSON.stringify((await created())?.params?.systemPrompt ?? ''))), JSON.stringify((await created())?.params?.systemPrompt ?? 'none').slice(0, 80))
  const configs = async () => (await sent()).filter((m) => m.method === 'session/set_config_option').map((m) => m.params.value)
  expect('…starts in Plan', await until(async () => (await configs()).includes('plan')), (await configs()).join(','))
  expect('…at Max effort', (await configs()).includes('max'), (await configs()).join(','))
  if (windows) {
    await app.getByTestId('open-notifications').click()
    expect('a finished turn appears in the notification inbox', await until(async () => (await count(`notice-open-done:${made.id}`)) > 0, 15_000))
  } else {
    const notes = async () => (await present(notified) ? (await Bun.file(notified).text()).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
    expect('a finished turn notifies while Vellum is behind', await until(async () => (await notes()).some((n) => n.kind === 'done' && n.body === 'Claude replied'), 15_000), JSON.stringify((await notes())))
  }

  // At launch: a new note.
  await open()
  await app.getByTestId('settings-go-vellum').click()
  await wait(400)
  await app.getByTestId('set-at-launch-new').click()
  await wait(300)
  expect('At launch saves', (await settings()).atLaunch === 'new')
  const previousNote = (await settings()).lastThreadId
  await app.close()
  app = await launch({ command: 'bun', args: ['app.tsx'], env })
  c = app.getByTestId('composer')
  await c.waitFor({ timeoutMs: 60_000 })
  expect('…and the next launch opens a blank note', await until(async () => (await settings()).lastThreadId !== previousNote && (await count('composer')) === 1))
  await shot('4-at-launch')
} finally {
  await app.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
