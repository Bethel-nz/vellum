// Self-check for the image viewer (ui/ImageViewer.tsx): a note whose paragraph holds two pasted
// images, a small one and a large one. A click on a thumbnail opens it full size over the window:
// the small one at its own size, the large one fitted to the window. ← → step between them, and
// Esc, the ✕ and a click on the dark close it. The note is written straight to disk, since ⌘V
// can't reach a window that runs in the background. Shots go to screenshots/viewer-*.png.
//   bun scripts/check-viewer.ts
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launch } from '@gpuix/react/automation'

const home = mkdtempSync(path.join(tmpdir(), 'vellum-viewer-'))
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } }).exited
const id = '20261024-view01'
const small = path.resolve(import.meta.dir, '../assets/check-image.png') // 320×192
const large = path.resolve(import.meta.dir, '../assets/icon.png') // 1024×1024
const lines = [
  { type: 'vellum/meta', meta: { id, title: 'Two screenshots', profileId: 'main', workspace: path.resolve(import.meta.dir, '..'), createdAt: '2026-10-24T09:00:00.000Z' } },
  { type: 'vellum/user', text: 'What is in these two?', tags: [], at: '2026-10-24T09:00:01.000Z', images: [small, large] },
  { type: 'acp/update', update: { sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: 'A test card, and the app icon.' } } },
  { type: 'acp/end', stopReason: 'end_turn' },
]
writeFileSync(path.join(home, 'threads', `${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ lastThreadId: id }))

const app = await launch({ command: 'bun', args: ['app.tsx'], env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const shot = (n: string) => app.screenshot({ path: `screenshots/viewer-${n}.png` })
let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}
const open = () => app.getByTestId('image-viewer').count()
const count = () => app.getByTestId('image-viewer-count').textContent()
const size = async () => {
  const b = await app.getByTestId('image-viewer-image').bounds()
  return `${Math.round(b.width)}×${Math.round(b.height)}`
}

try {
  await app.getByTestId('composer').waitFor({ timeoutMs: 60_000 })
  await wait(2500)
  await shot('1-note')
  await app.getByTestId('user-image-0').click()
  await wait(700)
  expect('a click on a pasted image opens it', (await open()) === 1)
  expect('…the one clicked, of two', (await count()) === '1 of 2', await count())
  expect('…at its own size, since it fits', (await size()) === '320×192', await size())
  await shot('2-small')
  await app.getByTestId('image-viewer').press('right')
  await wait(600)
  const win = await app.getByTestId('image-viewer').bounds()
  const big = await app.getByTestId('image-viewer-image').bounds()
  expect('→ steps to the next', (await count()) === '2 of 2', await count())
  expect('…and a large one fits the window', big.height < win.height - 80 && big.width === big.height, `${await size()} in ${Math.round(win.width)}×${Math.round(win.height)}`)
  await shot('3-large')
  await app.getByTestId('image-viewer').press('right')
  await wait(400)
  expect('→ goes round to the first', (await count()) === '1 of 2', await count())
  await app.getByTestId('image-viewer').press('left')
  await wait(400)
  expect('← goes round to the last', (await count()) === '2 of 2', await count())
  await app.getByTestId('image-viewer').press('escape')
  await wait(400)
  expect('Esc closes it', (await open()) === 0)

  await app.getByTestId('user-image-1').click()
  await wait(500)
  await app.getByTestId('image-viewer-close').click()
  await wait(400)
  expect('the ✕ closes it', (await open()) === 0)
  await app.getByTestId('user-image-0').click()
  await wait(500)
  await app.mouse.click({ x: 40, y: 120 })
  await wait(400)
  expect('a click on the dark around it closes it', (await open()) === 0)
} finally {
  await app.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
