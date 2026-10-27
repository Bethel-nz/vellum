// Self-check for interactive ! commands: typing, Enter, Ctrl+C, and a full-screen program.
//   bun scripts/check-terminal.ts
import path from 'node:path'
import { launch } from '@gpuix/react/automation'
import { scratchDir } from './scratch'

const home = await scratchDir('vellum-term-')
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } }).exited
const app = await launch({ command: 'bun', args: ['app.tsx'], env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const composer = app.getByTestId('composer')
await composer.waitFor({ timeoutMs: 60_000 })

// 1. read a line from the keyboard
await composer.click()
await composer.fill('!printf "name? "; read -r x; echo "hello, $x"')
await composer.press('cmd-enter')
await wait(800)
await app.getByText('running · click to type').click()
await wait(300)
console.log('focused after click:', (await app.getByText('running · ⌘Esc to leave').count()) === 1)
for (const k of ['v', 'e', 'l', 'l', 'u', 'm', 'enter']) await app.getByTestId('term-running').press(k)
await wait(800)
await app.screenshot({ path: 'screenshots/term-1-read.png' })

// 2. Ctrl+C stops a long command
await composer.click()
await composer.fill('!sleep 30; echo never')
await composer.press('cmd-enter')
await wait(800)
await app.getByTestId('term-running').press('ctrl-c')
await wait(800)
await app.screenshot({ path: 'screenshots/term-2-ctrlc.png' })

// 3. full-screen program: top, then q
await composer.click()
await composer.fill('!top -s 1 -n 8')
await composer.press('cmd-enter')
await wait(2500)
await app.screenshot({ path: 'screenshots/term-3-top.png' })
await app.getByTestId('term-running').press('q')
await wait(1000)
await app.screenshot({ path: 'screenshots/term-4-top-quit.png' })
console.log((await app.getByType('text').all()).length, 'text nodes')
await app.close()
