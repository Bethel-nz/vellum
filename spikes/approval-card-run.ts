// Launches spikes/approval-card.tsx and shoots each request to
// screenshots/spike-approval-<tag>-<n>.png, plus the Deny field open on the first one.
//   bun spikes/approval-card-run.ts [tag]      MATERIAL=light, AGENT=opencode, SPIKE_WINDOW=760x620 pass through
import { launch } from '@gpuix/react/automation'

const tag = process.argv[2] ?? 'now'
const app = await launch({ command: 'bun', args: ['spikes/approval-card.tsx'], env: { ...process.env, GPUIX_BACKGROUND: '1' } })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const press = (keys: string) => app.getByTestId('backdrop').press(keys)
try {
  await app.getByTestId('approval').waitFor({ timeoutMs: 30_000 })
  for (const n of [1, 2, 3, 4]) {
    await press(String(n))
    await wait(700)
    await app.screenshot({ path: `screenshots/spike-approval-${tag}-${n}.png` })
  }
  await press('1')
  await wait(400)
  await app.getByTestId('approval-deny').click()
  await wait(400)
  await app.screenshot({ path: `screenshots/spike-approval-${tag}-deny.png` })
  console.log(`screenshots/spike-approval-${tag}-{1,2,3,4,deny}.png`)
} finally {
  await app.close()
}
