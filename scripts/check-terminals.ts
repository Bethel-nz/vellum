// Self-check for the terminal view: the terminal icon opens a shell in the note's folder as its own
// tab, the notes icon goes back, a terminal tab comes back to it, the shell outlives a quit and
// comes back as a tab with its output, and the ✕ on its tab ends it and returns to the notes. The
// view has no header of its own.
//   bun scripts/check-terminals.ts
import path from 'node:path'
import { launch } from '@gpuix/react/automation'
import { present, scratchDir } from './scratch'
const home = await scratchDir('vellum-terms-')
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home } }).exited
const start = () => launch({ command: 'bun', args: ['app.tsx'], env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } })
let app = await start()
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const until = async (ok: () => Promise<boolean>, ms = 5000) => {
  const start = Date.now()
  while (!(await ok()) && Date.now() - start < ms) await wait(150)
  return ok()
}
const shot = (n: string) => app.screenshot({ path: 'screenshots/terms-' + n + '.png' })
const count = (id: string) => app.getByTestId(id).count()
const termTabs = async () => (await app.getByType('div').all()).map((n) => n.testId ?? '').filter((id) => id.startsWith('tab-term-'))
let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}
try {
  await app.getByTestId('composer').waitFor({ timeoutMs: 60_000 })
  await wait(1200)
  expect('both view icons are in the strip', (await count('view-notes')) === 1 && (await count('view-terminal')) === 1)
  await shot('1-notes')

  await app.getByTestId('view-terminal').click()
  await app.getByTestId('pane-term').waitFor({ timeoutMs: 10_000 })
  await wait(1500)
  expect('the terminal icon opens a shell as its own tab', (await termTabs()).length === 1, (await termTabs()).join(','))
  expect('the notes are out of the way', (await count('composer')) === 0)
  const term = app.getByTestId('term-running')
  await term.click()
  for (const k of [...'echo vellum42'].map((c) => (c === ' ' ? 'space' : c)).concat('enter')) await term.press(k)
  await wait(1200)
  expect('it runs in the note’s folder and shows output', (await app.getByTestId('pane-term').textContent()).includes('vellum42'))
  await shot('2-terminal')

  // Scrolling back: enough output to push the command itself off the top.
  for (const k of [...'seq 200'].map((c) => (c === ' ' ? 'space' : c)).concat('enter')) await term.press(k)
  await wait(1200)
  const screen = () => app.getByTestId('pane-term').textContent()
  expect('long output pushes the command off screen', !(await screen()).includes('seq 200'))
  // GPUI's sign: a positive deltaY scrolls toward earlier output.
  for (let i = 0; i < 10; i++) await app.getByTestId('pane-term').wheel(0, 600)
  expect('the wheel scrolls back to it', await until(async () => (await screen()).includes('seq 200')))
  await shot('2b-scrolled')
  await term.press('space')
  expect('typing comes back to the newest line', await until(async () => !(await screen()).includes('seq 200') && (await screen()).includes('200')))
  await term.press('backspace')

  await app.getByTestId('view-notes').click()
  await wait(900)
  expect('the notes icon goes back to the note', (await count('composer')) === 1 && (await count('pane-term')) === 0)
  expect('the terminal keeps running in its tab', (await termTabs()).length === 1)
  await shot('3-back')

  await app.getByTestId((await termTabs())[0]!).click()
  await wait(900)
  expect('its tab brings it back', (await count('pane-term')) === 1)

  await app.close()
  app = await start()
  await app.getByTestId('composer').waitFor({ timeoutMs: 60_000 })
  await wait(1500)
  expect('after a quit, the shell is back as a tab', (await termTabs()).length === 1, (await termTabs()).join(','))
  expect('…without leaving the note', (await count('composer')) === 1)
  await app.getByTestId((await termTabs())[0]!).click()
  await app.getByTestId('pane-term').waitFor({ timeoutMs: 5_000 })
  await wait(600)
  expect('…with what it said last on screen', (await app.getByTestId('pane-term').textContent()).includes('200'))
  for (let i = 0; i < 10; i++) await app.getByTestId('pane-term').wheel(0, 600)
  expect('…and what it said before in its scrollback', await until(async () => (await app.getByTestId('pane-term').textContent()).includes('vellum42')))
  const again = app.getByTestId('term-running')
  await again.click()
  for (const k of [...'echo back43'].map((c) => (c === ' ' ? 'space' : c)).concat('enter')) await again.press(k)
  await wait(1200)
  expect('…and still takes typing', (await app.getByTestId('pane-term').textContent()).includes('back43'))
  await shot('4-restored')
  await app.getByTestId(`close-${(await termTabs())[0]!.slice(4)}`).click()
  await wait(1200)
  expect('the tab’s ✕ ends it and returns to the notes', (await termTabs()).length === 0 && (await count('composer')) === 1)
} finally {
  await app.close()
  // A failed run mustn't leave a shell held in the scratch home.
  const pid = path.join(home, 'run', 'termd.sock.pid')
  if (failed && await present(pid)) process.kill(Number(await Bun.file(pid).text()))
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
