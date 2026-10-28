// Self-check for following a streaming reply (ui/glide.ts `followStreaming`), against
// scripts/fake-acp.ts: a reply taller than the window ("overflow") keeps the note's end, the
// composer, in view while it streams, whether the note sat on its end or a little above it
// when you sent. Scrolled well up to read, the note is left where you put it.
//   bun scripts/check-follow.ts
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
const until = async (ok: () => Promise<boolean> | boolean, ms = 10_000) => {
  const start = Date.now()
  while (!(await ok()) && Date.now() - start < ms) await wait(150)
  return ok()
}
const count = (id: string) => app.getByTestId(id).count()
let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}
const c = app.getByTestId('composer')
/** The composer's top inside the page, or undefined while it isn't painted there. */
const composerY = async () => {
  const page = await app.getByTestId('page').bounds()
  const b = await c.bounds().catch(() => undefined)
  return b && b.y + b.height > page.y && b.y < page.y + page.height ? Math.round(b.y - page.y) : undefined
}
const wheel = async (dy: number) => {
  const page = await app.getByTestId('page').bounds()
  await app.mouse.wheel({ x: page.x + page.width / 2, y: page.y + page.height / 2 }, 0, dy)
}
/** Sends a reply taller than the window and samples the composer until the turn ends. */
const stream = async (before?: () => Promise<void>) => {
  await c.fill('stream an overflow answer')
  await c.press('cmd-enter')
  await until(async () => (await count('stop')) === 1)
  await before?.()
  const ys: (number | undefined)[] = []
  while ((await count('stop')) === 1) {
    ys.push(await composerY())
    await wait(250)
  }
  await wait(600)
  ys.push(await composerY())
  return ys
}
/** After a beat for the glide to land: every sample the same, and on screen. */
const steady = (ys: (number | undefined)[]) => {
  const settled = ys.slice(3)
  return settled.length > 10 && settled.every((y) => y !== undefined) && Math.max(...(settled as number[])) - Math.min(...(settled as number[])) <= 28
}

try {
  await c.waitFor({ timeoutMs: 60_000 })
  await wait(2500)

  const pinned = await stream()
  expect('sent from the end, the composer stays in view while it streams', steady(pinned), JSON.stringify(pinned))

  const near = await stream(async () => {
    await wheel(140)
    await wait(200)
  })
  expect('sent a little above the end, it comes down and stays in view', steady(near), JSON.stringify(near))

  const reading = await stream(async () => {
    await wait(400)
    for (let i = 0; i < 3; i++) await wheel(400)
    await wait(300)
  })
  expect('scrolled up to read, the note is left there', reading.slice(2, -1).every((y) => y === undefined), JSON.stringify(reading))
} finally {
  await app.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
