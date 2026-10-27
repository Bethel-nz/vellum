// Spike: why does an automation-launched app sometimes vanish? Same spawn as
// @gpuix/react/automation's launch(), but stderr is kept and the exit is logged.
//   bun spikes/launch-exit.ts [cmd-w]
import path from 'node:path'
import { connectStdio } from '@gpuix/native/automation'
import { scratchDir } from '../scripts/scratch'
const home = await scratchDir('vellum-exit-')
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home } }).exited
const child = Bun.spawn(['bun', 'app.tsx'], { env: { ...process.env, GPUIX_BACKGROUND: '1', VELLUM_HOME: home }, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
let stderr = ''
void (async () => {
  const dec = new TextDecoder()
  for await (const b of child.stderr) stderr += dec.decode(b, { stream: true })
})()
void child.exited.then(async (code) => {
  console.log('app exited', { code, signal: child.signalCode })
  await Bun.write(path.join(home, 'stderr.log'), stderr)
  console.log(stderr.split('\n').slice(-15).join('\n'))
  process.exit(1)
})
const app = await connectStdio({
  write: (chunk: string) => {
    child.stdin.write(chunk)
    child.stdin.flush()
  },
  feed: (listener: (s: string) => void) => {
    void (async () => {
      const dec = new TextDecoder()
      for await (const b of child.stdout) listener(dec.decode(b, { stream: true }))
    })()
  },
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
