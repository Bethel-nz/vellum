// Clicks spikes/input-focus.tsx's two inputs in turn; prints what the inputs reported.
import { readFileSync, writeFileSync } from 'node:fs'
import { launch } from '@gpuix/react/automation'
const out = `${process.env.TMPDIR ?? '/tmp'}/input-focus.txt`
writeFileSync(out, '')
const app = await launch({ command: 'bun', args: ['spikes/input-focus.tsx'], env: { GPUIX_BACKGROUND: '1', SPIKE_OUT: out } })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
try {
  await app.getByTestId('a').waitFor({ timeoutMs: 30_000 })
  await app.getByTestId('a').click(); await wait(300)
  await app.getByTestId('b').click(); await wait(300)
  console.log(JSON.stringify(readFileSync(out, 'utf8')))
} finally {
  await app.close()
}
