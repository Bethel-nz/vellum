// Self-check for deleting notes (core/trash.ts, ui/Trash.tsx): in Past notes, the row's trash
// button and ⇧⌘⌫ each move a note to Trash, which closes it out of History. Settings › Trash lists
// them with days left; Restore puts one back in Past notes, and Delete asks, then removes it for
// good. A note trashed 31 days ago is gone at launch. Shots go to screenshots/trash-*.png.
//   bun scripts/check-trash.ts
import path from 'node:path'
import { launch } from '@gpuix/react/automation'
import { present, scratchDir } from './scratch'

const home = await scratchDir('vellum-trash-')
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } }).exited
const workspace = path.resolve(import.meta.dir, '..')
const note = (id: string, title: string, at: string, dir = path.join(home, 'threads')) =>
  Bun.write(path.join(dir, `${id}.jsonl`), [
      { type: 'vellum/meta', meta: { id, title, profileId: 'main', workspace, createdAt: at } },
      { type: 'vellum/user', text: `Notes on ${title.toLowerCase()}`, tags: [], at },
    ].map((l) => JSON.stringify(l)).join('\n') + '\n')
await note('20261024-gone01', 'Rename the store', '2026-10-24T08:00:00.000Z')
await note('20261024-gone02', 'Draft the changelog', '2026-10-24T08:30:00.000Z')
// Trashed long ago: the launch clears it out.
await note('20260901-old001', 'An old idea', '2026-09-01T08:00:00.000Z', path.join(home, 'trash'))
const old = new Date(Date.now() - 31 * 86_400_000).toISOString()
await Bun.write(path.join(home, 'trash', '20260901-old001.json'), JSON.stringify({ id: '20260901-old001', title: 'An old idea', workspace, profileId: 'main', deletedAt: old }))

const app = await launch({ command: 'bun', args: ['app.tsx'], env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const shot = (n: string) => app.screenshot({ path: `screenshots/trash-${n}.png` })
const count = (id: string) => app.getByTestId(id).count()
const inTrash = async (id: string) => await present(path.join(home, 'trash', `${id}.jsonl`))
const live = async (id: string) => await present(path.join(home, 'threads', `${id}.jsonl`))
let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}

try {
  const c = app.getByTestId('composer')
  await c.waitFor({ timeoutMs: 60_000 })
  await wait(1500)
  expect('a note 31 days in the trash is gone at launch', !(await inTrash('20260901-old001')) && !await present(path.join(home, 'trash', '20260901-old001.json')))

  await c.press('cmd-y')
  await app.getByTestId('history-input').waitFor({ timeoutMs: 3000 })
  await wait(600)
  const panel = await app.getByTestId('history').bounds()
  expect('Past notes is 480 wide, as Recipes is', Math.round(panel.width) === 480, `${Math.round(panel.width)}`)
  await app.getByTestId('history-view-recipes').click()
  await wait(500)
  expect('…and so is Recipes', Math.round((await app.getByTestId('history').bounds()).width) === 480)
  await app.getByTestId('history-view-history').click()
  await wait(500)

  await app.getByTestId('history-20261024-gone01').hover()
  await wait(300)
  await shot('1-hover')
  await app.getByTestId('history-delete-20261024-gone01').click()
  await wait(600)
  expect('the row’s trash button moves the note to Trash', (await inTrash('20261024-gone01')) && !(await live('20261024-gone01')))
  expect('…and it leaves Past notes', (await count('history-20261024-gone01')) === 0)

  await app.getByTestId('history-input').fill('changelog')
  await wait(500)
  await app.getByTestId('history-input').press('shift-cmd-backspace')
  await wait(600)
  expect('⇧⌘⌫ moves the selected one', (await inTrash('20261024-gone02')) && (await count('history-20261024-gone02')) === 0)
  await app.getByTestId('history-input').press('escape')
  await wait(500)

  await c.press('cmd-,')
  await app.getByTestId('settings').waitFor({ timeoutMs: 3000 })
  await app.getByTestId('settings-go-trash').click()
  await wait(600)
  expect('Settings › Trash lists both', (await count('trash-20261024-gone01')) === 1 && (await count('trash-20261024-gone02')) === 1)
  expect('…counted', (await app.getByTestId('trash-count').textContent()) === '2 notes')
  await shot('2-settings')

  await app.getByTestId('trash-restore-20261024-gone01').click()
  await wait(500)
  expect('Restore puts it back', (await live('20261024-gone01')) && !(await inTrash('20261024-gone01')) && (await count('trash-20261024-gone01')) === 0)

  await app.getByTestId('trash-delete-20261024-gone02').click()
  await wait(400)
  expect('Delete asks first', (await count('trash-delete-confirm-20261024-gone02')) === 1 && (await inTrash('20261024-gone02')))
  await shot('3-confirm')
  await app.getByTestId('trash-delete-confirm-20261024-gone02').click()
  await wait(500)
  expect('…then it’s gone for good', !(await inTrash('20261024-gone02')) && !(await live('20261024-gone02')))
  expect('an empty Trash says so', (await count('trash-empty-state')) === 1)
  await shot('4-empty')

  await app.getByTestId('settings').press('escape')
  await wait(500)
  await c.press('cmd-y')
  await app.getByTestId('history-input').waitFor({ timeoutMs: 3000 })
  // The search keeps what was typed last time.
  await app.getByTestId('history-input').fill('')
  await wait(600)
  expect('the restored note is in Past notes again', (await count('history-20261024-gone01')) === 1)
} finally {
  await app.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
