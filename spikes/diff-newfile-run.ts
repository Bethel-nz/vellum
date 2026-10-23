// Screenshots spikes/diff-newfile.tsx to screenshots/spike-diff-newfile.png.
import { launch } from '@gpuix/react/automation'
const app = await launch({ command: 'bun', args: ['spikes/diff-newfile.tsx'], env: { GPUIX_BACKGROUND: '1' } })
try {
  await app.getByTestId('root').waitFor({ timeoutMs: 30_000 })
  await new Promise((r) => setTimeout(r, 800))
  await app.screenshot({ path: 'screenshots/spike-diff-newfile.png' })
} finally {
  await app.close()
}
