// Self-check for the Help note (core/help.ts, ui/Help.tsx): a first launch with no notes opens on
// it; Past notes doesn't list it; writing in it starts a new note with what you wrote; the Help
// button brings it back; a later launch doesn't open it by itself; and with nine notes open it
// still opens, as a tenth tab.
//   bun scripts/check-help.ts
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launch } from '@gpuix/react/automation'

const home = mkdtempSync(path.join(tmpdir(), 'vellum-help-'))
const env = { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') }
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, ...env } }).exited
// A first launch: the accounts, and no notes yet.
const threadsDir = path.join(home, 'threads')
for (const f of readdirSync(threadsDir)) rmSync(path.join(threadsDir, f))
rmSync(path.join(home, 'settings.json'), { force: true })

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const until = async (ok: () => Promise<boolean> | boolean, ms = 8000) => {
  const start = Date.now()
  while (!(await ok()) && Date.now() - start < ms) await wait(150)
  return ok()
}
const settings = () => (existsSync(path.join(home, 'settings.json')) ? JSON.parse(readFileSync(path.join(home, 'settings.json'), 'utf8')) : {})
let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}

let app = await launch({ command: 'bun', args: ['app.tsx'], env })
let count = (id: string) => app.getByTestId(id).count()
try {
  expect('a first launch opens on the Help note', await until(async () => (await count('help')) === 1, 60_000))
  expect('…in a tab of its own', (await count('tab-vellum-help')) === 1)
  expect('…once: it is marked shown', await until(() => settings().helpShown === true))
  await app.screenshot({ path: 'screenshots/help-1-first.png' })

  await app.getByTestId('open-history').click()
  await app.getByTestId('history').waitFor({ timeoutMs: 5000 })
  await wait(400)
  expect('Past notes doesn’t list it', (await count('history-vellum-help')) === 0 && !readdirSync(threadsDir).some((f) => f.includes('help')))
  await app.getByTestId('history-input').press('escape')
  await wait(400)

  // Nothing in it can be edited: writing in it starts a note with what you wrote.
  await app.getByTestId('help-write').fill('hello from help')
  const notes = () => readdirSync(threadsDir).filter((f) => f.endsWith('.jsonl'))
  expect('writing in it starts a new note', await until(() => notes().length === 1) && (await until(async () => (await count('composer')) === 1)))
  const drafts = () => (existsSync(path.join(home, 'drafts.json')) ? JSON.parse(readFileSync(path.join(home, 'drafts.json'), 'utf8')) : {})
  const id = notes()[0]?.replace('.jsonl', '')
  expect('…with what you wrote in its draft', await until(() => drafts()[id ?? '']?.text === 'hello from help'), JSON.stringify(drafts()[id ?? '']))
  expect('…and Help stays a tab beside it', (await count('tab-vellum-help')) === 1)

  // The new note is the active tab now; the strip's Help button goes back.
  await wait(300)
  await app.getByTestId('open-help').click()
  expect('the Help button brings it back', await until(async () => (await count('help')) === 1))

  // It has no note menu: no chevron, and its ✕ shows without a hover.
  await wait(400)
  expect('its tab has no menu chevron', (await count('title-menu')) === 0)
  expect('…but its own ✕', (await count('close-vellum-help')) === 1)
  await app.screenshot({ path: 'screenshots/help-3-tab.png' })
  await app.getByTestId('close-vellum-help').click()
  expect('the ✕ dismisses it', await until(async () => (await count('help')) === 0 && (await count('tab-vellum-help')) === 0))
  expect('…back to the note', await until(async () => (await count('composer')) === 1))
} finally {
  await app.close()
}

// A later launch: there are notes, and Help has been shown. It doesn't open by itself.
writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ ...settings(), openTabs: [], lastThreadId: undefined }))
app = await launch({ command: 'bun', args: ['app.tsx'], env })
count = (id: string) => app.getByTestId(id).count()
try {
  await app.getByTestId('composer').waitFor({ timeoutMs: 60_000 })
  await wait(800)
  expect('a later launch doesn’t open it by itself', (await count('help')) === 0 && (await count('tab-vellum-help')) === 0)
} finally {
  await app.close()
}

// Nine notes open: Help still opens, as a tenth tab, and closes nothing.
const ids: string[] = []
for (let i = 0; i < 9; i++) {
  const nid = `20261024-full0${i}`
  ids.push(nid)
  const meta = { id: nid, title: `Note ${i + 1}`, profileId: 'main', workspace: path.resolve(import.meta.dir, '..'), createdAt: `2026-10-24T09:0${i}:00.000Z` }
  writeFileSync(path.join(threadsDir, `${nid}.jsonl`), JSON.stringify({ type: 'vellum/meta', meta }) + '\n')
}
writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ ...settings(), openTabs: ids, lastThreadId: ids[0] }))
app = await launch({ command: 'bun', args: ['app.tsx'], env })
count = (id: string) => app.getByTestId(id).count()
try {
  await app.getByTestId('composer').waitFor({ timeoutMs: 60_000 })
  await wait(800)
  const tabs = async () => (await app.getByType('div').all()).map((n) => n.testId ?? '').filter((t) => /^tab-(2026|vellum)/.test(t))
  expect('nine notes are open', (await tabs()).length === 9, `${(await tabs()).length}`)
  await app.getByTestId('open-help').click()
  expect('with nine open, Help still opens', await until(async () => (await count('help')) === 1))
  expect('…as a tenth tab, closing none', (await tabs()).length === 10, (await tabs()).join(','))
  await app.screenshot({ path: 'screenshots/help-2-tenth.png' })
} finally {
  await app.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
