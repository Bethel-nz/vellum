// Shoots spikes/fade-square.tsx at 0, 30, 90, 150 and 400ms after the boxes mount, on a paused
// clock, to screenshots/spike-fade-square-<ms>.png.
import { launch } from '@gpuix/react/automation'
const app = await launch({ command: 'bun', args: ['spikes/fade-square.tsx'], env: { GPUIX_BACKGROUND: '1' } })
try {
  await app.getByTestId('root').waitFor({ timeoutMs: 30_000 })
  await new Promise((r) => setTimeout(r, 800))
  await app.clock.pause()
  await app.getByTestId('go').click()
  let at = 0
  for (const t of [0, 30, 90, 150, 400]) {
    await app.clock.fastForward(t - at)
    at = t
    await app.screenshot({ path: `screenshots/spike-fade-square-${t}.png` })
  }
} finally {
  await app.close()
}
