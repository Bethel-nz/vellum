// Self-check for the note: two tabs, editing your own text, editing a reply, the title menu.
//   bun scripts/check-note.ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launch } from '@gpuix/react/automation'
const home = mkdtempSync(path.join(tmpdir(), 'vellum-note-'))
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home } }).exited
const app = await launch({ command: 'bun', args: ['app.tsx'], env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home } })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const shot = (n: string) => app.screenshot({ path: 'screenshots/note-' + n + '.png' })
try {
  const c = app.getByTestId('composer')
  await c.waitFor({ timeoutMs: 60_000 })
  await wait(1500)
  await shot('1-note')
  // open the second note from the switcher so there are two tabs
  await app.getByTestId('open-switcher').click()
  await wait(1500)
  await app.getByTestId('thread-20261022-demo02').click()
  await wait(1200)
  await shot('2-two-tabs')
  // back to the first tab, edit an earlier paragraph of mine
  await app.getByTestId('tab-20261023-demo01').click()
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
} finally {
  await app.close()
}
