// Spike 1 driver: type, press Enter (expect newline), press Ctrl+Enter (expect send, no newline).
import { launch } from '@gpuix/react/automation'

const app = await launch({ command: 'bun', args: ['spikes/ctrl-enter-app.tsx'], env: { GPUIX_BACKGROUND: '1' } })
const composer = app.getByTestId('composer')
await composer.waitFor({ timeoutMs: 60_000 })
await composer.click()
await composer.fill('hello')
await composer.press('enter')
await composer.press('w')
console.log('after enter :', await app.getByTestId('readout').textContent())
await composer.press('ctrl-enter')
await new Promise((r) => setTimeout(r, 300))
console.log('after ctrl+enter:', await app.getByTestId('readout').textContent())
await app.close()
