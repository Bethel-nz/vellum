// Self-check for the packaged app (scripts/build-app.ts), against scripts/fake-acp.ts (no paid
// turns): the compiled binary inside Vellum.app starts, draws in its own fonts, runs an agent turn
// through itself (`--run`), and opens a terminal through its own holder (`--termd`) and the
// ghostty wasm it carries. Shots go to screenshots/app-*.png.
//   bun scripts/build-app.ts && bun scripts/check-app.ts
import path from 'node:path'
import { launch } from '@gpuix/react/automation'
import { present, scratchDir } from './scratch'

const binary = path.resolve(import.meta.dir, '../dist/bundle/Vellum.app/Contents/MacOS/Vellum')
if (!await present(binary)) throw new Error('no Vellum.app: run bun scripts/build-app.ts first')
const home = await scratchDir('vellum-app-')
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } }).exited
const app = await launch({
  command: binary,
  args: [],
  env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home'), VELLUM_AGENT: path.resolve(import.meta.dir, 'fake-acp.ts') },
})
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const ids = async () => (await app.getByType('div').all()).map((n) => n.testId ?? '')
let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}

try {
  const c = app.getByTestId('composer')
  await c.waitFor({ timeoutMs: 60_000 })
  await wait(1500)
  await app.screenshot({ path: 'screenshots/app-1-open.png' })
  expect('the packaged app opens a note', true)

  const before = new Set((await ids()).filter((id) => id.startsWith('reply-')))
  // "stream" gets a reply with no tool call, so no approval to answer.
  await c.fill('Please stream a hello from the bundle')
  await c.press('cmd-enter')
  let replied = false
  for (let t = 0; t < 100 && !replied; t++) {
    replied = (await ids()).some((id) => id.startsWith('reply-') && !before.has(id))
    await wait(100)
  }
  expect('an agent turn runs through the binary', replied)
  await app.screenshot({ path: 'screenshots/app-2-reply.png' })

  await app.getByTestId('view-terminal').click()
  await app.getByTestId('pane-term').waitFor({ timeoutMs: 10_000 })
  await wait(1500)
  const term = app.getByTestId('term-running')
  await term.click()
  for (const k of [...'echo vellum42'].map((ch) => (ch === ' ' ? 'space' : ch)).concat('enter')) await term.press(k)
  await wait(1200)
  expect('a terminal runs through its own holder', (await app.getByTestId('pane-term').textContent()).includes('vellum42'))
  await app.screenshot({ path: 'screenshots/app-3-terminal.png' })
} finally {
  await app.close()
  // The holder outlives the app by design; this one belongs to the throwaway home.
  Bun.spawnSync(['pkill', '-f', `${binary} --termd ${home}`])
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
