// Self-check for moving a note to another account, against scripts/fake-acp.ts: the account
// marker on the strip lists your accounts; picking Work moves the note there. The note says so,
// the old session is let go, and the next message starts a new session on Work carrying the note
// so far. The message after that carries only itself.
//   bun scripts/check-move.ts
import path from 'node:path'
import { launch } from '@gpuix/react/automation'
import { scratchDir } from './scratch'

const home = await scratchDir('vellum-move-')
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } }).exited
const fake = path.resolve(import.meta.dir, 'fake-acp.ts')
const bin = path.join(home, 'bin')
await Bun.write(path.join(bin, 'claude'), `#!/bin/sh\nexec bun ${fake} --cli "$@"\n`)
await Bun.$`chmod 755 ${path.join(bin, 'claude')}`.quiet()
// Both accounts are logged in.
const defaultConfig = path.join(home, 'default', 'claude')
await Bun.write(path.join(defaultConfig, '.fake-login'), 'default@example.com')
const workConfig = path.join(home, 'profiles', 'work', 'claude')
await Bun.write(path.join(workConfig, '.fake-login'), 'work@example.com')
const log = path.join(home, 'fake-acp.log')
await Bun.write(log, '')

const app = await launch({
  command: 'bun',
  args: ['app.tsx'],
  env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home'), VELLUM_AGENT: fake, PATH: `${bin}:${process.env.PATH}`, FAKE_DEFAULT_CONFIG: defaultConfig, FAKE_ACP_LOG: log },
})
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const shot = (n: string) => app.screenshot({ path: `screenshots/move-${n}.png` })
let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}
const count = (id: string) => app.getByTestId(id).count()
const ids = async (prefix: string) => (await app.getByType('div').all()).map((n) => n.testId ?? '').filter((t) => t.startsWith(prefix))
const received = async () => (await Bun.file(log).text()).split('\n').filter(Boolean).map((l) => JSON.parse(l)).flatMap((o) => (o.in ? [o.in] : []))
const prompts = async () => (await received()).filter((m) => m.method === 'session/prompt').map((m) => (m.params.prompt ?? []).map((c: any) => c.text ?? '').join(''))
const records = async (id: string) => (await Bun.file(path.join(home, 'threads', `${id}.jsonl`)).text()).split('\n').filter(Boolean).map((l) => JSON.parse(l))
const type = (keys: string) => app.call('keystrokes' as never, { keys } as never)
const c = app.getByTestId('composer')
const ends = async () => (await records('20261023-demo01')).filter((r) => r.type === 'acp/end').length
const until = async (ok: () => boolean | Promise<boolean>, ms = 8000) => {
  for (const end = Date.now() + ms; Date.now() < end; await wait(100)) if (await ok()) return true
  return false
}
/** Until the note records the turn's end, allowing any ask the fake agent makes on the way. */
const turnOver = (turns: number) =>
  until(async () => {
    if ((await count('approval-allow')) === 1) await app.getByTestId('approval-allow').click().catch(() => {})
    return (await ends()) > turns
  }, 20_000)

try {
  await c.waitFor({ timeoutMs: 60_000 })
  await wait(2500)
  const note = (await records('20261023-demo01'))
  expect('the note starts on Default with a session of its own', note[0]?.meta?.profileId === 'main')

  await app.getByTestId('account-pill').click()
  await app.getByTestId('account-menu').waitFor({ timeoutMs: 3000 })
  await wait(300)
  expect('the account marker lists the accounts', (await count('move-main')) === 1 && (await count('move-work')) === 1)
  await shot('1-menu')
  await app.getByTestId('move-work').click()
  await wait(600)
  expect('picking Work closes the menu', (await count('account-menu')) === 0)
  const moved = (await records('20261023-demo01')).filter((r) => r.type === 'vellum/profile')
  expect('the move is recorded', moved.length === 1 && moved[0].profileId === 'work' && moved[0].from === 'Default' && moved[0].to === 'Work', JSON.stringify(moved))
  expect('the note shows where it moved', (await ids('moved-')).length === 1)
  await shot('2-moved')

  // The next message starts a new session on Work and carries the note.
  const before = (await received()).length
  let turns = (await ends())
  await c.click()
  await type('stream')
  await c.press('cmd-enter')
  const sent = await until(async () => (await prompts()).length > 0)
  const after = (await received()).slice(before)
  const first = (await prompts()).at(-1) ?? ''
  expect('the next message starts a new session, not the old one', after.some((m) => m.method === 'session/new') && !after.some((m) => m.method === 'session/resume'), after.map((m) => m.method).join(','))
  expect('…and carries the note so far', sent && first.includes('This note was moved here') && first.includes('concentric') && first.trimEnd().endsWith('stream'), first.slice(0, 120))
  // The turn is over once the note records its end.
  await turnOver(turns)
  await wait(300)
  const session = (await records('20261023-demo01')).filter((r) => r.type === 'acp/session').at(-1)
  expect('the new session is Work’s', session?.profileId === 'work', JSON.stringify(session))

  const n = (await prompts()).length
  turns = (await ends())
  await c.click()
  await type('stream')
  await c.press('cmd-enter')
  await until(async () => (await prompts()).length > n)
  expect('the message after that carries only itself', !((await prompts()).at(-1) ?? '').includes('This note was moved here'), ((await prompts()).at(-1) ?? '').slice(0, 80))
  await turnOver(turns)

  // The marker now says Work, and Default is the one to move back to.
  await app.getByTestId('account-pill').click()
  await app.getByTestId('account-menu').waitFor({ timeoutMs: 3000 })
  await wait(300)
  await shot('3-menu-after')
  await app.getByTestId('account-settings').click()
  await wait(500)
  expect('Settings… opens Settings', (await count('settings')) === 1)
} finally {
  await app.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
