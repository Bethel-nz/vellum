// Self-check for approvals against scripts/fake-acp.ts (no paid turns): a turn that needs a
// Bash OK raises the card with the command; ↵ in the empty composer allows it, and the answer
// stays in the note as a line; esc opens "what to do instead" and ↵ denies, sending that note as
// the next message; ⇧⇥ switches the permission mode live; Think max and off set the effort live.
//   bun scripts/check-approval.ts
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launch } from '@gpuix/react/automation'

const home = mkdtempSync(path.join(tmpdir(), 'vellum-approval-'))
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home } }).exited
const log = path.join(home, 'fake-acp.log')
writeFileSync(log, '')

const app = await launch({
  command: 'bun',
  args: ['app.tsx'],
  env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_AGENT: path.resolve(import.meta.dir, 'fake-acp.ts'), FAKE_ACP_LOG: log },
})
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const shot = (n: string) => app.screenshot({ path: 'screenshots/approval-' + n + '.png' })
/** Every JSON-RPC message the agent received. */
const sent = () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).in)
/** Answers to permission asks (the fake numbers its asks from 1000). */
const answers = () => sent().flatMap((m) => (m.method === undefined && m.id >= 1000 ? [m.result?.outcome] : []))
const configs = () => sent().flatMap((m) => (m.method === 'session/set_config_option' ? [m.params] : []))
const prompts = () => sent().flatMap((m) => (m.method === 'session/prompt' ? [m.params.prompt.map((c: any) => c.text).join('')] : []))
const ids = async (prefix: string) => (await app.getByType('div').all()).map((n) => n.testId ?? '').filter((id) => id.startsWith(prefix))
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
  await c.press('enter')
  await wait(200)
  expect('a ↵ in its first moments does nothing', answers().length === 0)
  await wait(500)
  expect('it shows the command', card && (await app.getByTestId('approval-detail').textContent()).includes('bun test ui/theme.test.ts'))
  expect('always-allow uses the agent’s words', (await app.getByText("Don't ask again for bun test commands").count()) === 1)
  expect('your mode wins over the agent’s starting one', configs()[0]?.configId === 'mode' && configs()[0]?.value === 'acceptEdits', JSON.stringify(configs()[0]))
  expect('…and no mode change is recorded for it', !readFileSync(path.join(home, 'threads', '20261023-demo01.jsonl'), 'utf8').includes('"mode":"auto"'))
  expect('the note’s session is resumed over ACP', sent().some((m) => m.method === 'session/resume' && m.params.sessionId === 'demo-session'))
  await shot('1-card')

  // ↵ in the empty composer allows
  await c.press('enter')
  await wait(1200)
  expect('↵ allows once', answers()[0]?.optionId === 'allow-once', JSON.stringify(answers()[0]))
  expect('the card goes', (await app.getByTestId('approval').count()) === 0)
  expect('the note keeps an Allowed line', (await app.getByText('Allowed · Run in vellum/').count()) === 1)
  await shot('2-allowed')

  // esc opens the deny field; ↵ denies with the message
  await c.click()
  await c.fill('And again')
  await c.press('cmd-enter')
  await app.getByTestId('approval').waitFor({ timeoutMs: 15_000 })
  await wait(700)
  await c.press('escape')
  await wait(400)
  const field = app.getByTestId('approval-deny-field')
  expect('esc opens the deny field', (await field.count()) === 1)
  await field.fill('use vitest instead')
  await shot('3-denying')
  await field.press('enter')
  await wait(1200)
  const deny = answers()[1]
  expect('↵ denies', deny?.optionId === 'reject', JSON.stringify(deny))
  expect('…and the note goes in as the next message', prompts().at(-1) === 'use vitest instead', prompts().at(-1))
  expect('the note keeps a Denied line', (await app.getByText('Denied · Run in vellum/').count()) === 1)
  await shot('4-denied')

  // an edit ask shows the change itself
  await c.click()
  await c.fill('Please edit the radius')
  await c.press('cmd-enter')
  await app.getByTestId('approval').waitFor({ timeoutMs: 15_000 })
  await wait(700)
  expect('an edit ask previews its diff', (await app.getByTestId('approval-preview').count()) === 1)
  await shot('4b-edit-preview')
  await c.press('escape')
  await wait(300)
  await app.getByTestId('approval-deny-field').press('enter')
  await wait(800)

  // ⇧⇥ switches the mode on the live process; Think off is live too
  await c.click()
  await c.press('shift-tab')
  await wait(500)
  expect('⇧⇥ sets plan mode live', configs().some((r) => r.configId === 'mode' && r.value === 'plan'))
  await app.getByTestId('mode-pill').click()
  await wait(400)
  expect('the mode icon opens its menu upward', (await app.getByTestId('mode-menu').count()) === 1 && (await app.getByTestId('mode-menu').bounds()).y < (await app.getByTestId('mode-pill').bounds()).y)
  await shot('4-mode-menu')
  await app.getByTestId('mode-menu').press('escape')
  await wait(300)
  // Thinking is the agent's effort option, set live
  const turn = async (text: string) => {
    await c.click()
    await c.fill(text)
    await c.press('cmd-enter')
    await app.getByTestId('approval').waitFor({ timeoutMs: 15_000 })
    await wait(700)
    await c.press('enter')
    await wait(1000)
  }
  await app.getByTestId('think-pill').click() // on → max
  await wait(300)
  await turn('Think hard')
  expect('Think max sets effort max', configs().some((r) => r.configId === 'effort' && r.value === 'max'))
  expect('…on the same process', sent().filter((m) => m.method === 'initialize').length === 1)
  await app.getByTestId('think-pill').click() // max → off
  await wait(300)
  await turn('No thinking')
  expect('Think off sets effort low', configs().some((r) => r.configId === 'effort' && r.value === 'low'))
  const records = readFileSync(path.join(home, 'threads', `${JSON.parse(readFileSync(path.join(home, 'settings.json'), 'utf8')).lastThreadId}.jsonl`), 'utf8')
  expect('mode and think are recorded', records.includes('"vellum/mode"') && records.includes('"vellum/think"'))
  await shot('5-pills')

  // the model switcher has the account's list from initialize, and switches live
  expect('the model reads Opus 5.5', (await app.getByTestId('model-pill').textContent()).includes('Opus 5.5'))
  await app.getByTestId('model-pill').click()
  await wait(400)
  expect('the list came from the agent', (await app.getByTestId('model-haiku').count()) === 1)
  await shot('6-model-menu')
  await app.getByTestId('model-haiku').click()
  await wait(500)
  expect('picking Haiku sets it live', configs().some((r) => r.configId === 'model' && r.value === 'haiku'))
  expect('the model reads Haiku 5.5', (await app.getByTestId('model-pill').textContent()).includes('Haiku 5.5'))

  // context: the ring's count, the card, and Compact
  expect('context shows the tokens', (await app.getByTestId('context-pill').textContent()).includes('24k'))
  await app.getByTestId('context-pill').click()
  await wait(400)
  expect('the card shows used of window', (await app.getByTestId('context-used').textContent()).includes('24k / 200k'))
  await shot('7-context')
  await app.getByTestId('compact').click()
  await wait(1500)
  const after = readFileSync(path.join(home, 'threads', `${JSON.parse(readFileSync(path.join(home, 'settings.json'), 'utf8')).lastThreadId}.jsonl`), 'utf8')
  expect('Compact sends /compact as its own turn', after.includes('"vellum/compact"') && !after.includes('"text":"/compact"'))
  expect('the fold line is in the note', (await ids('compact-')).length === 1)
  expect('the ring drops to the summary', (await app.getByTestId('context-pill').textContent()).includes('1.9k'))
  await shot('8-compacted')
} finally {
  await app.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
