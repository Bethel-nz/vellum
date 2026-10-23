// Self-check for approvals against scripts/fake-claude.ts (no paid turns): a turn that needs a
// Bash OK raises the card with the command; ↵ in the empty composer allows it, and the answer
// stays in the note as a line; esc opens "what to do instead" and ↵ denies with that message;
// ⇧⇥ switches the permission mode live; Think max and off respawn the idle process with them.
//   bun scripts/check-approval.ts
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launch } from '@gpuix/react/automation'

const home = mkdtempSync(path.join(tmpdir(), 'vellum-approval-'))
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home } }).exited
const bin = path.join(home, 'bin')
const log = path.join(home, 'fake-claude.log')
await Bun.spawn(['mkdir', '-p', bin]).exited
writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\nexec bun ${path.resolve(import.meta.dir, 'fake-claude.ts')} "$@"\n`)
chmodSync(path.join(bin, 'claude'), 0o755)
writeFileSync(log, '')

const app = await launch({
  command: 'bun',
  args: ['app.tsx'],
  env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, PATH: `${bin}:${process.env.PATH}`, FAKE_CLAUDE_LOG: log },
})
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const shot = (n: string) => app.screenshot({ path: 'screenshots/approval-' + n + '.png' })
const sent = () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
const answers = () => sent().flatMap((e) => (e.answer ? [e.answer.response] : []))
const controls = () => sent().flatMap((e) => (e.control ? [e.control] : []))
let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}

try {
  const c = app.getByTestId('composer')
  await c.waitFor({ timeoutMs: 60_000 })
  await wait(1000)

  // a turn that needs an OK raises the card
  await c.click()
  await c.fill('Run the tests')
  await c.press('cmd-enter')
  const card = await app.getByTestId('approval').waitFor({ timeoutMs: 15_000 }).then(() => true, () => false)
  expect('the card rises', card)
  await wait(700)
  expect('it shows the command', card && (await app.getByTestId('approval-detail').textContent()).includes('bun test ui/theme.test.ts'))
  expect('always-allow names the rule', (await app.getByText('Always allow bun test').count()) === 1)
  expect('launched with host permission prompts', sent()[0]?.argv?.includes('--permission-prompts'))
  await shot('1-card')

  // ↵ in the empty composer allows
  await c.press('enter')
  await wait(1200)
  expect('↵ allows', answers()[0]?.behavior === 'allow', JSON.stringify(answers()[0]))
  expect('the card goes', (await app.getByTestId('approval').count()) === 0)
  expect('the note keeps an Allowed line', (await app.getByText('Allowed · Run in vellum/').count()) === 1)
  await shot('2-allowed')

  // esc opens the deny field; ↵ denies with the message
  await c.click()
  await c.fill('And again')
  await c.press('cmd-enter')
  await app.getByTestId('approval').waitFor({ timeoutMs: 15_000 })
  await wait(500)
  await c.press('escape')
  await wait(400)
  const field = app.getByTestId('approval-deny-field')
  expect('esc opens the deny field', (await field.count()) === 1)
  await field.fill('use vitest instead')
  await shot('3-denying')
  await field.press('enter')
  await wait(1200)
  const deny = answers()[1]
  expect('↵ denies with the message', deny?.behavior === 'deny' && deny?.message === 'use vitest instead', JSON.stringify(deny))
  expect('the note keeps a Denied line', (await app.getByText('Denied · Run in vellum/').count()) === 1)
  await shot('4-denied')

  // ⇧⇥ switches the mode on the live process; Think off is live too
  await c.click()
  await c.press('shift-tab')
  await wait(500)
  expect('⇧⇥ sets plan mode live', controls().some((r) => r.subtype === 'set_permission_mode' && r.mode === 'plan'))
  expect('the pill says Plan', (await app.getByTestId('mode-pill').textContent()).includes('Plan'))
  // Think max is a spawn flag: the idle process restarts and the next turn runs with --effort max
  const spawns = () => sent().flatMap((e) => (e.argv && !e.argv.includes('json') ? [e.argv as string[]] : []))
  const turn = async (text: string) => {
    await c.click()
    await c.fill(text)
    await c.press('cmd-enter')
    await app.getByTestId('approval').waitFor({ timeoutMs: 15_000 })
    await wait(400)
    await c.press('enter')
    await wait(1000)
  }
  await app.getByTestId('think-pill').click() // on → max
  await wait(300)
  await turn('Think hard')
  expect('Think max respawns with --effort max', spawns().at(-1)?.join(' ').includes('--effort max') ?? false, `${spawns().length} spawns`)
  expect('…in plan mode still', spawns().at(-1)?.join(' ').includes('--permission-mode plan') ?? false)
  await app.getByTestId('think-pill').click() // max → off
  await wait(300)
  await turn('No thinking')
  expect('Think off: no --effort, thinking tokens 0', !spawns().at(-1)?.includes('--effort') && controls().some((r) => r.subtype === 'set_max_thinking_tokens' && r.max_thinking_tokens === 0))
  const records = readFileSync(path.join(home, 'threads', `${JSON.parse(readFileSync(path.join(home, 'settings.json'), 'utf8')).lastThreadId}.jsonl`), 'utf8')
  expect('mode and think are recorded', records.includes('"vellum/mode"') && records.includes('"vellum/think"'))
  await shot('5-pills')
} finally {
  await app.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
