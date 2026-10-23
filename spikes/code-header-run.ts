// Screenshots spikes/code-header.tsx to screenshots/spike-code-header.png.
import { launch } from '@gpuix/react/automation'
const app = await launch({ command: 'bun', args: ['spikes/code-header.tsx'], env: { GPUIX_BACKGROUND: '1' } })
try {
  await app.getByTestId('md').waitFor({ timeoutMs: 30_000 })
  await new Promise((r) => setTimeout(r, 800))
  await app.screenshot({ path: 'screenshots/spike-code-header.png' })
} finally {
  await app.close()
}
