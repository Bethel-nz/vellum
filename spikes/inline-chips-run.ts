// Launches spikes/inline-chips.tsx and screenshots it to screenshots/spike-inline-chips.png.
import { launch } from '@gpuix/react/automation'
const app = await launch({ command: 'bun', args: ['spikes/inline-chips.tsx'], env: { GPUIX_BACKGROUND: '1' } })
try {
  await app.getByTestId('wrap').waitFor({ timeoutMs: 30_000 })
  await new Promise((r) => setTimeout(r, 800))
  await app.screenshot({ path: 'screenshots/spike-inline-chips.png' })
} finally {
  await app.close()
}
