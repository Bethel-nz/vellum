// Self-check for "Open in" on the strip: it lists this Mac's apps with their icons, opens the note's
// folder in the one you pick, remembers it, and the button then opens there in one click. Nothing
// is really opened: VELLUM_OPEN_LOG records what would be.
//   bun scripts/check-open-in.ts
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launch } from '@gpuix/react/automation'
import { openTargets } from '../core/openin'

const home = mkdtempSync(path.join(tmpdir(), 'vellum-open-in-'))
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home } }).exited
const log = path.join(home, 'open.log')
writeFileSync(log, '')
const app = await launch({ command: 'bun', args: ['app.tsx'], env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home'), VELLUM_OPEN_LOG: log } })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const shot = (n: string) => app.screenshot({ path: 'screenshots/open-in-' + n + '.png' })
const opened = () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
const settings = () => JSON.parse(readFileSync(path.join(home, 'settings.json'), 'utf8'))
const workspace = path.resolve(import.meta.dir, '..')
let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}
const targets = openTargets()
const other = targets.find((t) => t.id !== targets[0]!.id)
try {
  await app.getByTestId('composer').waitFor({ timeoutMs: 60_000 })
  await wait(1500)
  expect('the strip has Open in', (await app.getByTestId('open-in').count()) === 1)

  await app.getByTestId('open-in').click()
  await wait(400)
  expect('one click opens the note’s folder in the first app', opened().at(-1)?.target === targets[0]!.id && opened().at(-1)?.dir === workspace, JSON.stringify(opened().at(-1)))

  await app.getByTestId('open-in-menu-button').click()
  await app.getByTestId('open-in-menu').waitFor({ timeoutMs: 5_000 })
  await wait(700)
  const listed = await Promise.all(targets.map(async (t) => (await app.getByTestId(`open-in-${t.id}`).count()) === 1))
  expect('the menu lists every app found', listed.every(Boolean), targets.map((t) => t.name).join(', '))
  await shot('1-menu')
  if (other) {
    await app.getByTestId(`open-in-${other.id}`).click()
    await wait(500)
    expect(`picking ${other.name} opens the folder there`, opened().at(-1)?.target === other.id && Array.isArray(opened().at(-1)?.argv))
    expect('…and remembers it', settings().openIn === other.id)
    await app.getByTestId('open-in').click()
    await wait(400)
    expect('the button now opens there in one click', opened().at(-1)?.target === other.id && opened().length === 3, String(opened().length))
  }
} finally {
  await app.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
