// Self-check for the timeline: a note with eight paragraphs of yours shows a tick for each at the
// far left; hovering one previews that paragraph; a click scrolls the note to it; the preview
// stays as the pointer moves onto it, and its Edit scrolls there and puts the caret in the
// paragraph, so what you type edits it (recorded as `vellum/edit`). The note glides there one way
// only, up or down (ui/glide.ts); under reduced motion it jumps. How many frames the check sees
// depends on the machine: a never-shown window's timers can run a second apart, so the frame
// count is printed, not asserted.
//   bun scripts/check-timeline.ts
//   MOTION=reduce bun scripts/check-timeline.ts
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
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

const mode = process.env.MOTION === 'reduce' ? 'reduce' : 'full'
const settingsFile = path.join(home, 'settings.json')
writeFileSync(settingsFile, JSON.stringify({ ...(existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, 'utf8')) : {}), motion: mode }))
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

/**
 * A paragraph's top inside the page every ~30ms for `ms`, from just after `go`; undefined while it
 * isn't painted. Long enough for the glide (0.48s) plus the first render of rows the note hasn't
 * shown yet, which can hold the app for a second.
 */
const sample = async (testId: string, go: () => Promise<unknown>, ms = 2500) => {
  const page = await app.getByTestId('page').bounds()
  const ys: (number | undefined)[] = []
  await go()
  const end = Date.now() + ms
  while (Date.now() < end) {
    const b = await app.getByTestId(testId).bounds().catch(() => undefined)
    ys.push(b && b.y + b.height > page.y && b.y < page.y + page.height ? Math.round(b.y - page.y) : undefined)
    await wait(30)
  }
  return ys
}
/** The positions it moved through, in order, without repeats. */
const path_ = (ys: (number | undefined)[]) => ys.filter((y): y is number => y !== undefined).filter((y, i, all) => i === 0 || y !== all[i - 1])
const until = async (ok: () => Promise<boolean>, ms = 4000) => {
  const start = Date.now()
  while (!(await ok()) && Date.now() - start < ms) await wait(100)
  return ok()
}
/** Waits until the element has stayed put for ~300ms (a glide has landed), up to `ms`. */
const settled = async (testId: string, ms = 5000) => {
  const start = Date.now()
  let last: number | undefined
  let still = 0
  while (still < 3 && Date.now() - start < ms) {
    const y = (await app.getByTestId(testId).bounds().catch(() => undefined))?.y
    still = y !== undefined && y === last ? still + 1 : 0
    last = y
    await wait(100)
  }
}
const oneWay = (ys: number[], dir: 1 | -1) => ys.every((y, i) => i === 0 || Math.sign(y - ys[i - 1]!) === dir)

try {
  await app.getByTestId('composer').waitFor({ timeoutMs: 60_000 })
  await wait(2500)
  // The preview and its buttons share the prefix; they show if the pointer starts over the rail.
  const ticks = (await ids('timeline-')).filter((t) => !['timeline-preview', 'timeline-go', 'timeline-edit'].includes(t))
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
  const up = path_(await sample(`para-${blockIds[0]}`, () => app.getByTestId(ticks[0]!).click()))
  await wait(200)
  expect('a click scrolls the note to it', await onScreen(`para-${blockIds[0]}`))
  if (mode === 'full') {
    expect('…gliding up, one way only', up.length >= 1 && oneWay(up, 1), up.join(' → '))
    console.log(`     ${up.length} positions seen`)
  } else expect('…in one jump under reduced motion', up.length === 1, up.join(' → '))
  await shot('2-jumped')

  // A short way down: the next paragraph.
  const down = path_(await sample(`para-${blockIds[1]}`, () => app.getByTestId(ticks[1]!).click()))
  await wait(200)
  expect('a nearby tick scrolls down to it', await onScreen(`para-${blockIds[1]}`))
  if (mode === 'full') {
    expect('…gliding down, one way only', down.length >= 1 && oneWay(down, -1), down.join(' → '))
    console.log(`     ${down.length} positions seen`)
  } else expect('…in one jump under reduced motion', down.length === 1, down.join(' → '))

  await app.getByTestId(ticks[4]!).hover()
  await app.getByTestId('timeline-preview').waitFor({ timeoutMs: 3000 }).catch(() => {})
  await app.getByTestId('timeline-edit').hover()
  await wait(500)
  expect('the preview stays as the pointer moves onto it', (await app.getByTestId('timeline-edit').count()) === 1)
  await app.getByTestId('timeline-edit').click()
  expect('Edit scrolls to it', await until(() => onScreen(`para-${blockIds[4]}`)))
  // The caret goes in once the glide has landed: wait for the note to stop, then for the caret.
  await settled(`para-${blockIds[4]}`)
  await wait(1200)
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
