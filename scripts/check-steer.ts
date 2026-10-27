// Self-check for steering (core/agent.ts `steer`), against scripts/fake-acp.ts and without the
// window: a message steered into a running turn goes as `_session/steering`, is taken in, and is
// answered before that same turn ends, with no second prompt. Steering an idle session sends
// nothing: it answers `promptRequired`, so the caller sends a turn of its own. An agent that
// doesn't advertise steering is `unavailable` and is never asked.
//   bun scripts/check-steer.ts
import path from 'node:path'
import { scratchDir } from './scratch'

const home = await scratchDir('vellum-steer-')
const log = path.join(home, 'fake-acp.log')
await Bun.write(log, '')
// Before the imports below: the store reads its home as it loads.
Object.assign(process.env, { VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home'), VELLUM_AGENT: path.resolve(import.meta.dir, 'fake-acp.ts'), FAKE_ACP_LOG: log })
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: process.env }).exited
const { AgentRunner } = await import('../core/agent')
const { loadProfiles } = await import('../core/profiles')

let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const sent = async () => (await Bun.file(log).text()).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).in).filter(Boolean)

const profiles = loadProfiles()
let reply = ''
let ended = 0
const runner = new AgentRunner(
  { threadId: 'steer-check', workspace: path.resolve(import.meta.dir, '..'), profile: profiles[0]!, configDirs: profiles.map((p) => p.configDir) },
  {
    line(_raw, ev: any) {
      if (ev.type === 'acp/update' && ev.update?.sessionUpdate === 'agent_message_chunk') reply += ev.update.content?.text ?? ''
      if (ev.type === 'acp/end') ended++
    },
    record() {},
    ask() {},
    askGone() {},
  },
)

try {
  expect('before a turn there is nothing to steer', !runner.canSteer)
  // "stream" makes the fake reply in ~2.5s of small pieces, with no tool call.
  runner.send('stream a long answer')
  const start = Date.now()
  while (!runner.canSteer && Date.now() - start < 15_000) await wait(50)
  expect('during a turn the agent can be steered', runner.canSteer)
  await wait(300)
  const outcome = await runner.steer('use bun, not npm')
  expect('a steer during the turn is taken in', outcome === 'injected', outcome)
  const steers = (await sent()).filter((m) => m.method === '_session/steering')
  expect('…sent as _session/steering with idleBehavior promptRequired', steers.length === 1 && steers[0].params._meta?.steering?.idleBehavior === 'promptRequired' && steers[0].params.prompt?.[0]?.text === 'use bun, not npm', JSON.stringify(steers.map((s) => s.params)))
  while (!ended && Date.now() - start < 20_000) await wait(50)
  expect('the same turn answers it before it ends', ended === 1 && reply.includes('Steered: use bun, not npm'), reply.slice(-60))
  expect('…and no second prompt went out', (await sent()).filter((m) => m.method === 'session/prompt').length === 1)

  // Idle: the turn is over.
  await wait(200)
  expect('after the turn there is nothing to steer', !runner.canSteer)
  expect('steering while idle is unavailable and asks nothing', (await runner.steer('too late')) === 'unavailable' && (await sent()).filter((m) => m.method === '_session/steering').length === 1)
} finally {
  await runner.dispose()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
