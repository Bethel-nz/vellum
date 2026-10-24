// Drives spikes/list-glide.tsx and prints each step's anchor ([item, offsetInItem, viewport]).
import { readFileSync, writeFileSync } from 'node:fs'
import { launch } from '@gpuix/react/automation'
const out = `${process.env.TMPDIR ?? '/tmp'}/list-glide.jsonl`
writeFileSync(out, '')
const app = await launch({ command: 'bun', args: ['spikes/list-glide.tsx'], env: { GPUIX_BACKGROUND: '1', SPIKE_OUT: out } })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
try {
  await app.getByTestId('root').waitFor({ timeoutMs: 30_000 })
  await wait(800)
  for (const id of ['raf', 'anchor', 'top', 'past-height', 'above', 'big-index', 'top', 'big-index-up', 'top', 'glide', 'big-index', 'grow', 'grow', 'top', 'count', 'overshoot', 'grow']) {
    await app.getByTestId(id).click()
    await wait(id === 'glide' ? 900 : 400)
  }
} finally {
  await app.close()
}
for (const line of readFileSync(out, 'utf8').split('\n').filter(Boolean)) {
  const { step, value } = JSON.parse(line)
  if (step !== 'range') console.log(step.padEnd(14), JSON.stringify(value))
}
