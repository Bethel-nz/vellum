// Self-check for the full-height terminal pane: "Open in Claude Code" on an existing thread.
//   bun scripts/check-pane.ts <VELLUM_HOME with a thread that has a session>
import { launch } from '@gpuix/react/automation'
import path from 'node:path'
// Without its argument this would run against the real ~/.vellum.
const home = process.argv[2]
if (!home) {
  console.error('usage: bun scripts/check-pane.ts <VELLUM_HOME with a thread that has a session>')
  process.exit(2)
}
const app = await launch({ command: 'bun', args: ['app.tsx'], env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: path.resolve(home), VELLUM_CLAUDE_HOME: path.resolve(home, 'claude-home') } })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
await app.getByTestId('composer').waitFor({ timeoutMs: 60_000 })
await app.getByTestId('title-menu').click()
await new Promise((r) => setTimeout(r, 1500))
await app.getByTestId('menu-open-claude').click()
await wait(6000)
await app.screenshot({ path: 'screenshots/pane-claude.png' })
// Close it with its tab's ✕ (the terminal view has no header of its own).
const closeId = (await app.getByType('div').all()).map((n) => n.testId ?? '').find((id) => id.startsWith('close-term-'))!
await app.getByTestId(closeId).click()
await wait(800)
console.log('composer back:', (await app.getByTestId('composer').count()) === 1)
await app.close()
