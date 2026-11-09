// Scratch repro: does the note follow the tail while the model streams?
// Measures the composer's viewport-relative y during a streamed turn.
// Stable y = following; growing y = content pushes past, no follow.
import path from 'node:path'
import { launch } from '@gpuix/react/automation'
import { scratchDir } from './scratch'

const home = await scratchDir('vellum-follow-')
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } }).exited
const app = await launch({
  command: 'bun',
  args: ['app.tsx'],
  env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home'), VELLUM_AGENT: path.resolve(import.meta.dir, 'fake-acp.ts') },
})
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
try {
  const c = app.getByTestId('composer')
  await c.waitFor({ timeoutMs: 60_000 })
  await wait(2500)
  const y0 = (await c.bounds()).y
  console.log('composer y before send:', y0)
  await c.fill('stream a long answer')
  await c.press('cmd-enter')
  await wait(800)
  const ys: number[] = []
  for (let i = 0; i < 60; i++) {
    try {
      ys.push(Math.round((await c.bounds()).y))
    } catch {
      ys.push(-1)
    }
    await wait(500)
  }
  console.log('composer y during stream:', JSON.stringify(ys))
  const moved = Math.max(...ys) - Math.min(...ys.filter((y) => y >= 0))
  console.log(moved > 4 ? 'NOT FOLLOWING (composer pushed down)' : 'FOLLOWING (composer steady)')
} finally {
  await app.close()
}
