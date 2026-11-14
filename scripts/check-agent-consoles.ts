// Exercises background agent discovery with real Windows console processes and fake account responses.
import { copyFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { scratchDir } from './scratch'

if (process.argv[2] === '--run') {
  await import(process.argv[3]!)
  process.exit(0)
}
if (process.platform !== 'win32') {
  console.log('skip: Windows background agent consoles')
  process.exit(0)
}
const probe = process.argv.includes('--probe')
const home = probe ? process.env.VELLUM_AGENT_CONSOLE_HOME! : await scratchDir('vellum-agent-consoles-')
const bin = path.join(home, 'bin')
const fixture = probe ? process.env.VELLUM_AGENT! : path.resolve(import.meta.dir, 'fake-agent-console.ts')
const executable = path.join(bin, 'claude.exe')
if (!probe) {
  const built = await Bun.build({ entrypoints: [fixture], compile: { outfile: executable } })
  if (!built.success) throw new AggregateError(built.logs, 'fixture build failed')
  for (const name of ['codex', 'opencode']) copyFileSync(executable, path.join(bin, `${name}.exe`))
  const gui = path.join(home, 'console-check.exe')
  const host = await Bun.build({ entrypoints: [import.meta.path], compile: { outfile: gui, windows: { hideConsole: true } } })
  if (!host.success) throw new AggregateError(host.logs, 'GUI host build failed')
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path'))
  const child = Bun.spawn([gui, '--probe'], {
    env: { ...env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, VELLUM_HOME: home, VELLUM_AGENT_CONSOLE_HOME: home, VELLUM_AGENT: fixture, FAKE_AGENT_CONSOLE_LOG: path.join(home, 'consoles.jsonl') },
    stdout: 'inherit', stderr: 'inherit', windowsHide: true,
  })
  const code = await child.exited
  rmSync(home, { recursive: true, force: true })
  process.exit(code)
}
for (const name of ['claude', 'codex', 'opencode']) {
  const resolved = Bun.which(name)
  if (resolved !== path.join(bin, `${name}.exe`)) throw new Error(`Fixture lookup failed for ${name}: ${resolved}`)
}
const { accountStatus, loginMethods, logout } = await import('../core/auth')
const profiles = (['claude', 'codex', 'opencode'] as const).map((agent) => ({ id: agent, agent, name: agent, color: '#000000', configDir: path.join(home, agent), workspaces: [] }))
let failed = 0
const expect = (label: string, ok: boolean) => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`)
}
for (const profile of profiles) {
  expect(`${profile.agent} status still reaches Vellum`, (await accountStatus(profile))?.loggedIn === true)
  if (profile.agent === 'opencode') delete process.env.VELLUM_AGENT
  try {
    if (profile.agent !== 'codex') expect(`${profile.agent} login discovery still answers ACP`, (await loginMethods(profile))[0]?.id === 'fixture')
  } finally { process.env.VELLUM_AGENT = fixture }
  if (profile.agent !== 'opencode') expect(`${profile.agent} logout still completes`, await logout(profile))
}
const probes = (await Bun.file(process.env.FAKE_AGENT_CONSOLE_LOG!).text()).trim().split('\n').map((line) => JSON.parse(line))
expect('all seven background agent processes were exercised', probes.length === 7)
expect('background agent discovery and status never allocate console windows', probes.every((probe) => !probe.hasConsole && !probe.visible))
process.exit(failed ? 1 : 0)
