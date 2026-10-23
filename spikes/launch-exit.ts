// Spike: why does an automation-launched app sometimes vanish? Same spawn as
// @gpuix/react/automation's launch(), but stderr is kept and the exit is logged.
//   bun spikes/launch-exit.ts [cmd-w]
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { connectStdio } from '@gpuix/native/automation'
const home = mkdtempSync(path.join(tmpdir(), 'vellum-exit-'))
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home } }).exited
const child = spawn('bun', ['app.tsx'], { env: { ...process.env, GPUIX_BACKGROUND: '1', VELLUM_HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] })
let stderr = ''
child.stderr.on('data', (b) => (stderr += b.toString()))
child.on('exit', (code, signal) => {
  console.log('app exited', { code, signal })
  writeFileSync(path.join(home, 'stderr.log'), stderr)
  console.log(stderr.split('\n').slice(-15).join('\n'))
  process.exit(1)
})
const app = await connectStdio({
  write: (chunk: string) => child.stdin.write(chunk),
  feed: (listener: (s: string) => void) => child.stdout.on('data', (b) => listener(b.toString('utf8'))),
  close: async () => void child.kill(),
})
const c = app.getByTestId('composer')
await c.waitFor({ timeoutMs: 60_000 })
console.log('composer up')
if (process.argv[2] === 'cmd-w') {
  await c.click()
  await c.press('cmd-w')
  await new Promise((r) => setTimeout(r, 2000))
  console.log('after ⌘W, composers:', await c.count())
}
await app.close()
process.exit(0)
