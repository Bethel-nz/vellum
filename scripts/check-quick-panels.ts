// Verification for the translated panels: pure state/geometry + live GPUIX open/close.
//   bun scripts/check-quick-panels.ts
import path from 'node:path'
import { launch } from '@gpuix/react/automation'
import { scratchDir } from './scratch'

let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}

// Pure invariants run first: no window needed.
const core = await import('../core/panels')
{
  let s = core.initialPanel()
  s = core.reducePanel(s, { type: 'SET_DRAFT', draft: 'keep me' })
  s = core.reducePanel(s, { type: 'OPEN_INLINE' })
  s = core.reducePanel(s, { type: 'OPEN_FLOATING' })
  expect('draft survives inline->floating', s.draft === 'keep me' && s.mode === 'floating')
  const pinned = core.reducePanel(core.reducePanel(s, { type: 'STREAM_START' }), { type: 'OUTSIDE' })
  expect('streaming pins panel open', pinned.mode === 'floating')
  const low = core.placeInline({ x: 100, y: 600, width: 40, height: 20 }, { width: 1000, height: 700 })
  expect('inline flips above a low anchor', low.side === 'top')
  const c = core.clampFloating({ x: -999, y: -999, width: 400, height: 480 }, { width: 1000, height: 700 })
  expect('floating clamps into the window', c.x === 12 && c.y === 12)
}

const home = await scratchDir('vellum-panels-')
const app = await launch({
  command: 'bun',
  args: ['spikes/quick-panels-app.tsx'],
  env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home },
})
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const count = (id: string) => app.getByTestId(id).count()
try {
  await app.getByTestId('open-inline').waitFor({ timeoutMs: 30_000 })
  await wait(600)

  await app.getByTestId('draft').fill('Explain this selection in one line')
  await wait(300)
  await app.getByTestId('open-inline').click()
  await wait(600)
  expect('inline opens', (await count('quick-inline')) >= 1)
  await app.screenshot({ path: 'screenshots/panels-inline.png' })

  // Outside press closes inline (click the empty corner of the demo).
  await app.mouse.click({ x: 840, y: 600 })
  await wait(400)
  expect('inline closes on outside press', (await count('quick-inline')) === 0)

  await app.getByTestId('open-floating').click()
  await wait(600)
  expect('floating opens', (await count('quick-floating')) >= 1)
  await app.screenshot({ path: 'screenshots/panels-floating-launcher.png' })

  // Outside press must NOT close floating.
  await app.mouse.click({ x: 840, y: 600 })
  await wait(400)
  expect('floating survives outside press', (await count('quick-floating')) >= 1)

  await app.getByTestId('quick-floating-expand').click()
  await wait(600)
  await app.screenshot({ path: 'screenshots/panels-floating-thread.png' })
  expect('floating expands', (await count('quick-floating')) >= 1)

  // Rapid toggle: 10x open/close ends closed, then still opens.
  for (let i = 0; i < 10; i++) {
    if (i % 2) await app.getByTestId('close-panels').click()
    else await app.getByTestId('open-floating').click()
    await wait(80)
  }
  await wait(400)
  expect('ten rapid toggles end closed', (await count('quick-floating')) === 0, `${await count('quick-floating')}`)
  await app.getByTestId('open-floating').click()
  await wait(500)
  expect('floating still opens after rapid toggles', (await count('quick-floating')) >= 1)

  await app.getByTestId('quick-floating-close').click()
  await wait(400)
  expect('floating closes on close button', (await count('quick-floating')) === 0)

  // Escape closes inline too.
  await app.getByTestId('open-inline').click()
  await wait(500)
  await app.getByTestId('quick-inline').press('escape')
  await wait(400)
  expect('inline closes on Escape', (await count('quick-inline')) === 0)
} finally {
  await app.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
