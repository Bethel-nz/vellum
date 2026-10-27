// Scroll cost of the Changes sheet over a large working tree: 15 changed files, one of them a
// thousand-line rewrite, every file open. Prints the time per wheel step (the round trip covers
// the frame it causes) and how many hunk cards are mounted.
//   bun scripts/bench-changes.ts
import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { launch } from '@gpuix/react/automation'
import { remove, scratchDir } from './scratch'

const home = await scratchDir('vellum-bench-changes-')
const repo = path.join(home, 'repo')
await mkdir(repo, { recursive: true })
const git = async (...args: string[]) => {
  const proc = Bun.spawn(['git', '-c', 'user.name=bench', '-c', 'user.email=bench@example.com', ...args], { cwd: repo, stdout: 'ignore', stderr: 'ignore' })
  await proc.exited
}
const body = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `export const value${i} = compute('${tag}', ${i}) // line ${i}`).join('\n') + '\n'
await git('init', '-q')
for (let f = 0; f < 15; f++) await Bun.write(path.join(repo, `src/file${f}.ts`), body(f === 7 ? 1100 : 120, 'old'))
await git('add', '-A')
await git('commit', '-qm', 'base')
// Edits: every 6th line of each file, and the big one rewritten whole.
for (let f = 0; f < 15; f++) {
  const lines = body(f === 7 ? 1100 : 120, 'old').split('\n')
  const next = f === 7 ? body(1100, 'new').split('\n') : lines.map((l, i) => (i % 6 === 0 ? l.replace("'old'", "'new'") : l))
  await Bun.write(path.join(repo, `src/file${f}.ts`), next.join('\n'))
}

await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } }).exited
const id = '20261026-bench01'
await Bun.write(path.join(home, 'threads', `${id}.jsonl`), JSON.stringify({ type: 'vellum/meta', meta: { id, title: 'Bench', profileId: 'main', workspace: repo, createdAt: '2026-10-26T09:00:00.000Z' } }) + '\n')
await Bun.write(path.join(home, 'settings.json'), JSON.stringify({ lastThreadId: id }))

const app = await launch({ command: 'bun', args: ['app.tsx'], env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home'), VELLUM_WINDOW: '1280x800' } })
try {
  const c = app.getByTestId('composer')
  await c.waitFor({ timeoutMs: 60_000 })
  await c.press('cmd-shift-d')
  await app.getByTestId('changes').waitFor({ timeoutMs: 3000 })
  // A note with no changes of its own opens on the folder's.
  for (let i = 0; i < 100 && !(await app.getByTestId('change-src/file0.ts').count()); i++) await Bun.sleep(100)
  if (!(await app.getByTestId('change-src/file0.ts').count())) throw new Error(`no rows: ${(await app.getByTestId('changes').textContent()).slice(0, 120)}`)
  // Top down, scrolling each row into view before opening it.
  const sheet = await app.getByTestId('changes').bounds()
  const at = { x: sheet.x + sheet.width / 2, y: sheet.y + sheet.height / 2 }
  let clicked = 0
  for (let f = 0; f < 15; f++) {
    const row = app.getByTestId(`change-src/file${f}.ts`)
    for (let tries = 0; tries < 300; tries++) {
      const box = (await row.count()) ? await row.bounds().catch(() => undefined) : undefined
      if (box && box.y > sheet.y + 60 && box.y + box.height < sheet.y + sheet.height - 60) { await row.click(); clicked++; break }
      // Not painted yet means further down.
      await app.mouse.wheel(at, 0, box && box.y < sheet.y + 60 ? 300 : -500)
      await Bun.sleep(20)
    }
    await Bun.sleep(30)
  }
  await Bun.sleep(800)
  const mounted = (await app.getByType('diff').all()).length
  const opened = (await app.getByType('div').all()).filter((n) => n.testId?.startsWith('change-')).length
  // Back to the top, then the measured scroll down the whole review.
  for (let i = 0; i < 80; i++) await app.mouse.wheel(at, 0, 400)
  const times: number[] = []
  for (let i = 0; i < 80; i++) {
    const t = performance.now()
    await app.mouse.wheel(at, 0, -120)
    times.push(performance.now() - t)
  }
  times.sort((a, b) => a - b)
  const pct = (p: number) => times[Math.min(times.length - 1, Math.floor(times.length * p))]!.toFixed(1)
  console.log(`files opened: ${clicked}/15; rows mounted at the end: ${opened} files, ${mounted} diffs; wheel step ms: p50 ${pct(0.5)} p90 ${pct(0.9)} max ${pct(1)}`)
} finally {
  await app.close()
  await remove(home)
}
