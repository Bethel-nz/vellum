// Self-check for writing while Claude works, against scripts/fake-acp.ts: what you write gets
// Queue and Steer under it; ⌘↵ (or Queue) queues the message, which shows above the composer as
// a faded paragraph, ⌥⌘↵ steers it into the running turn (one `_session/steering`,
// answered before that turn ends), a queued message's Send now steers it, ✕ takes one out, and
// what's left goes out as the next turn once this one ends. A steer before the turn has reached
// the agent (it's still starting) waits at the front of the queue instead.
//   bun scripts/check-queue.ts
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launch } from '@gpuix/react/automation'

const home = mkdtempSync(path.join(tmpdir(), 'vellum-queue-'))
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } }).exited
const log = path.join(home, 'fake-acp.log')
writeFileSync(log, '')
const app = await launch({
  command: 'bun',
  args: ['app.tsx'],
  env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home'), VELLUM_AGENT: path.resolve(import.meta.dir, 'fake-acp.ts'), FAKE_ACP_LOG: log },
})
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const sent = () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).in).filter(Boolean)
const texts = (method: string) => sent().filter((m) => m.method === method).map((m) => (m.params.prompt ?? []).map((b: any) => b.text ?? '').join(''))
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
  // Straight away the agent is still starting: there's no turn to steer yet.
  await c.fill('first, read the README')
  await c.press('alt-cmd-enter')
  expect('a steer before the turn reaches the agent waits in the queue', await until(async () => (await count('queued-0')) === 1) && texts('_session/steering').length === 0, texts('_session/steering').join(' | '))
  await app.getByTestId('queued-remove-0').click()
  await until(async () => (await count('queued-0')) === 0)
  expect('…until the prompt is with the agent', await until(() => texts('session/prompt').length === 1))

  await c.fill('then rename the module')
  await c.press('cmd-enter')
  expect('⌘↵ while it works queues the message, above the composer', await until(async () => (await count('queued-0')) === 1))
  await c.fill('drop this one')
  expect('what you write while it works has Queue and Steer under it', await until(async () => (await count('draft-queue')) === 1 && (await count('draft-steer')) === 1))
  await app.getByTestId('draft-queue').click()
  await until(async () => (await count('queued-1')) === 1)
  await app.getByTestId('queued-remove-1').click()
  expect('✕ takes one out', await until(async () => (await count('queued-1')) === 0 && (await count('queued-0')) === 1))
  await app.screenshot({ path: 'screenshots/queue-1-queued.png' })

  await c.fill('use bun, not npm')
  await c.press('alt-cmd-enter')
  expect('⌥⌘↵ steers it into the turn', await until(() => texts('_session/steering').includes('use bun, not npm')), texts('_session/steering').join(' | '))
  expect('…as no new turn', texts('session/prompt').length === 1, `${texts('session/prompt').length} prompts`)

  // Once the turn ends, the queue's message is the next turn (it's a plain prompt, so the fake
  // asks to run a command: that's the second turn running).
  // The note's records: your paragraph where Claude took it in, then the same turn's answer to it.
  const records = () => readdirSync(path.join(home, 'threads')).filter((f) => f.endsWith('.jsonl')).flatMap((f) => readFileSync(path.join(home, 'threads', f), 'utf8').trim().split('\n').map((l) => JSON.parse(l)))
  const steeredAt = () => records().findIndex((r) => r.type === 'vellum/user' && r.text === 'use bun, not npm')
  const answeredAt = () => records().findIndex((r) => JSON.stringify(r).includes('Steered: use bun, not npm'))
  const endAfter = () => records().findIndex((r, i) => i > steeredAt() && r.type === 'acp/end')
  expect('your steered paragraph lands in the note', await until(() => steeredAt() >= 0))
  expect('…and the same turn answers it before it ends', await until(() => answeredAt() > steeredAt() && endAfter() > answeredAt()), `${steeredAt()} → ${answeredAt()} → ${endAfter()}`)
  expect('after the turn, the queued message goes out', await until(() => texts('session/prompt').some((t) => t.includes('then rename the module')), 15_000), texts('session/prompt').join(' | ').slice(0, 120))
  expect('…and leaves the queue', (await count('queued-0')) === 0)

  // Send now: queue one during this second turn, then steer it from its row.
  await c.fill('and add a test')
  await c.press('cmd-enter')
  await until(async () => (await count('queued-steer-0')) === 1)
  await app.getByTestId('queued-steer-0').click()
  expect('Send now steers a queued message', await until(() => texts('_session/steering').includes('and add a test')), texts('_session/steering').join(' | '))
  expect('…and takes it out of the queue', await until(async () => (await count('queued-0')) === 0))
  await app.screenshot({ path: 'screenshots/queue-2-steered.png' })
} finally {
  await app.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
