// Self-check for the file preview (ui/FilePreview.tsx): a paragraph with three file chips, a line
// in a TypeScript file, a markdown file and one that's gone. Pressing the line chip opens the
// file beside the note, which narrows, with that line washed; the markdown chip swaps it for the
// rendered page, Source shows its text; the same chip again closes it; a missing file says why;
// Esc closes. In a narrow window it slides over the note instead. Dragging down the line numbers
// picks lines, ⇧-click stretches the pick, Esc clears it, and "Add to note" (or ↵) puts a
// `#core/printed.ts:20-24` chip on the end of the draft. Shots: screenshots/preview-*.png.
//   bun scripts/check-preview.ts
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launch } from '@gpuix/react/automation'

const home = mkdtempSync(path.join(tmpdir(), 'vellum-preview-'))
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } }).exited
const id = '20261024-prev01'
const workspace = path.resolve(import.meta.dir, '..')
const tags = [
  { type: 'file', value: 'core/printed.ts', line: 18 },
  { type: 'file', value: 'MOTION-CONTRACT.md' },
  { type: 'file', value: 'core/gone.ts' },
]
const lines = [
  { type: 'vellum/meta', meta: { id, title: 'Read some files', profileId: 'main', workspace, createdAt: '2026-10-24T09:00:00.000Z' } },
  { type: 'vellum/user', text: 'Why does #core/printed.ts:18 work this way, given #MOTION-CONTRACT.md and #core/gone.ts?', tags, at: '2026-10-24T09:00:01.000Z' },
  { type: 'acp/update', update: { sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: 'It takes the last step only.' } } },
  { type: 'acp/end', stopReason: 'end_turn' },
]
writeFileSync(path.join(home, 'threads', `${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ lastThreadId: id }))

let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function run(size: string, wide: boolean) {
  const app = await launch({ command: 'bun', args: ['app.tsx'], env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home'), VELLUM_WINDOW: size } })
  const shot = (n: string) => app.screenshot({ path: `screenshots/preview-${n}.png` })
  const count = (t: string) => app.getByTestId(t).count()
  try {
    await app.getByTestId('composer').waitFor({ timeoutMs: 60_000 })
    await wait(2000)
    const before = await app.getByTestId('page').bounds()
    await app.getByTestId('chip-0').click()
    await wait(700)
    expect(`${size}: a file chip opens the file`, (await count('file-preview')) === 1 && (await app.getByTestId('file-preview-name').textContent()) === 'printed.ts')
    expect(`${size}: …not the paragraph's editor`, (await count('read-' + (await firstUserBlock(app)))) === 1)
    const pane = await app.getByTestId('file-preview').bounds()
    const page = await app.getByTestId('page').bounds()
    if (wide) expect(`${size}: the note narrows beside it`, page.width < before.width - 300 && page.x + page.width <= pane.x + 1, `page ${Math.round(page.width)} of ${Math.round(before.width)}, pane at ${Math.round(pane.x)}`)
    else expect(`${size}: it slides over the note`, Math.round(page.width) === Math.round(before.width) && pane.x < page.x + page.width)
    if (!wide) return await shot('narrow')
    expect(`${size}: the chip's line is washed`, (await count('file-preview-line')) === 1)
    await shot('1-code')

    // A row's middle, from the gutter's painted top: every row is 18 high.
    const g = await app.getByTestId('file-preview-gutter').bounds()
    const row = (n: number) => ({ x: g.x + g.width / 2, y: g.y + (n - 1) * 18 + 9 })
    const picked = () => app.getByTestId('file-preview-picked').textContent()
    // Off to the right of the numbers on the way: the pick still follows.
    await app.mouse.drag(row(20), { x: g.x + 200, y: row(24).y })
    await wait(400)
    expect('dragging down the line numbers picks lines', (await picked()) === 'Lines 20–24' && (await count('file-preview-pick')) === 1, await picked())
    await shot('4-pick')
    await app.getByTestId('file-preview-mention').click()
    await wait(500)
    // drafts.json is written a moment after the draft changes: wait for what's expected.
    const draftText = () => {
      try { return (JSON.parse(readFileSync(path.join(home, 'drafts.json'), 'utf8'))[id]?.text ?? '') as string } catch { return '' }
    }
    const draft = async (want: string) => {
      for (let i = 0; i < 30 && !draftText().includes(want); i++) await wait(100)
      return draftText()
    }
    expect('"Add to note" puts the lines on the draft', (await draft('#core/printed.ts:20-24')).includes('#core/printed.ts:20-24'), draftText())
    expect('…and clears the pick', (await count('file-preview-mention-bar')) === 0)
    await shot('5-mentioned')

    await app.mouse.click(row(22))
    await wait(300)
    await app.mouse.click(row(19), { modifiers: 'shift' })
    await wait(300)
    expect('⇧-click stretches the pick, up too', (await picked()) === 'Lines 19–22', await picked())
    await app.getByTestId('file-preview').press('escape')
    await wait(300)
    expect('Esc clears a pick first', (await count('file-preview-mention-bar')) === 0 && (await count('file-preview')) === 1)
    await app.mouse.click(row(21))
    await wait(300)
    await app.getByTestId('file-preview').press('enter')
    await wait(500)
    expect('↵ adds one line', (await draft('#core/printed.ts:21 ')).includes('#core/printed.ts:21 '), draftText())

    await app.getByTestId('chip-1').click()
    await wait(700)
    expect('the markdown chip swaps it for the rendered page', (await count('file-preview-markdown')) === 1 && (await app.getByTestId('file-preview-name').textContent()) === 'MOTION-CONTRACT.md')
    await shot('2-markdown')
    await app.getByTestId('file-preview-mode-source').click()
    await wait(500)
    expect('Source shows its text', (await count('file-preview-code')) === 1)
    await app.getByTestId('chip-1').click()
    await wait(500)
    expect('the same chip again closes it', (await count('file-preview')) === 0)

    await app.getByTestId('chip-2').click()
    await wait(600)
    expect('a missing file says why', (await count('file-preview-unavailable')) === 1)
    await shot('3-missing')
    await app.getByTestId('file-preview').press('escape')
    await wait(500)
    expect('Esc closes it', (await count('file-preview')) === 0)
    expect('…and the note has its width back', Math.round((await app.getByTestId('page').bounds()).width) === Math.round(before.width))
  } finally {
    await app.close()
  }
}

async function firstUserBlock(app: Awaited<ReturnType<typeof launch>>) {
  const ids = (await app.getByType('div').all()).map((n) => n.testId ?? '').filter((t) => t.startsWith('read-'))
  return ids[0]?.slice(5) ?? ''
}

await run('1280x800', true)
await run('900x700', false)
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
