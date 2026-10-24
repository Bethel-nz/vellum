// Self-check for "Open in", in the file pane's header (it left the strip): it lists this Mac's apps
// with their icons, opens the file the pane opened on (or the note's folder) in the one you pick, remembers
// it, and the button then opens there in one click. With a file open, an editor gets the file and
// Finder shows it. Nothing is really opened: VELLUM_OPEN_LOG records what would be.
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
  expect('the strip has no Open in', (await app.getByTestId('open-in').count()) === 0)
  await app.getByTestId('open-files').click()
  await app.getByTestId('file-tree').waitFor({ timeoutMs: 5_000 })
  await wait(600)
  expect('the file pane has it', (await app.getByTestId('open-in').count()) === 1)

  // The pane opens on the file the note changed last (the fixture's ui/theme.ts): an editor gets
  // that file, Finder shows it, anything else the note's folder.
  const changed = path.join(workspace, 'ui/theme.ts')
  const gets = (t: (typeof targets)[number], o?: { dir?: string; reveal?: string }) => (t.kind === 'files' ? o?.reveal === changed : o?.dir === (t.kind === 'editor' ? changed : workspace))
  await app.getByTestId('open-in').click()
  await wait(400)
  expect(`one click opens it in the first app, ${targets[0]!.name}`, (targets[0]!.kind === 'files' || opened().at(-1)?.target === targets[0]!.id) && gets(targets[0]!, opened().at(-1)), JSON.stringify(opened().at(-1)))

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
  await app.getByTestId('file-tree-row-NOTES.md').click()
  await wait(600)
  const editor = targets.find((t) => t.kind === 'editor')
  if (editor) {
    await app.getByTestId('open-in-menu-button').click()
    await app.getByTestId('open-in-menu').waitFor({ timeoutMs: 5_000 })
    await wait(500)
    await app.getByTestId(`open-in-${editor.id}`).click()
    await wait(400)
    expect(`with a file open, ${editor.name} gets the file`, opened().at(-1)?.dir === path.join(workspace, 'NOTES.md'), JSON.stringify(opened().at(-1)))
  }
  const finder = targets.find((t) => t.kind === 'files')
  if (finder) {
    await app.getByTestId('open-in-menu-button').click()
    await app.getByTestId('open-in-menu').waitFor({ timeoutMs: 5_000 })
    await wait(500)
    await app.getByTestId(`open-in-${finder.id}`).click()
    await wait(400)
    expect(`…and ${finder.name} shows it`, opened().at(-1)?.reveal === path.join(workspace, 'NOTES.md'), JSON.stringify(opened().at(-1)))
  }
} finally {
  await app.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
