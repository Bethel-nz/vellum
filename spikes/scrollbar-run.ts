// Screenshots spikes/scrollbar.tsx to screenshots/spike-scrollbar.png.
import { launch } from '@gpuix/react/automation'
const app = await launch({ command: 'bun', args: ['spikes/scrollbar.tsx'], env: { GPUIX_BACKGROUND: '1' } })
try {
  await app.getByTestId('root').waitFor({ timeoutMs: 30_000 })
  await new Promise((r) => setTimeout(r, 800))
  await app.screenshot({ path: 'screenshots/spike-scrollbar.png' })
} finally {
  await app.close()
}
