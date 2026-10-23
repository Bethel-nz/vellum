// Self-check: launch Vellum on the fixture thread in the background and write PNGs.
//
//   bun scripts/screenshot.ts [outDir]
//
// Uses a scratch VELLUM_HOME, so ~/.vellum is never touched.

import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launch } from '@gpuix/react/automation'

const out = process.argv[2] ?? 'screenshots'
mkdirSync(out, { recursive: true })
const home = process.env.VELLUM_HOME ?? mkdtempSync(path.join(tmpdir(), 'vellum-'))
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home, MATERIAL: process.env.MATERIAL ?? 'groknight' }, stdout: 'inherit' }).exited

const app = await launch({
  command: 'bun',
  args: ['app.tsx'],
  env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, ...(process.env.VELLUM_SOLID ? { VELLUM_SOLID: '1' } : {}) },
})
const shot = async (name: string) => {
  await new Promise((r) => setTimeout(r, 400))
  await app.screenshot({ path: path.join(out, `${name}.png`) })
  console.log('wrote', name)
}

await app.getByTestId('composer').waitFor({ timeoutMs: 60_000 })
await shot('01-document')
// The edit block sits above the fold: scroll up to it for the diff (positive wheel = toward the top).
await app.mouse.wheel({ x: 540, y: 500 }, 0, 4000)
await Bun.sleep(500)
await shot('01b-edit')
await app.mouse.wheel({ x: 540, y: 500 }, 0, -8000)
await Bun.sleep(400)

await app.getByTestId('composer').click()
await app.getByTestId('composer').fill('!printf "\\033[32mgreen\\033[0m \\033[1;34mbold blue\\033[0m plain\\n"; ls -G')
await shot('02-shell-draft')
await app.getByTestId('composer').press('ctrl-enter')
await new Promise((r) => setTimeout(r, 1200))
await shot('03-shell-ran')

await app.getByTestId('composer').fill('look at @them')
await new Promise((r) => setTimeout(r, 600))
await shot('04-tag-popup')
await app.getByTestId('composer').press('escape')
await app.getByTestId('composer').fill('')

await app.getByTestId('open-switcher').click()
await shot('05-switcher')
await app.getByTestId('switcher-input').press('escape')

await app.getByTestId('composer').press('cmd-n')
await shot('06-new-thread')
await app.getByTestId('choose-folder').waitFor()
await app.getByTestId('choose-folder').press('escape')
await Bun.sleep(400)

await app.getByTestId('title-menu').click()
await app.getByTestId('title-menu-panel').waitFor()
await Bun.sleep(1500)
await shot('08-title-menu')
await app.getByTestId('title-menu-panel').press('escape')
await Bun.sleep(300)

await app.getByTestId('composer').press('cmd-,')
await app.getByTestId('settings').waitFor()
await shot('07-settings')
await app.close()
console.log('VELLUM_HOME', home)
