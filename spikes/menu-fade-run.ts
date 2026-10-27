// Spike: what paints while a dropdown opens? Opens the title menu and the model menu on the
// fixture and shoots frames at 0, 60, 150, 400 and 1200ms, so any extra fading panel shows.
//   bun spikes/menu-fade-run.ts
import path from 'node:path'
import { launch } from '@gpuix/react/automation'
import { scratchDir } from '../scripts/scratch'

const home = await scratchDir('vellum-fade-')
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home } }).exited
const app = await launch({ command: 'bun', args: ['app.tsx'], env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home } })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
try {
  await app.getByTestId('composer').waitFor({ timeoutMs: 60_000 })
  await wait(1000)
  for (const [trigger, name] of [['title-menu', 'title'], ['model-pill', 'model']] as const) {
    await app.getByTestId(trigger).click()
    let t = 0
    for (const at of [0, 60, 150, 400, 1200]) {
      await wait(at - t)
      t = at
      await app.screenshot({ path: `screenshots/spike-fade-${name}-${at}.png` })
    }
    await app.getByTestId(trigger).click()
    // and while it closes
    t = 0
    for (const at of [0, 40, 100, 200, 500]) {
      await wait(at - t)
      t = at
      await app.screenshot({ path: `screenshots/spike-fade-${name}-close-${at}.png` })
    }
    await wait(500)
  }
} finally {
  await app.close()
}
