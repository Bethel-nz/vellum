// Self-check for the compiled app against scripts/fake-acp.ts (no paid turns): it opens, runs a
// fake agent turn, and tests its terminal. Shots go to screenshots/app-*.png.
//   bun run package && bun scripts/check-app.ts
import path from 'node:path'
import { launch } from '@gpuix/react/automation'
import { present, scratchDir } from './scratch'

const windows = process.platform === 'win32'
const binary = path.resolve(import.meta.dir, windows ? '../dist/Vellum.exe' : '../dist/bundle/Vellum.app/Contents/MacOS/Vellum')
if (!await present(binary)) throw new Error('no compiled Vellum: run bun run package first')
const home = await scratchDir('vellum-app-')
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } }).exited
const contextFile = path.join(home, 'opened text file.txt')
await Bun.write(contextFile, 'Opened from another process.')
const app = await launch({
  command: binary,
  args: [],
  env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home'), VELLUM_AGENT: path.resolve(import.meta.dir, 'fake-acp.ts') },
})
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const ids = async () => (await app.getByType('div').all()).map((n) => n.testId ?? '')
let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}

try {
  const c = app.getByTestId('composer')
  await c.waitFor({ timeoutMs: 60_000 })
  await wait(1500)
  await app.screenshot({ path: 'screenshots/app-1-open.png' })
  expect('the packaged app opens a note', true)

  if (windows) {
    expect('the iOS simulator control is hidden on Windows', (await app.getByTestId('open-mobile').count()) === 0)
    const registryValue = (key: string, value: string) => {
      const args = value === '(Default)' ? ['/ve'] : ['/v', value]
      const result = Bun.spawnSync(['reg', 'query', key, ...args], { stdout: 'pipe', stderr: 'ignore' })
      return result.exitCode === 0 ? result.stdout.toString() : ''
    }
    let registered = false
    for (let i = 0; i < 100 && !registered; i++) {
      registered = Boolean(registryValue('HKCU\\Software\\RegisteredApplications', 'Vellum'))
      if (!registered) await wait(100)
    }
    expect('Windows lists Vellum in Default Apps', registered)
    expect('Windows offers .vel files in Open with', Boolean(registryValue('HKCU\\Software\\Classes\\.vel\\OpenWithProgids', 'Vellum.Note')))
    expect('Windows offers text files in Open with', Boolean(registryValue('HKCU\\Software\\Classes\\.txt\\OpenWithProgids', 'Vellum.Note')))
    expect('Windows advertises .vel in Vellum capabilities', Boolean(registryValue('HKCU\\Software\\Vellum\\Capabilities\\FileAssociations', '.vel')))
    const openCommand = registryValue('HKCU\\Software\\Classes\\Vellum.Note\\shell\\open\\command', '(Default)')
    expect('Windows registers this executable as the file opener', openCommand.toLowerCase().includes(binary.toLowerCase()) && openCommand.includes('"%1"'))

    const second = Bun.spawn([binary, contextFile], { env: { ...process.env, VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home'), VELLUM_AGENT: path.resolve(import.meta.dir, 'fake-acp.ts') }, stdout: 'ignore', stderr: 'ignore' })
    const secondExit = await Promise.race([second.exited, wait(15_000).then(() => undefined)])
    if (secondExit === undefined) second.kill()
    expect('a second launch hands its file to the existing app', secondExit === 0)
    // Draft chips appear after the composer blurs; clicking the toolbar leaves the draft intact.
    await app.mouse.click(await app.getByTestId('open-history').center())
    let received = false
    for (let i = 0; i < 50 && !received; i++) {
      received = (await app.getByTestId('draft-chip-0').count()) === 1
      if (!received) await wait(100)
    }
    const chip = received ? await app.getByTestId('draft-chip-0').textContent() : ''
    const historyInput = app.getByTestId('history-input')
    if (await historyInput.count()) await historyInput.press('escape')
    expect('the existing app adds the opened text file to its draft', chip.includes('opened text file.txt'))
  }

  const before = new Set((await ids()).filter((id) => id.startsWith('reply-')))
  // "stream" gets a reply with no tool call, so no approval to answer.
  await c.fill('Please stream a hello from the bundle')
  await c.press(windows ? 'ctrl-enter' : 'cmd-enter')
  let replied = false
  for (let t = 0; t < 100 && !replied; t++) {
    replied = (await ids()).some((id) => id.startsWith('reply-') && !before.has(id))
    await wait(100)
  }
  expect('an agent turn runs through the binary', replied)
  await app.screenshot({ path: 'screenshots/app-2-reply.png' })

  await app.getByTestId('chip-0').click()
  await app.getByTestId('file-preview-name').waitFor({ timeoutMs: 5_000 })
  expect('a file tag opens its file in the pane', (await app.getByTestId('file-preview-name').textContent()) === 'theme.ts')

  await app.getByTestId('view-terminal').click()
  await app.getByTestId('pane-term').waitFor({ timeoutMs: 10_000 })
  await wait(1500)
  const term = app.getByTestId('term-running')
  await term.click()
  for (const k of [...'echo vellum42'].map((ch) => (ch === ' ' ? 'space' : ch)).concat('enter')) await term.press(k)
  await wait(1200)
  expect(windows ? 'an inline ConPTY runs' : 'a terminal runs through its own holder', (await app.getByTestId('pane-term').textContent()).includes('vellum42'))
  await app.screenshot({ path: 'screenshots/app-3-terminal.png' })
} finally {
  await app.close()
  // The POSIX holder outlives the app by design; this one belongs to the throwaway home.
  if (!windows) Bun.spawnSync(['pkill', '-f', `${binary} --termd ${home}`])
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
