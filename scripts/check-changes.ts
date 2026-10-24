// Self-check for the Changes sheet: the strip shows how many files Claude changed, ⇧⌘D opens
// the sheet, a file row opens to its hunks, selecting a hunk updates the count, a click on a diff
// line opens a comment for it, and "Add" puts the hunk in the draft as a ± pill with that comment.
//   bun scripts/check-changes.ts
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launch } from '@gpuix/react/automation'

const home = mkdtempSync(path.join(tmpdir(), 'vellum-changes-'))
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } }).exited
const app = await launch({ command: 'bun', args: ['app.tsx'], env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const shot = (n: string) => app.screenshot({ path: 'screenshots/changes-' + n + '.png' })
const ids = async (prefix: string) => (await app.getByType('div').all()).map((n) => n.testId ?? '').filter((id) => id.startsWith(prefix))
let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}

try {
  const c = app.getByTestId('composer')
  await c.waitFor({ timeoutMs: 60_000 })
  await wait(1000)
  expect('the strip counts changed files', (await app.getByTestId('open-changes').count()) === 1)

  // it can always be dismissed: esc, and a click on the dimmed note beside it
  await c.press('cmd-shift-d')
  await app.getByTestId('changes').waitFor({ timeoutMs: 3000 })
  await wait(500)
  await app.getByTestId('changes').press('escape')
  await wait(400)
  expect('esc closes Changes', (await app.getByTestId('changes').count()) === 0)
  await c.press('cmd-shift-d')
  await app.getByTestId('changes').waitFor({ timeoutMs: 3000 })
  await wait(500)
  await app.mouse.click({ x: 120, y: 400 })
  await wait(400)
  expect('a click beside it closes Changes', (await app.getByTestId('changes').count()) === 0)

  await c.press('cmd-shift-d')
  await app.getByTestId('changes').waitFor({ timeoutMs: 3000 })
  await wait(600)
  expect('⇧⌘D opens Changes', (await app.getByTestId('change-ui/theme.ts').count()) === 1)
  await app.getByTestId('change-ui/theme.ts').click()
  await wait(500)
  const hunks = await ids('hunk-')
  expect('the row opens to its hunks', hunks.length >= 1, `${hunks.length}`)
  await app.getByTestId(hunks[0]!).click()
  await wait(300)
  expect('selecting counts it', (await app.getByTestId('changes-count').textContent()).startsWith('1 of'))
  await shot('1-selected')

  // a line of the hunk takes a comment: the second row is the removed `return parentRadius - inset`
  const b = await app.getByTestId(`hunk-diff-${hunks[0]!.slice('hunk-'.length)}`).bounds()
  await app.mouse.click({ x: b.x + 120, y: b.y + 30 })
  await wait(400)
  expect('a line click opens a comment field', (await app.getByTestId('hunk-comment').count()) === 1)
  await app.getByTestId('hunk-comment').fill('clamp it instead')
  await app.getByTestId('hunk-comment').press('enter')
  await wait(400)
  expect('the comment sits under the hunk', (await app.getByTestId('hunk-note-0').count()) === 1)
  expect('the header counts it', (await app.getByTestId('changes-count').textContent()).includes('1 comment'))

  // ⇧-click makes a range: the first row through the fourth
  const rowH = b.height / 5
  const row = (i: number) => ({ x: b.x + 120, y: b.y + (i + 0.5) * rowH })
  await app.mouse.click(row(0))
  await wait(300)
  await app.mouse.click(row(3), { modifiers: 'shift' })
  await wait(300)
  expect('⇧-click extends the selection', (await app.getByTestId('hunk-selection').count()) === 1 && (await app.getByText('Lines +1 to +3 · ⇧-click to extend · ↵ saves · esc cancels').count()) === 1)
  await shot('2-range')
  await app.getByTestId('hunk-comment').fill('this whole block')
  await app.getByTestId('hunk-comment').press('enter')
  await wait(400)
  expect('a range comment is kept', (await app.getByTestId('hunk-note-1').count()) === 1)
  await shot('2-comment')

  await app.getByTestId('changes-add').click()
  // The panel holds a beat for its scrim, and adding the pills re-renders the composer: poll.
  for (let t = 0; t < 2000 && (await app.getByTestId('changes').count()); t += 100) await wait(100)
  expect('Add closes the sheet', (await app.getByTestId('changes').count()) === 0)
  // drafts.json is written a moment after the draft changes.
  let drafts: Record<string, any> = {}
  for (let i = 0; i < 30 && !Object.keys(drafts).length; i++) {
    await wait(100)
    drafts = JSON.parse(readFileSync(path.join(home, 'drafts.json'), 'utf8'))
  }
  const d = Object.values(drafts)[0] as any
  expect('the hunk is a ± pill in the draft, not a diff fence', d.text.includes('±ui/theme.ts:1') && !d.text.includes('```'), JSON.stringify(d.text))
  const tag = d.tags.find((t: any) => t.type === 'hunk')
  expect('the pill carries the hunk and the comment', tag?.patch?.includes('@@') && tag?.notes?.[0]?.text === 'clamp it instead' && tag.notes[0].side === 'old', JSON.stringify(tag?.notes))
  expect('…and the range', tag?.notes?.[1]?.line === 1 && tag.notes[1].endLine === 3 && tag.notes[1].code.split('\n').length === 4, JSON.stringify(tag?.notes?.[1]))
  expect('the draft shows the pill once you write elsewhere', (await app.getByTestId('draft-chip-0').count()) === 1)
  await app.getByTestId('draft-chip-0').hover()
  await wait(500)
  expect('hovering the pill shows the hunk', (await app.getByTestId('hunk-slice').count()) === 1)
  await shot('3-draft')

  // A comment on its own: no hunk picked, one line commented, and only that goes.
  await c.press('cmd-shift-d')
  await app.getByTestId('changes').waitFor({ timeoutMs: 3000 })
  await wait(600)
  if (!(await ids('hunk-diff-')).length) await app.getByTestId('change-ui/theme.ts').click()
  await wait(500)
  const diff = (await ids('hunk-diff-'))[0]!
  const d2 = await app.getByTestId(diff).bounds()
  await app.mouse.click({ x: d2.x + 120, y: d2.y + 3.5 * (d2.height / 5) })
  await wait(400)
  await app.getByTestId('hunk-comment').fill('why zero')
  await app.getByTestId('hunk-comment').press('enter')
  await wait(400)
  const label = await app.getByTestId('changes-add').textContent().catch(() => '')
  expect('a comment alone can be added', label.includes('Add 1 comment to the note'), label)
  await shot('4-comment-only')
  await app.getByTestId('changes-add').click()
  for (let t = 0; t < 2000 && (await app.getByTestId('changes').count()); t += 100) await wait(100)
  let lone: any
  for (let i = 0; i < 30 && !lone; i++) {
    await wait(100)
    const all = JSON.parse(readFileSync(path.join(home, 'drafts.json'), 'utf8'))
    lone = (Object.values(all)[0] as any).tags.find((t: any) => t.type === 'hunk' && t.comments)
  }
  expect('…as its line and what you said, without the hunk', lone?.value === 'ui/theme.ts:3' && lone.notes?.length === 1 && lone.notes[0].text === 'why zero', JSON.stringify(lone && { value: lone.value, notes: lone.notes }))
  await wait(300)
  await shot('5-comment-pill')
} finally {
  await app.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
