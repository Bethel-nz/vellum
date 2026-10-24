// Self-check for the Settings page (ui/Settings.tsx): ⌘, opens it over the note, under the tab
// strip; a section's name scrolls to it; esc, Done and a tab each go back to the note. Then, against
// scripts/fake-acp.ts: a new note starts in the mode and effort set under New notes, its session
// carries your Instructions, a finished turn notifies (to $VELLUM_NOTIFY_LOG, never the desktop)
// while Vellum is in the background, and "At launch: New note" opens the New note dialog.
//   bun scripts/check-settings.ts
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launch } from '@gpuix/react/automation'

const home = mkdtempSync(path.join(tmpdir(), 'vellum-settings-'))
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } }).exited
const log = path.join(home, 'fake-acp.log')
const notified = path.join(home, 'notify.log')
writeFileSync(log, '')
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
const sent = () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).in).filter(Boolean)
const settings = () => JSON.parse(readFileSync(path.join(home, 'settings.json'), 'utf8'))
const open = async () => {
  await c.click()
  await c.press('cmd-,')
  await app.getByTestId('settings').waitFor({ timeoutMs: 3000 })
  await wait(500)
}

try {
  await c.waitFor({ timeoutMs: 60_000 })
  await wait(2500)
  await open()
  const page = await app.getByTestId('settings').bounds()
  const strip = await app.getByTestId('open-switcher').bounds()
  expect('⌘, opens Settings as a page under the strip', page.y >= strip.y + strip.height - 2 && page.width > 600, JSON.stringify(page))
  await shot('1-open')

  const motionRow = async () => {
    const b = await app.getByTestId('set-motion').bounds().catch(() => undefined)
    return b && b.y >= page.y && b.y + b.height <= page.y + page.height ? Math.round(b.y - page.y) : undefined
  }
  const before = await motionRow()
  await app.getByTestId('settings-go-motion').click()
  await wait(400)
  const after = await motionRow()
  expect('Motion in the list scrolls to its section', after !== undefined && (before === undefined || after < before), `${before} → ${after}`)
  await shot('2-motion')
  await app.getByTestId('settings-go-accounts').click()
  await wait(400)
  const accounts = await app.getByTestId('settings-accounts').bounds()
  expect('…and Accounts scrolls back up', (await motionRow()) === before && accounts.y >= page.y && accounts.y - page.y < 120, `${Math.round(accounts.y - page.y)}`)

  await app.getByTestId('set-tabs-auto').click()
  await wait(200)
  await app.getByTestId('set-tabs-pinned').click()
  await wait(200)
  await app.getByTestId('settings').press('escape')
  await wait(400)
  expect('esc goes back to the note', (await count('settings')) === 0)

  await open()
  await app.getByTestId('settings-done').click()
  await wait(400)
  expect('Done goes back to the note', (await count('settings')) === 0)

  await open()
  const tabs = (await app.getByType('div').all()).map((n) => n.testId ?? '').filter((t) => /^tab-/.test(t))
  if (tabs[0]) {
    await app.getByTestId(tabs[0]).click()
    await wait(400)
    expect('a tab goes back to the note', (await count('settings')) === 0, tabs[0])
  } else expect('a tab goes back to the note', false, 'no tab found')

  // New notes, Instructions, Notifications.
  await open()
  await app.getByTestId('settings-go-new-notes').click()
  await wait(400)
  await app.getByTestId('set-new-mode-plan').click()
  await app.getByTestId('set-new-effort-max').click()
  await app.getByTestId('set-notify-all').click()
  // The account is a menu, so any number of accounts fit.
  const second = JSON.parse(readFileSync(path.join(home, 'profiles.json'), 'utf8'))[1]?.id
  await app.getByTestId('set-new-account').click()
  await app.getByTestId('set-new-account-menu').waitFor({ timeoutMs: 3000 })
  await wait(700)
  await shot('3-account-menu')
  await app.getByTestId(`set-new-account-${second}`).click()
  await wait(300)
  expect('Account is picked from a menu', settings().newNoteProfile === second && (await count('set-new-account-menu')) === 0, `${second} → ${settings().newNoteProfile}`)
  await app.getByTestId('set-instructions').fill('Answer in haiku.')
  await wait(300)
  await shot('3-new-notes')
  const saved = settings()
  expect('New notes, Instructions and Notifications save', saved.newNoteMode === 'plan' && saved.newNoteThink === 'max' && saved.notify === 'all' && saved.instructions === 'Answer in haiku.', JSON.stringify(saved))
  await app.getByTestId('settings-done').click()
  await wait(400)

  await app.getByTestId('new-thread').click()
  await app.getByTestId('create-thread').waitFor({ timeoutMs: 5_000 })
  await wait(800)
  await app.getByTestId('create-thread').click()
  await wait(1200)
  const metas = readdirSync(path.join(home, 'threads')).filter((f) => f.endsWith('.jsonl')).map((f) => JSON.parse(readFileSync(path.join(home, 'threads', f), 'utf8').split('\n')[0]!).meta)
  const made = metas.sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0]
  expect('the new note starts on the account picked', made?.profileId === second, made?.profileId)
  await c.fill('stream a short answer')
  await wait(200)
  await c.press('cmd-enter')
  const created = () => sent().filter((m) => m.method === 'session/new').at(-1)
  expect('a new note’s session carries your instructions', await until(() => /Answer in haiku\./.test(JSON.stringify(created()?.params?.systemPrompt ?? ''))), JSON.stringify(created()?.params?.systemPrompt ?? 'none').slice(0, 80))
  const configs = () => sent().filter((m) => m.method === 'session/set_config_option').map((m) => m.params.value)
  expect('…starts in Plan', await until(() => configs().includes('plan')), configs().join(','))
  expect('…at Max effort', configs().includes('max'), configs().join(','))
  const notes = () => (existsSync(notified) ? readFileSync(notified, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
  expect('a finished turn notifies while Vellum is behind', await until(() => notes().some((n) => n.kind === 'done' && n.body === 'Claude replied'), 15_000), JSON.stringify(notes()))

  // At launch: a new note.
  await open()
  await app.getByTestId('settings-go-new-notes').click()
  await wait(400)
  await app.getByTestId('set-at-launch-new').click()
  await wait(300)
  expect('At launch saves', settings().atLaunch === 'new')
  await app.close()
  app = await launch({ command: 'bun', args: ['app.tsx'], env })
  c = app.getByTestId('composer')
  await c.waitFor({ timeoutMs: 60_000 })
  expect('…and the next launch opens New note', await until(async () => (await count('create-thread')) === 1))
  await shot('4-at-launch')
} finally {
  await app.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
