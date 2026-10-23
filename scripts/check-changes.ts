// Self-check for the Changes sheet: the strip shows how many files Claude changed, ⇧⌘D opens
// the sheet, a file row opens to its hunks, selecting a hunk updates the count, and "Add" puts a
// ```diff paragraph in the draft.
//   bun scripts/check-changes.ts
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launch } from '@gpuix/react/automation'

const home = mkdtempSync(path.join(tmpdir(), 'vellum-changes-'))
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home } }).exited
const app = await launch({ command: 'bun', args: ['app.tsx'], env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home } })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const shot = (n: string) => app.screenshot({ path: 'screenshots/changes-' + n + '.png' })
const ids = async (prefix: string) => (await app.getByType('div').all()).map((n) => n.testId ?? '').filter((id) => id.startsWith(prefix))
let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}

try {
  const c = app.getByTestId('composer')
  await c.waitFor({ timeoutMs: 60_000 })
  await wait(1000)
  expect('the strip counts changed files', (await app.getByTestId('open-changes').count()) === 1)

  await c.press('cmd-shift-d')
  await app.getByTestId('changes').waitFor({ timeoutMs: 3000 })
  await wait(600)
  expect('⇧⌘D opens Changes', (await app.getByTestId('change-ui/theme.ts').count()) === 1)
  await app.getByTestId('change-ui/theme.ts').click()
  await wait(500)
  const hunks = await ids('hunk-')
  expect('the row opens to its hunks', hunks.length >= 1, `${hunks.length}`)
  await app.getByTestId(hunks[0]!).click()
  await wait(300)
  expect('selecting counts it', (await app.getByTestId('changes-count').textContent()).startsWith('1 of'))
  await shot('1-selected')
  await app.getByTestId('changes-add').click()
  await wait(900)
  expect('Add closes the sheet', (await app.getByTestId('changes').count()) === 0)
  const drafts = JSON.parse(readFileSync(path.join(home, 'drafts.json'), 'utf8'))
  const text = Object.values(drafts).map((d: any) => d.text).join('\n')
  expect('the hunk is in the draft as a diff fence', text.includes('Keep exactly these changes:') && text.includes('```diff') && text.includes('+++ b/ui/theme.ts'))
  await shot('2-draft')
} finally {
  await app.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
