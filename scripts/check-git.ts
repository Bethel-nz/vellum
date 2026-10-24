// Self-check for changes from git, against scripts/fake-acp.ts (no paid turns): in a git repo, a
// file a shell command wrote during the turn (no edit tool touched it) shows in the note as
// "Also changed" and in the Changes sheet with its hunk, and the repo's own index and objects
// are left as they were.
//   bun scripts/check-git.ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launch } from '@gpuix/react/automation'

const home = mkdtempSync(path.join(tmpdir(), 'vellum-git-'))
const repo = path.join(home, 'repo')
const sh = (...argv: string[]) => Bun.spawnSync(argv, { cwd: repo }).stdout.toString()
mkdirSync(repo)
sh('git', 'init', '-q')
writeFileSync(path.join(repo, 'README.md'), '# Demo\n')
sh('git', 'add', 'README.md')
sh('git', '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'base')
const before = { status: sh('git', 'status', '--porcelain'), objects: sh('git', 'count-objects', '-v') }

const id = '20261024-git001'
mkdirSync(path.join(home, 'threads'))
writeFileSync(path.join(home, 'profiles.json'), JSON.stringify([{ id: 'main', name: 'Default', color: '#1447e6', configDir: null, workspaces: [repo], loggedIn: true }]))
writeFileSync(path.join(home, 'threads', `${id}.jsonl`), JSON.stringify({ type: 'vellum/meta', meta: { id, title: 'Codegen', profileId: 'main', workspace: repo, createdAt: '2026-10-24T09:00:00.000Z' } }) + '\n')
writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ lastThreadId: id }))

const app = await launch({
  command: 'bun',
  args: ['app.tsx'],
  env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home'), VELLUM_AGENT: path.resolve(import.meta.dir, 'fake-acp.ts') },
})
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const shot = (n: string) => app.screenshot({ path: 'screenshots/git-' + n + '.png' })
let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}

try {
  const c = app.getByTestId('composer')
  await c.waitFor({ timeoutMs: 60_000 })
  await wait(800)
  await c.click()
  await c.fill('Run the codegen')
  await c.press('cmd-enter')
  for (let i = 0; i < 20 && !(await app.getByTestId('approval-allow').count()); i++) await wait(250)
  if (await app.getByTestId('approval-allow').count()) await app.getByTestId('approval-allow').click()
  await app.getByTestId('also-changed').waitFor({ timeoutMs: 10_000 }).catch(() => {})
  expect('the note says what the turn changed besides its edits', (await app.getByTestId('also-changed').count()) === 1)
  expect('…naming the file', (await app.getByTestId('also-changed').textContent()).includes('src/generated.ts'), await app.getByTestId('also-changed').textContent())
  await shot('1-note')

  await c.press('cmd-shift-d')
  await app.getByTestId('changes').waitFor({ timeoutMs: 3000 })
  await wait(600)
  expect('Changes lists the file', (await app.getByTestId('change-src/generated.ts').count()) === 1)
  await app.getByTestId('change-src/generated.ts').click()
  await wait(500)
  const hunks = (await app.getByType('div').all()).map((n) => n.testId ?? '').filter((t) => /^hunk-git/.test(t))
  expect('…with its hunk', hunks.length === 1, hunks.join(','))
  await shot('2-changes')

  expect("the repo's index and objects are untouched", sh('git', 'status', '--porcelain') === before.status + '?? src/\n' && sh('git', 'count-objects', '-v') === before.objects, sh('git', 'status', '--porcelain'))
} finally {
  await app.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
