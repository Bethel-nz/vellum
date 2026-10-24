// Self-check for recipes, against scripts/fake-acp.ts: the shelf on the strip opens past notes and
// recipes, a recipe picked there lands in the composer, "$" picks one in the composer too, sending
// it sends its prompt with the placeholders filled and switches to its mode, and New saves one.
//   bun scripts/check-recipes.ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launch } from '@gpuix/react/automation'

const home = mkdtempSync(path.join(tmpdir(), 'vellum-recipes-'))
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } }).exited
mkdirSync(path.join(home, 'recipes'), { recursive: true })
writeFileSync(path.join(home, 'recipes', 'review.md'), '---\ndescription: Review a part of the code\nmode: plan\n---\nReview {{input}} in {{folder}}.\n')
// A recipe whose prompt looks like a shell command: it must reach Claude as text, never run.
const pwned = path.join(home, 'pwned')
writeFileSync(path.join(home, 'recipes', 'sneaky.md'), `!touch ${pwned} # stream\n`)
const log = path.join(home, 'fake-acp.log')
writeFileSync(log, '')
const app = await launch({
  command: 'bun',
  args: ['app.tsx'],
  env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home'), VELLUM_AGENT: path.resolve(import.meta.dir, 'fake-acp.ts'), FAKE_ACP_LOG: log },
})
const workspace = path.resolve(import.meta.dir, '..')
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const shot = (n: string) => app.screenshot({ path: 'screenshots/recipes-' + n + '.png' })
const sent = () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).in).filter(Boolean)
const until = async (ok: () => Promise<boolean> | boolean, ms = 8000) => {
  const start = Date.now()
  while (!(await ok()) && Date.now() - start < ms) await wait(150)
  return ok()
}
let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}
try {
  const c = app.getByTestId('composer')
  await c.waitFor({ timeoutMs: 60_000 })
  await wait(1200)

  await app.getByTestId('open-history').click()
  await app.getByTestId('history').waitFor({ timeoutMs: 5_000 })
  await wait(500)
  await app.getByTestId('history-view-recipes').click()
  expect('the shelf has a Recipes side listing yours', await until(async () => (await app.getByTestId('recipe-review').count()) === 1))
  await shot('1-panel')
  await app.getByTestId('recipe-review').click()
  const hint = () => app.getByText('⌘↵ sends the $review recipe in Plan').count()
  expect('picking one puts $review in the note', await until(async () => (await hint()) === 1))

  // The same from the composer: "$" lists recipes, ⇥ takes one.
  await c.fill('$re')
  expect('"$" in the composer lists recipes', await until(async () => (await app.getByTestId('recipe-pick-0').count()) === 1))
  await shot('2-picker')
  await c.press('tab')
  await wait(300)
  expect('⇥ takes it', await until(async () => (await hint()) === 1))

  const prompt = async () => sent().filter((m) => m.method === 'session/prompt').map((m) => m.params.prompt.map((b: any) => b.text ?? '').join('')).at(-1) ?? ''
  await c.fill('$sneaky ')
  await wait(300)
  await c.press('cmd-enter')
  expect('a recipe starting with ! goes to Claude as text', await until(async () => (await prompt()).startsWith(`!touch ${pwned}`)), (await prompt()).slice(0, 80))
  expect('…and nothing runs', !existsSync(pwned))
  await wait(2500)

  await c.fill('$review the auth module')
  await wait(300)
  await c.press('cmd-enter')
  expect('sending it sends the recipe’s prompt, filled in', await until(async () => (await prompt()).includes(`Review the auth module in ${workspace}.`)), (await prompt()).slice(0, 120))
  expect('…in the recipe’s mode', sent().some((m) => m.method === 'session/set_config_option' && m.params.value === 'plan'))

  // New: a recipe of your own, saved as a file.
  await app.getByTestId('open-history').click()
  await app.getByTestId('history').waitFor({ timeoutMs: 5_000 })
  await wait(400)
  await app.getByTestId('history-view-recipes').click()
  await app.getByTestId('recipe-new').click()
  await app.getByTestId('recipe-form').waitFor({ timeoutMs: 5_000 })
  await app.getByTestId('recipe-name').fill('Stand up')
  await app.getByTestId('recipe-body').fill('What did I do yesterday in {{folder}}?')
  await shot('3-form')
  await app.getByTestId('recipe-save').click()
  const file = path.join(home, 'recipes', 'stand-up.md')
  expect('New saves it to ~/.vellum/recipes', await until(() => existsSync(file)), file)
  expect('…and lists it', await until(async () => (await app.getByTestId('recipe-stand-up').count()) === 1))
} finally {
  await app.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
