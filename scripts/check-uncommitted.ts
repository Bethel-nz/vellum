// Self-check for Changes in a folder with edits nobody made in the note: a git repo with a
// changed file and a new one, and a note there that changed nothing. The strip offers Changes
// with the folder's totals, and Changes opens on Uncommitted with both files.
//   bun scripts/check-uncommitted.ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launch } from '@gpuix/react/automation'

const home = mkdtempSync(path.join(tmpdir(), 'vellum-uncommitted-'))
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } }).exited

// The project: one commit, then a change to it and a new file.
const repo = path.join(home, 'project')
mkdirSync(repo)
const git = (...args: string[]) => Bun.spawnSync(['git', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo })
git('init', '-q')
writeFileSync(path.join(repo, 'app.ts'), 'export const a = 1\nexport const b = 2\n')
git('add', '.')
git('commit', '-qm', 'first')
writeFileSync(path.join(repo, 'app.ts'), 'export const a = 1\nexport const b = 3\nexport const c = 4\n')
writeFileSync(path.join(repo, 'notes.md'), '# Notes\n')

const id = '20261024-uncom1'
const lines = [
  { type: 'vellum/meta', meta: { id, title: 'A project with edits', profileId: 'main', workspace: repo, createdAt: '2026-10-24T09:00:00.000Z' } },
  { type: 'vellum/user', text: 'What is in this project?', tags: [], at: '2026-10-24T09:00:01.000Z' },
]
writeFileSync(path.join(home, 'threads', `${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ lastThreadId: id }))

let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const app = await launch({ command: 'bun', args: ['app.tsx'], env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } })
try {
  await app.getByTestId('composer').waitFor({ timeoutMs: 60_000 })
  await app.getByTestId('open-changes').waitFor({ timeoutMs: 15_000 }).catch(() => {})
  const pill = (await app.getByTestId('open-changes').count()) === 1
  const summary = pill ? await app.getByTestId('open-changes').textContent().catch(() => '') : ''
  expect('the strip offers Changes for the folder’s two files', pill && summary.includes('2 files'), summary)
  await app.screenshot({ path: 'screenshots/uncommitted-1-strip.png' })
  if (pill) await app.getByTestId('open-changes').click()
  await app.getByTestId('changes').waitFor({ timeoutMs: 3000 }).catch(() => {})
  await wait(1500)
  const scope = await app.getByTestId('changes-scope').textContent().catch(() => '')
  expect('Changes opens on Uncommitted', scope.includes('Uncommitted'), scope)
  const files = (await app.getByType('div').all()).map((n) => n.testId ?? '').filter((t) => t.startsWith('change-'))
  expect('…with the changed file and the new one', files.includes('change-app.ts') && files.includes('change-notes.md'), files.join(','))
  await app.screenshot({ path: 'screenshots/uncommitted-2-panel.png' })
} finally {
  await app.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
