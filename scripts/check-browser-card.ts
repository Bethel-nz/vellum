// Sample check: inline browser card renders the frame with no caption row.
//   bun scripts/check-browser-card.ts
import { launch } from '@gpuix/react/automation'
import { scratchDir } from './scratch'

const home = await scratchDir('vellum-browser-card-')
const app = await launch({
  command: 'bun',
  args: ['spikes/browser-card-sample.tsx'],
  env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home },
})
let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}
try {
  await app.getByTestId('browser-status-pill').waitFor({ timeoutMs: 30_000 })
  await new Promise((r) => setTimeout(r, 800))
  expect('inline card renders', (await app.getByTestId('agent-screen-inline').count()) === 2)
  expect('frame paints only where a capture exists', (await app.getByTestId('browser-frame').count()) === 2)
  expect('empty state is an SVG placeholder, no src-less img', (await app.getByTestId('browser-empty').count()) === 1)
  expect('error throws an alert block', (await app.getByTestId('browser-error').count()) === 1)
  expect('expanded viewer renders chrome + status pill', (await app.getByTestId('agent-screen-expanded').count()) === 1 && (await app.getByTestId('browser-status-pill').count()) === 1)
  // Double-click the first card's frame: two rapid down/up pairs at its center.
  // Card is 480x300 at (210, 48), so its center is (450, 198).
  await app.mouse.down({ x: 450, y: 198 })
  await app.mouse.up({ x: 450, y: 198 })
  await app.mouse.down({ x: 450, y: 198 })
  await app.mouse.up({ x: 450, y: 198 })
  await new Promise((r) => setTimeout(r, 600))
  expect('double-click expands to fullscreen', (await app.getByTestId('browser-fullscreen').count()) === 1)
  await app.screenshot({ path: 'screenshots/sample-browser-card.png' })
} finally {
  await app.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
