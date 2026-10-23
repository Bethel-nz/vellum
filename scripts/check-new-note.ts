// Self-check for New note: the strip's + asks where (it used to create silently in the current
// note's folder), starts on the current note's folder and account, and honours a different pick.
//   bun scripts/check-new-note.ts
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launch } from '@gpuix/react/automation'
const home = mkdtempSync(path.join(tmpdir(), 'vellum-new-'))
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } }).exited
const repo = path.resolve(import.meta.dir, '..')
const app = await launch({ command: 'bun', args: ['app.tsx'], env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const threads = path.join(home, 'threads')
const known = new Set(readdirSync(threads))
/** Folder and account of the note made since the last call. */
const newest = () => {
  const made = readdirSync(threads).filter((f) => f.endsWith('.jsonl') && !known.has(f))
  if (made.length !== 1) throw new Error(`expected one new note, found ${made.length}`)
  known.add(made[0]!)
  const meta = JSON.parse(readFileSync(path.join(threads, made[0]!), 'utf8').split('\n')[0]!).meta
  return { workspace: meta.workspace as string, profileId: meta.profileId as string }
}
const expect = (what: string, got: unknown, want: unknown) => {
  if (got !== want) throw new Error(`${what}: got ${got}, want ${want}`)
  console.log(`ok  ${what}`)
}
let failed = false
try {
  await app.getByTestId('composer').waitFor({ timeoutMs: 60_000 })
  await wait(1500)

  // + opens the dialog instead of making a note.
  await app.getByTestId('new-thread').click()
  await app.getByTestId('create-thread').waitFor({ timeoutMs: 5_000 })
  await wait(1200)
  expect('+ makes no note before Create', readdirSync(threads).filter((f) => f.endsWith('.jsonl') && !known.has(f)).length, 0)
  // Create as it opens: the current note's folder and account.
  await app.getByTestId('create-thread').click()
  await wait(1200)
  const first = newest()
  expect('default folder is the current note’s', first.workspace, repo)
  expect('default account is the current note’s', first.profileId, 'main')

  // + again, pick the other recent folder: the note gets that folder.
  await app.getByTestId('new-thread').click()
  await app.getByTestId('create-thread').waitFor({ timeoutMs: 5_000 })
  await wait(1200)
  await app.getByTestId('recent-1').click()
  await wait(400)
  await app.getByTestId('create-thread').click()
  await wait(1200)
  expect('picked folder is used', newest().workspace, '/Users/APPLE/dev/other')
} catch (e) {
  failed = true
  console.error('FAIL', String(e))
  await app.screenshot({ path: 'screenshots/new-note-fail.png' }).catch(() => {})
} finally {
  await app.close?.()
}
process.exit(failed ? 1 : 0)
