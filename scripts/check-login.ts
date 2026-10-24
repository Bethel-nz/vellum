// Self-check for accounts in Settings, against scripts/fake-acp.ts (no real login): who each
// account is shows at launch, Log in runs the agent's own login method in the inline terminal and
// the row updates when it exits, Log out ends it, a new account starts logged out, logging in
// again asks for the account's last email, and a second account that lands on the same login is
// flagged.
//   bun scripts/check-login.ts
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launch } from '@gpuix/react/automation'
const home = mkdtempSync(path.join(tmpdir(), 'vellum-login-'))
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } }).exited
const fake = path.resolve(import.meta.dir, 'fake-acp.ts')
const bin = path.join(home, 'bin')
mkdirSync(bin, { recursive: true })
writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\nexec bun ${fake} --cli "$@"\n`)
chmodSync(path.join(bin, 'claude'), 0o755)
// The default account is logged in; Work isn't.
const defaultConfig = path.join(home, 'default', 'claude')
mkdirSync(defaultConfig, { recursive: true })
writeFileSync(path.join(defaultConfig, '.fake-login'), 'default@example.com')
const nextLogin = path.join(home, 'next-login')
const log = path.join(home, 'fake-acp.log')
writeFileSync(log, '')
const app = await launch({
  command: 'bun',
  args: ['app.tsx'],
  env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home'), VELLUM_AGENT: fake, PATH: `${bin}:${process.env.PATH}`, FAKE_DEFAULT_CONFIG: defaultConfig, FAKE_ACP_LOG: log, FAKE_NEXT_LOGIN: nextLogin },
})
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const shot = (n: string) => app.screenshot({ path: 'screenshots/login-' + n + '.png' })
const profiles = () => JSON.parse(readFileSync(path.join(home, 'profiles.json'), 'utf8')) as any[]
const cli = () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.cli).map((e) => e.cli.join(' '))
let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}
const openSettings = async () => {
  // The account marker's menu ends in Settings…, which opens them.
  await app.getByTestId('account-pill').click()
  await app.getByTestId('account-settings').waitFor({ timeoutMs: 5_000 })
  await wait(300)
  await app.getByTestId('account-settings').click()
  await app.getByTestId('settings').waitFor({ timeoutMs: 5_000 })
  await wait(900)
}
const until = async (ok: () => Promise<boolean> | boolean, ms = 10_000) => {
  const start = Date.now()
  while (!(await ok()) && Date.now() - start < ms) await wait(250)
  return ok()
}
try {
  await app.getByTestId('composer').waitFor({ timeoutMs: 60_000 })
  expect('accounts are checked at launch', await until(() => profiles().every((p) => typeof p.loggedIn === 'boolean')), JSON.stringify(profiles().map((p) => p.loggedIn)))
  await openSettings()
  expect('the default account shows who it is', (await app.getByText('default@example.com · Claude Max').count()) === 1)
  expect('Work shows it is logged out', (await app.getByTestId('account-work').textContent()).includes('Not logged in'))
  await shot('1-accounts')

  await app.getByTestId('login-work').click()
  expect('Log in opens the terminal', await until(async () => (await app.getByTestId('pane-term').count()) === 1, 15_000))
  await shot('2-terminal')
  expect('it runs the agent’s login method', await until(() => cli().includes('auth login --claudeai')), cli().join(' | '))
  expect('the terminal closes once logged in', await until(async () => (await app.getByTestId('pane-term').count()) === 0, 15_000))
  expect('Work is logged in, with its email', await until(() => profiles().find((p) => p.id === 'work')?.email === 'work@example.com'), JSON.stringify(profiles().find((p) => p.id === 'work')))
  await openSettings()
  expect('the row says who', (await app.getByText('work@example.com · Claude Max').count()) === 1)
  await shot('3-logged-in')

  await app.getByTestId('logout-work').click()
  expect('Log out logs it out', await until(() => profiles().find((p) => p.id === 'work')?.loggedIn === false))
  expect('…through the agent', cli().includes('auth logout'))

  await app.getByTestId('add-account').click()
  await wait(500)
  await app.getByTestId('new-account-name').fill('Work 2')
  await app.getByTestId('new-account-add').click()
  expect('a new account is added, logged out', await until(() => profiles().find((p) => p.name === 'Work 2')?.loggedIn === false))
  await wait(600)
  expect('…and listed', (await app.getByTestId('account-work-2').count()) === 1)
  await shot('4-added')

  // Work again: it asks for the email it had.
  await app.getByTestId('login-work').click()
  expect('logging in again asks for the same email', await until(() => cli().includes('auth login --claudeai --email work@example.com')), cli().at(-1))
  await until(async () => (await app.getByTestId('pane-term').count()) === 0, 15_000)

  // Work 2, with the browser still signed in to the default account.
  writeFileSync(nextLogin, 'default@example.com')
  await openSettings()
  await app.getByTestId('login-work-2').click()
  await until(async () => (await app.getByTestId('pane-term').count()) === 1, 15_000)
  await until(async () => (await app.getByTestId('pane-term').count()) === 0, 15_000)
  await openSettings()
  expect('a login that lands on another account’s login is flagged on the later row', (await app.getByTestId('account-work-2').textContent()).includes('Same login as Default'))
  expect('…and not on the first', !(await app.getByTestId('account-main').textContent()).includes('Same login'))
  await shot('5-same-login')
} finally {
  await app.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
