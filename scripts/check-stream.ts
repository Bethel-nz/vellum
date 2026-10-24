// Self-check for chunk-fade streaming, against scripts/fake-acp.ts (no paid turns): a reply that
// arrives in ~100 deltas surfaces in a handful of settled chunks, not character by character; the
// first words show soon after the first delta; a code fence only ever shows whole lines; and the
// finished reply becomes one block.
//   bun scripts/check-stream.ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launch } from '@gpuix/react/automation'
import { STREAMED } from './fake-stream'

const home = mkdtempSync(path.join(tmpdir(), 'vellum-stream-'))
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } }).exited
const app = await launch({
  command: 'bun',
  args: ['app.tsx'],
  env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home'), VELLUM_AGENT: path.resolve(import.meta.dir, 'fake-acp.ts') },
})
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const shot = (n: string) => app.screenshot({ path: 'screenshots/stream-' + n + '.png' })
const testIds = async () => (await app.getByType('div').all()).map((n) => n.testId ?? '')
let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}

try {
  const c = app.getByTestId('composer')
  await c.waitFor({ timeoutMs: 60_000 })
  await wait(2500)
  const before = new Set((await testIds()).filter((id) => /^(reply|stream)-/.test(id)))
  await c.fill('Please stream the summary')
  const sent = Date.now()
  await c.press('cmd-enter')

  // While it streams, the reply is chunks, `stream-<block>-<offset>`, each starting at that offset
  // of the reply; once done, it's one `reply-<block>`. The automation tree has no text for
  // <markdown> or <code>, so this reads the chunks' offsets, not their words.
  const offsets = new Set<number>()
  let firstAt = 0
  let done = false
  for (let t = 0; t < 150 && !done; t++) {
    const fresh = (await testIds()).filter((id) => id && !before.has(id))
    for (const id of fresh.filter((x) => x.startsWith('stream-'))) {
      if (!firstAt) firstAt = Date.now()
      offsets.add(Number(id.split('-').at(-1)))
    }
    if (offsets.size >= 2 && t % 10 === 0) await shot('1-writing')
    done = fresh.some((x) => x.startsWith('reply-'))
    await wait(40)
  }
  await wait(600)
  expect('the reply finishes as one block', done)
  expect('it surfaces in a handful of chunks, not a typewriter', offsets.size >= 2 && offsets.size <= 14, `${offsets.size} chunks for ~100 deltas`)
  expect('the first words show soon after sending', firstAt > 0 && firstAt - sent < 1500, `${firstAt - sent}ms`)
  // A chunk that starts inside the code fence starts on a whole line.
  const fence = [STREAMED.indexOf('```ts'), STREAMED.lastIndexOf('```')]
  const cuts = [...offsets].sort((a, b) => a - b)
  expect('a code fence only ever shows whole lines', cuts.every((o) => o <= fence[0]! || o > fence[1]! || STREAMED[o - 1] === '\n'), JSON.stringify(cuts))
  await shot('2-done')
} finally {
  await app.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
