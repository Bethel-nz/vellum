// Screenshots spikes/nerd-icons.tsx to screenshots/spike-nerd-icons.png.
import { launch } from '@gpuix/react/automation'
const app = await launch({ command: 'bun', args: ['spikes/nerd-icons.tsx'], env: { GPUIX_BACKGROUND: '1' } })
try {
  await app.getByTestId('grid').waitFor({ timeoutMs: 30_000 })
  await new Promise((r) => setTimeout(r, 800))
  await app.screenshot({ path: 'screenshots/spike-nerd-icons.png' })
} finally {
  await app.close()
}
