// Self-check for force-sending a queued message, against scripts/fake-acp.ts: while Claude
// works, a queued row's Send now stops the running turn, and the message goes out first as
// its own turn, ahead of anything else queued. The rest of the queue still drains after it.
//   bun scripts/check-force-queue.ts
import path from 'node:path'
import { launch } from '@gpuix/react/automation'
import { names, scratchDir } from './scratch'

const home = await scratchDir('vellum-force-')
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } }).exited
const log = path.join(home, 'fake-acp.log')
await Bun.write(log, '')
const app = await launch({
  command: 'bun',
  args: ['app.tsx'],
  env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home'), VELLUM_AGENT: path.resolve(import.meta.dir, 'fake-acp.ts'), FAKE_ACP_LOG: log },
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
  expect('Claude is working', await until(async () => (await count('stop')) === 1))
  await c.fill('queued first')
  await c.press('cmd-enter')
  await c.fill('forced second')
  await c.press('cmd-enter')
  expect('two messages queued, each with Send now', await until(async () => (await count('queued-send-1')) === 1))

  const cancelsBefore = (await sent()).filter((m) => m.method === 'session/cancel').length
  const promptsBefore = (await texts('session/prompt')).length
  await app.getByTestId('queued-send-1').click()
  expect('Send now stops the running turn', await until(async () => (await sent()).filter((m) => m.method === 'session/cancel').length > cancelsBefore))
  const fresh = async () => (await texts('session/prompt')).slice(promptsBefore)
  expect('…and the forced message goes out first, as its own turn', await until(async () => {
    const prompts = await fresh()
    return prompts.length >= 2 && prompts[0].includes('forced second') && prompts[1].includes('queued first')
  }, 20_000), (await fresh()).join(' | ').slice(0, 200))
  expect('…and the queue drains behind it', await until(async () => (await count('queued-0')) === 0))
  await app.screenshot({ path: 'screenshots/queue-3-forced.png' })
} finally {
  await app.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
