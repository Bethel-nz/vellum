// Self-check for the full-height terminal pane: "Open in Claude Code" on an existing thread.
//   bun scripts/check-pane.ts <VELLUM_HOME with a thread that has a session>
import { launch } from '@gpuix/react/automation'
const app = await launch({ command: 'bun', args: ['app.tsx'], env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: process.argv[2]! } })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
await app.getByTestId('composer').waitFor({ timeoutMs: 60_000 })
await app.getByTestId('open-claude').click()
await wait(6000)
await app.screenshot({ path: 'screenshots/pane-claude.png' })
await app.getByTestId('close-pane').click()
await wait(800)
console.log('composer back:', (await app.getByTestId('composer').count()) === 1)
await app.close()
