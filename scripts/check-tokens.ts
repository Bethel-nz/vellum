// Self-check for context tokens: a paragraph with `#ui/theme.ts:3` reads with chips, hovering
// opens that exact line, "Read whole file" records the widening, a reply's file mentions get a
// chip row, and `#` in the draft opens a files-only picker whose pick becomes a chip.
//   bun scripts/check-tokens.ts
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launch } from '@gpuix/react/automation'

const home = mkdtempSync(path.join(tmpdir(), 'vellum-tokens-'))
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home } }).exited
const workspace = path.resolve(import.meta.dir, '..')
const id = '20261023-tokens'
const at = '2026-10-23T15:00:00.000Z'
const line3 = readFileSync(path.join(workspace, 'ui/theme.ts'), 'utf8').split('\n')[2]!
const log = path.join(home, 'threads', `${id}.jsonl`)
writeFileSync(
  log,
  [
    { type: 'vellum/meta', meta: { id, title: 'Tokens', profileId: 'main', workspace, createdAt: at } },
    { type: 'vellum/user', text: 'Is #ui/theme.ts:3 right? Compare #core/tags.ts', tags: [{ type: 'file', value: 'ui/theme.ts', line: 3 }, { type: 'file', value: 'core/tags.ts' }], at },
    { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'It is. See `ui/theme.ts` and `core/tags.ts:10`.' }] } },
    { type: 'result', subtype: 'success', result: 'It is.' },
  ]
    .map((r) => JSON.stringify(r))
    .join('\n') + '\n',
)
writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ lastThreadId: id, openTabs: [id] }))

const app = await launch({ command: 'bun', args: ['app.tsx'], env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home } })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const shot = (n: string) => app.screenshot({ path: 'screenshots/tokens-' + n + '.png' })
let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}

try {
  const c = app.getByTestId('composer')
  await c.waitFor({ timeoutMs: 60_000 })
  await wait(1200)
  expect('paragraph reads with chips', (await app.getByTestId('chip-0').count()) === 1 && (await app.getByTestId('chip-1').count()) === 1)
  await shot('1-chips')

  await app.getByTestId('chip-0').hover()
  await wait(500)
  const slice = app.getByTestId('token-slice')
  expect('hover opens the slice', (await slice.count()) === 1)
  const text = (await slice.count()) ? await slice.textContent() : ''
  expect('slice shows line 3 with its number', text.includes('3') && text.includes(line3.trim().slice(0, 20)), JSON.stringify(text.slice(0, 60)))
  await shot('2-hover-line')

  await app.getByTestId('token-widen').click()
  await wait(500)
  expect('Read whole file is recorded', readFileSync(log, 'utf8').includes('"vellum/tag-scope"'))
  await shot('3-widened')
  await app.mouse.move({ x: 900, y: 700 })
  await wait(500)
  expect('leaving closes the slice', (await app.getByTestId('token-slice').count()) === 0)

  expect('reply mentions get chips', (await app.getByTestId('mentions-a-1-0').count()) === 1)

  await c.click()
  await c.fill('Look at #theme')
  // The file index loads in the background on first use.
  const picker = await app.getByTestId('tag-0').waitFor({ timeoutMs: 8000 }).then(() => true, () => false)
  expect('# opens a files-only picker', picker)
  await shot('4-hash-picker')
  await c.press('tab')
  await wait(300)
  // The pick wrote `#ui/theme.ts `; the line number is typed after it.
  await c.fill('Look at #ui/theme.ts:2 ')
  await wait(500)
  expect('the pick becomes a draft chip', (await app.getByTestId('draft-chips-0').count()) === 1)
  await shot('5-draft-chip')
} finally {
  await app.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
