// Self-check for the Settings page (ui/Settings.tsx): ⌘, opens it over the note, under the tab
// strip; a section's name scrolls to it; esc, Done and a tab each go back to the note.
//   bun scripts/check-settings.ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launch } from '@gpuix/react/automation'

const home = mkdtempSync(path.join(tmpdir(), 'vellum-settings-'))
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } }).exited
const app = await launch({ command: 'bun', args: ['app.tsx'], env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const shot = (n: string) => app.screenshot({ path: `screenshots/settings-${n}.png` })
let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}
const count = (id: string) => app.getByTestId(id).count()
const c = app.getByTestId('composer')
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
  expect('…and Accounts scrolls back up', (await motionRow()) === before, `${await motionRow()} vs ${before}`)

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
} finally {
  await app.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
