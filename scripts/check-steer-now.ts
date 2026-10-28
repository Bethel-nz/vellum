// Self-check for Steer with an agent that can't steer, against scripts/fake-acp.ts as opencode
// (no `steering` in its initialize _meta): what you write while it works still has Queue and
// Steer under it, and Steer sends it now: the running turn stops and it goes out as its own turn,
// ahead of anything already queued. Nothing is sent as `_session/steering`.
//   bun scripts/check-steer-now.ts
import path from 'node:path'
import { launch } from '@gpuix/react/automation'
import { scratchDir } from './scratch'

const home = await scratchDir('vellum-steer-now-')
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } }).exited
const log = path.join(home, 'fake-acp.log')
await Bun.write(log, '')
const app = await launch({
  command: 'bun',
  args: ['app.tsx'],
  env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home'), VELLUM_AGENT: path.resolve(import.meta.dir, 'fake-acp.ts'), FAKE_ACP_LOG: log, FAKE_ACP_AS: 'opencode' },
})
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const sent = async () => (await Bun.file(log).text()).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).in).filter(Boolean)
const texts = async (method: string) => (await sent()).filter((m) => m.method === method).map((m) => (m.params.prompt ?? []).map((b: any) => b.text ?? '').join(''))
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
try {
  const c = app.getByTestId('composer')
  await c.waitFor({ timeoutMs: 60_000 })
  await wait(1200)

  // "stream" gets a reply in small pieces over ~2.5s and no tool call: time to write meanwhile.
  await c.fill('stream a long answer')
  await c.press('cmd-enter')
  expect('the agent is working', await until(async () => (await count('stop')) === 1))
  expect('…with the prompt', await until(async () => (await texts('session/prompt')).length === 1))
  await c.fill('queued first')
  await c.press('cmd-enter')
  await until(async () => (await count('queued-0')) === 1)

  await c.fill('steered second')
  expect('what you write while it works has Queue and Steer under it', await until(async () => (await count('draft-queue')) === 1 && (await count('draft-steer')) === 1))
  const cancelsBefore = (await sent()).filter((m) => m.method === 'session/cancel').length
  await app.getByTestId('draft-steer').click()
  expect('Steer stops the running turn', await until(async () => (await sent()).filter((m) => m.method === 'session/cancel').length > cancelsBefore))
  const fresh = async () => (await texts('session/prompt')).slice(1)
  expect('…and the steered message goes out next, as its own turn', await until(async () => {
    const prompts = await fresh()
    return prompts.length >= 2 && prompts[0].includes('steered second') && prompts[1].includes('queued first')
  }, 20_000), (await fresh()).join(' | ').slice(0, 200))
  expect('…never as _session/steering', (await texts('_session/steering')).length === 0)
  expect('…and the queue drains behind it', await until(async () => (await count('queued-0')) === 0))
  await app.screenshot({ path: 'screenshots/queue-4-steer-now.png' })
} finally {
  await app.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
