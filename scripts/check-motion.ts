// Self-check for the GPUIX motion rules (NOTES.md, "GPUIX motion reality"): every shadowed popup
// closes instantly (nothing left fading with its shadow), ten rapid toggles leave nothing behind,
// and with Reduce motion on everything still opens and closes. Frames of each opening and closing
// are shot on a paused clock (0–260ms) into screenshots/motion-<mode>-*, to look at by eye.
//   bun scripts/check-motion.ts            (full motion)
//   MOTION=reduce bun scripts/check-motion.ts
import path from 'node:path'
import { launch } from '@gpuix/react/automation'
import { scratchDir } from './scratch'

const mode = process.env.MOTION === 'reduce' ? 'reduce' : 'full'
const home = await scratchDir('vellum-motion-')
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } }).exited
const settings = path.join(home, 'settings.json')
await Bun.write(settings, JSON.stringify({ ...JSON.parse(await Bun.file(settings).text()), motion: mode }))

const app = await launch({
  command: 'bun',
  args: ['app.tsx'],
  env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home'), VELLUM_AGENT: path.resolve(import.meta.dir, 'fake-acp.ts') },
})
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}
const count = (id: string) => app.getByTestId(id).count()

/** Runs `act` on a paused clock and shoots the frames after it. */
async function frames(name: string, act: () => Promise<void>, times = [0, 40, 80, 120, 180, 260]) {
  await app.clock.pause()
  await act()
  let at = 0
  for (const t of times) {
    await app.clock.fastForward(t - at)
    at = t
    await app.screenshot({ path: `screenshots/motion-${mode}-${name}-${String(t).padStart(3, '0')}.png` })
  }
  await app.clock.resume()
  await wait(300)
}

type Surface = { name: string; panel: string; open: () => Promise<void>; close: () => Promise<void> }
const c = app.getByTestId('composer')
const surfaces: Surface[] = [
  { name: 'model-menu', panel: 'model-menu', open: () => app.getByTestId('model-pill').click(), close: () => app.getByTestId('model-pill').click() },
  { name: 'mode-menu', panel: 'mode-menu', open: () => app.getByTestId('mode-pill').click(), close: () => app.getByTestId('mode-pill').click() },
  { name: 'context-card', panel: 'context-card', open: () => app.getByTestId('context-pill').click(), close: () => app.getByTestId('context-pill').click() },
  { name: 'changes', panel: 'changes', open: () => c.press('cmd-shift-d'), close: () => app.getByTestId('changes').press('escape') },
  { name: 'library', panel: 'history-input', open: () => c.press('cmd-k'), close: () => app.getByTestId('history-input').press('escape') },
]

try {
  await c.waitFor({ timeoutMs: 60_000 })
  await wait(2500)

  for (const s of surfaces) {
    await frames(`${s.name}-open`, s.open)
    expect(`${s.name} opens`, (await count(s.panel)) >= 1)
    await frames(`${s.name}-close`, s.close, [0, 40, 120])
    // A Sheet holds one beat for its scrim (0.18s); popovers go at once.
    await wait(s.panel === 'changes' || s.panel === 'history-input' ? 400 : 0)
    expect(`${s.name} is gone after closing`, (await count(s.panel)) === 0)
  }

  // Rapid toggling: ten presses, then it must be closed and nothing left behind.
  for (const s of surfaces.filter((x) => x.name.endsWith('menu') || x.name === 'context-card')) {
    for (let i = 0; i < 10; i++) await (i % 2 ? s.close : s.open)()
    await wait(400)
    expect(`${s.name}: ten rapid toggles leave it closed`, (await count(s.panel)) === 0, `${await count(s.panel)}`)
    await s.open()
    await wait(300)
    expect(`${s.name}: and it still opens after`, (await count(s.panel)) >= 1)
    await s.close()
    await wait(300)
  }

  // The toast: a full-access switch shows one; it rises and then unmounts whole.
  await app.getByTestId('mode-pill').click()
  await wait(300)
  await frames('toast', () => app.getByTestId('mode-bypassPermissions').click(), [0, 40, 80, 160, 260])
  expect('the toast shows', (await count('toast')) === 1)
  await wait(1800)
  expect('the toast is gone after its 1.5s', (await count('toast')) === 0)
} finally {
  await app.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
