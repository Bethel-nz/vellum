// Self-check for context tokens: a paragraph with `#ui/theme.ts:3` reads with chips, hovering a
// file chip opens nothing under the paragraph (pressing it opens the file, see check-preview),
// replies carry no chip row, and `#` in the draft opens a files-only picker whose pick is written by
// its name alone (`#theme.ts`), the tag keeping its path. Writing elsewhere, the draft reads as
// chips; a chip opens its file, and a click beside it goes back to writing.
//   bun scripts/check-tokens.ts
import path from 'node:path'
import { launch } from '@gpuix/react/automation'
import { scratchDir } from './scratch'

const home = await scratchDir('vellum-tokens-')
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } }).exited
const workspace = path.resolve(import.meta.dir, '..')
const id = '20261023-tokens'
const at = '2026-10-23T15:00:00.000Z'
const log = path.join(home, 'threads', `${id}.jsonl`)
await Bun.write(log, [
    { type: 'vellum/meta', meta: { id, title: 'Tokens', profileId: 'main', workspace, createdAt: at } },
    { type: 'vellum/user', text: 'Is #ui/theme.ts:3 right? Compare #core/tags.ts', tags: [{ type: 'file', value: 'ui/theme.ts', line: 3 }, { type: 'file', value: 'core/tags.ts' }], at },
    { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'It is. See `ui/theme.ts` and `core/tags.ts:10`.' }] } },
    { type: 'result', subtype: 'success', result: 'It is.' },
  ]
    .map((r) => JSON.stringify(r))
    .join('\n') + '\n')
await Bun.write(path.join(home, 'settings.json'), JSON.stringify({ lastThreadId: id, openTabs: [id] }))

const app = await launch({ command: 'bun', args: ['app.tsx'], env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } })
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
  expect('hovering a file chip opens nothing under the paragraph', (await app.getByTestId('token-slice').count()) === 0)
  await shot('2-hover-line')

  expect('replies carry no chip row', (await app.getByTestId('mentions-a-1-0').count()) === 0)

  await c.click()
  await c.fill('Look at #theme')
  // The file index loads in the background on first use.
  const picker = await app.getByTestId('tag-0').waitFor({ timeoutMs: 8000 }).then(() => true, () => false)
  expect('# opens a files-only picker', picker)
  await shot('4-hash-picker')
  await c.press('tab')
  // drafts.json is written a moment after the draft changes.
  const draft = async (want: string) => {
    const text = async () => {
      try { return (JSON.parse(await Bun.file(path.join(home, 'drafts.json')).text())[id] ?? {}) as { text?: string; tags?: { value: string }[] } } catch { return {} }
    }
    for (let i = 0; i < 30 && !(await text()).text?.includes(want); i++) await wait(100)
    return (await text())
  }
  const picked = await draft('#theme.ts ')
  expect('the pick is written by its name alone', picked.text === 'Look at #theme.ts ' && picked.tags?.some((t) => t.value === 'ui/theme.ts') === true, JSON.stringify(picked))
  // The line number is typed after it.
  await c.fill('Look at #theme.ts:2 ')
  await wait(300)
  expect('while you write, the draft is plain text', (await app.getByTestId('draft-read').count()) === 0)
  await app.mouse.click({ x: 900, y: 150 })
  await wait(500)
  expect('writing elsewhere, the draft reads as chips', (await app.getByTestId('draft-chip-0').count()) === 1 && (await app.getByTestId('draft-chip-0').textContent()).includes('theme.ts:2'))
  await shot('5-draft-chip')
  await app.getByTestId('draft-chip-0').click()
  await wait(700)
  expect('a draft chip opens its file', (await app.getByTestId('file-preview-name').count()) === 1 && (await app.getByTestId('file-preview-name').textContent()) === 'theme.ts')
  await app.getByTestId('file-preview').press('escape')
  await wait(500)
  if (await app.getByTestId('draft-read').count()) {
    const r = await app.getByTestId('draft-read').bounds()
    await app.mouse.click({ x: r.x + r.width - 20, y: r.y + r.height / 2 })
    await wait(400)
  }
  expect('a click beside the chips goes back to writing', (await app.getByTestId('draft-read').count()) === 0)
} finally {
  await app.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
