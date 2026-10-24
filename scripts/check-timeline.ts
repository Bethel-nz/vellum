// Self-check for the timeline: a note with eight paragraphs of yours shows a tick for each at the
// far left; hovering one previews that paragraph; a click scrolls the note to it; the preview
// stays as the pointer moves onto it, and its Edit scrolls there and puts the caret in the
// paragraph, so what you type edits it (recorded as `vellum/edit`).
//   bun scripts/check-timeline.ts
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launch } from '@gpuix/react/automation'

const home = mkdtempSync(path.join(tmpdir(), 'vellum-timeline-'))
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } }).exited

const id = '20261024-time01'
const asks = [
  'Sketch the data model for drafts.',
  'Why does the composer lose focus after a paste?',
  'Rename Paragraph to Row everywhere.',
  'Make the history sheet searchable.',
  'What does followTail do with a growing last row?',
  'Add a test for the hunk range comments.',
  'Tighten the toast copy.',
  'Ship it: write the release note.',
]
const lines: unknown[] = [{ type: 'vellum/meta', meta: { id, title: 'A long note', profileId: 'main', workspace: path.resolve(import.meta.dir, '..'), createdAt: '2026-10-24T09:00:00.000Z' } }]
asks.forEach((text, i) => {
  const at = `2026-10-24T09:${String(10 + i * 4).padStart(2, '0')}:00.000Z`
  lines.push({ type: 'vellum/user', text, tags: [], at })
  const reply = Array.from({ length: 5 }, (_, k) => `Paragraph ${k + 1} of the answer to “${text}” It runs long enough to fill a few lines of the page, so the note is taller than the window.`).join('\n\n')
  lines.push({ type: 'acp/update', update: { sessionUpdate: 'agent_message_chunk', messageId: `m${i}`, content: { type: 'text', text: reply } } })
  lines.push({ type: 'acp/end', stopReason: 'end_turn' })
})
const file = path.join(home, 'threads', `${id}.jsonl`)
writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ lastThreadId: id }))

const app = await launch({ command: 'bun', args: ['app.tsx'], env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const shot = (n: string) => app.screenshot({ path: 'screenshots/timeline-' + n + '.png' })
let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}
const ids = async (prefix: string) => (await app.getByType('div').all()).map((n) => n.testId ?? '').filter((t) => t.startsWith(prefix))
const onScreen = async (testId: string) => {
  if ((await app.getByTestId(testId).count()) !== 1) return false
  // Mounted in the list's overdraw but not painted: off screen.
  const b = await app.getByTestId(testId).bounds().catch(() => undefined)
  if (!b) return false
  const page = await app.getByTestId('page').bounds()
  return b.y >= page.y && b.y + b.height <= page.y + page.height
}

try {
  await app.getByTestId('composer').waitFor({ timeoutMs: 60_000 })
  await wait(2500)
  const ticks = (await ids('timeline-')).filter((t) => t !== 'timeline-preview')
  expect('a tick for each of your paragraphs', ticks.length === asks.length, `${ticks.length}`)
  const blockIds = ticks.map((t) => t.slice('timeline-'.length))
  // At rest the rail is faded; hovering brings it up.
  await shot('0-rest')

  await app.getByTestId(ticks[1]!).hover()
  await app.getByTestId('timeline-preview').waitFor({ timeoutMs: 3000 }).catch(() => {})
  const preview = await app.getByTestId('timeline-preview').textContent().catch(() => '')
  expect('hovering a tick previews that paragraph', preview.includes(asks[1]!), preview)
  await shot('1-hover')

  expect('the first paragraph starts off screen (the note opens at its end)', !(await onScreen(`para-${blockIds[0]}`)))
  await app.getByTestId(ticks[0]!).click()
  await wait(700)
  expect('a click scrolls the note to it', await onScreen(`para-${blockIds[0]}`))
  await shot('2-jumped')

  await app.getByTestId(ticks[4]!).hover()
  await app.getByTestId('timeline-preview').waitFor({ timeoutMs: 3000 }).catch(() => {})
  await app.getByTestId('timeline-edit').hover()
  await wait(500)
  expect('the preview stays as the pointer moves onto it', (await app.getByTestId('timeline-edit').count()) === 1)
  await app.getByTestId('timeline-edit').click()
  await wait(800)
  expect('Edit scrolls to it', await onScreen(`para-${blockIds[4]}`))
  // No element: the keys go wherever the caret is.
  await app.call('keystrokes', { keys: 'cmd-down space z z' })
  await wait(1500)
  const edits = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.type === 'vellum/edit')
  expect('…and puts the caret in it, so typing edits that paragraph', edits.some((e) => e.blockId === blockIds[4] && e.text.endsWith(' zz')), JSON.stringify(edits.map((e) => [e.blockId, e.text])))
  await shot('3-editing')
} finally {
  await app.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
