// Self-check for accounts in Settings, against scripts/fake-acp.ts (no real login): who each
// account is shows at launch, Log in runs the agent's own login method in the inline terminal and
// the row updates when it exits, Log out ends it, a new account starts logged out, logging in
// again asks for the account's last email, and a second account that lands on the same login is
// flagged.
//   bun scripts/check-login.ts
import path from 'node:path'
import { launch } from '@gpuix/react/automation'
import { scratchDir } from './scratch'
const home = await scratchDir('vellum-login-')
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } }).exited
const fake = path.resolve(import.meta.dir, 'fake-acp.ts')
const bin = path.join(home, 'bin')
const claude = path.join(bin, process.platform === 'win32' ? 'claude.cmd' : 'claude')
await Bun.write(claude, process.platform === 'win32' ? `@echo off\r\n"${process.execPath}" "${fake}" --cli %*\r\n` : `#!/bin/sh\nexec "${process.execPath}" "${fake}" --cli "$@"\n`)
if (process.platform !== 'win32') await Bun.$`chmod 755 ${claude}`.quiet()
// The default account is logged in; Work isn't.
const defaultConfig = path.join(home, 'default', 'claude')
await Bun.write(path.join(defaultConfig, '.fake-login'), 'default@example.com')
const nextLogin = path.join(home, 'next-login')
const log = path.join(home, 'fake-acp.log')
await Bun.write(log, '')
const app = await launch({
  command: 'bun',
  args: ['app.tsx'],
  env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home'), VELLUM_AGENT: fake, PATH: `${bin}${path.delimiter}${process.env.PATH}`, FAKE_DEFAULT_CONFIG: defaultConfig, FAKE_ACP_LOG: log, FAKE_NEXT_LOGIN: nextLogin },
})
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const shot = (n: string) => app.screenshot({ path: 'screenshots/login-' + n + '.png' })
const profiles = async () => JSON.parse(await Bun.file(path.join(home, 'profiles.json')).text()) as any[]
const cli = async () => (await Bun.file(log).text()).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.cli).map((e) => e.cli.join(' '))
let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}
const openSettings = async () => {
  // The account marker's menu ends in Accounts and settings…, which opens them on Accounts.
  // Settings covers the marker, so leave it first if it's still open.
  if (await app.getByTestId('settings').count()) {
    await app.getByTestId('settings-done').click()
    await wait(400)
  }
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
  expect('accounts are checked at launch', await until(async () => (await profiles()).every((p) => typeof p.loggedIn === 'boolean')), JSON.stringify((await profiles()).map((p) => p.loggedIn)))
  await openSettings()
  expect('the default account shows who it is', (await app.getByText('default@example.com · Claude Max').count()) === 1)
  expect('Work shows it is logged out', (await app.getByTestId('account-work').textContent()).includes('Not logged in'))
  await shot('1-accounts')

  await app.getByTestId('login-work').click()
  expect('Log in opens the terminal', await until(async () => (await app.getByTestId('pane-term').count()) === 1, 15_000))
  await shot('2-terminal')
  expect('it runs the agent’s login method', await until(async () => (await cli()).includes('auth login --claudeai')), (await cli()).join(' | '))
  expect('the terminal closes once logged in', await until(async () => (await app.getByTestId('pane-term').count()) === 0, 15_000))
  expect('Work is logged in, with its email', await until(async () => (await profiles()).find((p) => p.id === 'work')?.email === 'work@example.com'), JSON.stringify((await profiles()).find((p) => p.id === 'work')))
  await openSettings()
  expect('the row says who', (await app.getByText('work@example.com · Claude Max').count()) === 1)
  await shot('3-logged-in')

  await app.getByTestId('logout-work').click()
  expect('Log out logs it out', await until(async () => (await profiles()).find((p) => p.id === 'work')?.loggedIn === false))
  expect('…through the agent', (await cli()).includes('auth logout'))

  await app.getByTestId('add-account').click()
  await wait(500)
  await app.getByTestId('new-account-name').fill('Work 2')
  await app.getByTestId('new-account-add').click()
  expect('a new account is added, logged out', await until(async () => (await profiles()).find((p) => p.name === 'Work 2')?.loggedIn === false))
  await wait(600)
  expect('…and listed', (await app.getByTestId('account-work-2').count()) === 1)
  await shot('4-added')

  // Work again: it asks for the email it had.
  await app.getByTestId('login-work').click()
  expect('logging in again asks for the same email', await until(async () => (await cli()).includes('auth login --claudeai --email work@example.com')), (await cli()).at(-1))
  await until(async () => (await app.getByTestId('pane-term').count()) === 0, 15_000)

  // Work 2, with the browser still signed in to the default account.
  await Bun.write(nextLogin, 'default@example.com')
  await openSettings()
  await app.getByTestId('login-work-2').click()
  await until(async () => (await app.getByTestId('pane-term').count()) === 1, 15_000)
  await until(async () => (await app.getByTestId('pane-term').count()) === 0, 15_000)
  await openSettings()
  expect('a login that lands on another account’s login is flagged on the later row', (await app.getByTestId('account-work-2').textContent()).includes('Same login as Default'))
  expect('…and not on the first', !(await app.getByTestId('account-main').textContent()).includes('Same login'))
  await shot('5-same-login')

  // Other agents (core/agents.ts): the picker makes a Codex account with its own CODEX_HOME,
  // and one OpenCode account on its default home. Each needs its CLI installed; without it
  // Add stays off and says why. Nothing here signs in.
  await openSettings()
  await app.getByTestId('add-account').click()
  await wait(400)
  await app.getByTestId('new-account-agent-codex').click()
  await app.getByTestId('new-account-name').fill('Codex')
  if (Bun.which('codex')) {
    await app.getByTestId('new-account-add').click()
    const codex = await until(async () => Boolean((await profiles()).find((p) => p.name === 'Codex')))
    const made = (await profiles()).find((p) => p.name === 'Codex')
    expect('a Codex account is added, on Codex', Boolean(codex) && made?.agent === 'codex', JSON.stringify(made))
    expect('…with a CODEX_HOME of its own, made empty', Boolean(made?.configDir?.endsWith(path.join('profiles', 'codex', 'codex'))) && (await Bun.file(made!.configDir!).stat().then((s) => s.isDirectory(), () => false)))
    expect('…and it isn’t signed in yet', await until(async () => (await profiles()).find((p) => p.name === 'Codex')?.loggedIn === false))
    await openSettings()
    expect('its row names the agent', await until(async () => (await app.getByTestId('account-codex').textContent()).includes('Codex · Not logged in')), await app.getByTestId('account-codex').textContent())
  } else expect('without Codex installed, Add says why', (await app.getByText('Codex isn’t installed').count()) === 1)
  await shot('6-codex')
  await openSettings()
  await app.getByTestId('add-account').click()
  await wait(400)
  await app.getByTestId('new-account-agent-opencode').click()
  await app.getByTestId('new-account-name').fill('OpenCode')
  if (Bun.which('opencode')) {
    await app.getByTestId('new-account-add').click()
    expect('an OpenCode account is added, on its default home', await until(async () => {
      const made = (await profiles()).find((p) => p.name === 'OpenCode')
      return made?.agent === 'opencode' && made.configDir === null
    }), JSON.stringify((await profiles()).find((p) => p.name === 'OpenCode')))
    await openSettings()
    await app.getByTestId('add-account').click()
    await wait(400)
    await app.getByTestId('new-account-agent-opencode').click()
    await wait(500)
    expect('a second OpenCode account isn’t offered yet', (await app.getByText('There\'s already an OpenCode account').count()) === 1)
  } else expect('without OpenCode installed, Add says why', (await app.getByText('OpenCode isn’t installed').count()) === 1)
  await shot('7-opencode')
} finally {
  await app.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
