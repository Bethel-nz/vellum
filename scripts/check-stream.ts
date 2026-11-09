// Streaming against scripts/fake-acp.ts (~100 deltas, no paid turns): the reply grows at natural
// ends, streams and finishes as the same rows, and nothing moves when it ends.
//   bun scripts/check-stream.ts
import path from 'node:path'
import { launch } from '@gpuix/react/automation'
import { scratchDir } from './scratch'

const home = await scratchDir('vellum-stream-')
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } }).exited
const app = await launch({
  command: 'bun',
  args: ['app.tsx'],
  env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home'), VELLUM_AGENT: path.resolve(import.meta.dir, 'fake-acp.ts') },
})
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const shot = (n: string) => app.screenshot({ path: 'screenshots/stream-' + n + '.png' })
type Row = { id: string; y: number; height: number }
const replyRows = async (prefix?: string): Promise<Row[]> =>
  (await app.getByType('div').all())
    .filter((n) => (prefix ? n.testId?.startsWith(prefix) : /^reply-.+-\d+$/.test(n.testId ?? '')) && n.bounds)
    .map((n) => ({ id: n.testId!, y: n.bounds!.y, height: n.bounds!.height }))
let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}

try {
  const c = app.getByTestId('composer')
  await c.waitFor({ timeoutMs: 60_000 })
  await wait(2500)
  const before = new Set((await replyRows()).map((r) => r.id.split('-').slice(0, -1).join('-')))
  await c.click()
  await c.fill('Please stream the summary')
  const sent = Date.now()
  await c.press('cmd-enter')

  let reply = ''
  let firstAt = 0
  let last: Row[] = []
  const heights = new Set<number>()
  for (let t = 0; t < 200; t++) {
    const rows = await replyRows(reply || undefined)
    const fresh = reply ? rows : rows.filter((r) => !before.has(r.id.split('-').slice(0, -1).join('-')))
    if (!reply && fresh.length) {
      reply = fresh[0]!.id.split('-').slice(0, -1).join('-') + '-'
      firstAt = Date.now()
    }
    const running = (await app.getByTestId('stop').count()) > 0
    if (reply && !running) break
    if (reply) {
      last = fresh
      heights.add(Math.round(fresh.reduce((h, r) => h + r.height, 0)))
      if (heights.size === 3) await shot('1-writing')
    }
    await wait(40)
  }
  await wait(600)
  const done = await replyRows(reply)
  expect('the first words show soon after sending', firstAt > 0 && firstAt - sent < 1500, `${firstAt - sent}ms`)
  expect('it grows at natural ends, not with every delta', heights.size >= 2 && heights.size <= 24, `${heights.size} sizes for ~100 deltas`)
  expect('it finishes as the rows it streamed in', last.length > 0 && last.every((r) => done.some((d) => d.id === r.id)), `${last.length} → ${done.length} rows`)
  // Against the reply's first row: the note itself may scroll as the status row under it goes.
  const top = (rows: Row[]) => rows[0]?.y ?? 0
  const moved = last.slice(0, -1).filter((r) => { const d = done.find((x) => x.id === r.id); return !d || d.y - top(done) !== r.y - top(last) || d.height !== r.height })
  expect('no finished block moves or resizes inside the reply when it ends', moved.length === 0, moved.map((r) => r.id).join(', '))
  await shot('2-done')
} finally {
  await app.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
