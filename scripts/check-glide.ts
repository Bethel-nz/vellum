// Self-check for the glide back to the composer (ui/glide.ts): in a note taller than the window,
// scroll up until the composer is out of view, then type. The note slides down to the composer
// over a few frames, not in one jump, and the typing lands in the draft. A scroll of your own
// during the glide stops it there. Under reduced motion it's a jump.
//   bun scripts/check-glide.ts
//   MOTION=reduce bun scripts/check-glide.ts
import path from 'node:path'
import { launch } from '@gpuix/react/automation'
import { scratchDir } from './scratch'

const mode = process.env.MOTION === 'reduce' ? 'reduce' : 'full'
const home = await scratchDir('vellum-glide-')
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } }).exited

const id = '20261024-glide1'
const lines: unknown[] = [{ type: 'vellum/meta', meta: { id, title: 'A long note', profileId: 'main', workspace: path.resolve(import.meta.dir, '..'), createdAt: '2026-10-24T09:00:00.000Z' } }]
for (let i = 0; i < 8; i++) {
  lines.push({ type: 'vellum/user', text: `Question ${i + 1}: what about the drafts?`, tags: [], at: `2026-10-24T09:${String(10 + i).padStart(2, '0')}:00.000Z` })
  const reply = Array.from({ length: 5 }, (_, k) => `Paragraph ${k + 1} of answer ${i + 1}. It runs long enough to fill a few lines of the page, so the note is far taller than the window.`).join('\n\n')
  lines.push({ type: 'acp/update', update: { sessionUpdate: 'agent_message_chunk', messageId: `m${i}`, content: { type: 'text', text: reply } } })
  lines.push({ type: 'acp/end', stopReason: 'end_turn' })
}
await Bun.write(path.join(home, 'threads', `${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
await Bun.write(path.join(home, 'settings.json'), JSON.stringify({ lastThreadId: id, motion: mode }))

const app = await launch({ command: 'bun', args: ['app.tsx'], env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}
const c = app.getByTestId('composer')
/** The composer's top inside the page, or undefined while it isn't painted. */
const composerY = async () => {
  const page = await app.getByTestId('page').bounds()
  const b = await c.bounds().catch(() => undefined)
  return b && b.y + b.height > page.y && b.y < page.y + page.height ? Math.round(b.y - page.y) : undefined
}
const scrollUp = async (ticks: number) => {
  const page = await app.getByTestId('page').bounds()
  for (let i = 0; i < ticks; i++) await app.mouse.wheel({ x: page.x + page.width / 2, y: page.y + page.height / 2 }, 0, 400)
  await wait(300)
}
const type = (keys: string) => app.call('keystrokes' as never, { keys } as never)
/** Samples the composer's position every ~30ms for `ms`. */
const sample = async (ms: number) => {
  const ys: (number | undefined)[] = []
  const end = Date.now() + ms
  while (Date.now() < end) {
    ys.push(await composerY())
    await wait(30)
  }
  return ys
}

try {
  await c.waitFor({ timeoutMs: 60_000 })
  await wait(2500)
  const rest = await composerY()
  expect('the note opens at its end, composer in view', rest !== undefined, `${rest}`)
  await c.click()
  await wait(200)

  // Typing at the end doesn't move anything.
  await type('a')
  await wait(400)
  expect('typing at the end leaves the note where it is', (await composerY()) === rest, `${rest} → ${await composerY()}`)

  // Close by: a few lines up, the glide covers the distance.
  await scrollUp(1)
  const near = await composerY()
  expect('a short scroll up moves the composer down', near === undefined || (rest !== undefined && near > rest), `${near}`)
  await type('b')
  const nearPath = await sample(600)
  await wait(200)
  expect('typing brings it back', (await composerY()) === rest, `${await composerY()} vs ${rest}`)

  // Far away: scrolled to the top, the composer isn't even painted.
  await scrollUp(30)
  expect('scrolled far up, the composer is out of view', (await composerY()) === undefined)
  await type('c')
  const farPath = await sample(900)
  await wait(200)
  expect('typing far up brings it back too', (await composerY()) === rest, `${await composerY()} vs ${rest}`)
  const between = farPath.filter((y) => y !== undefined && y !== rest)
  if (mode === 'full') {
    expect('…over several frames, not one jump', new Set(between).size >= 3, JSON.stringify(farPath))
    expect('…moving one way only', between.every((y, i) => i === 0 || y! <= between[i - 1]!), JSON.stringify(between))
  } else {
    expect('…in one jump under reduced motion', between.length <= 1, JSON.stringify(farPath))
  }
  console.log('near path', JSON.stringify(nearPath))
  console.log('far path ', JSON.stringify(farPath))

  // A scroll of your own during the glide wins.
  if (mode === 'full') {
    await scrollUp(30)
    await type('d')
    await wait(120)
    await scrollUp(2)
    const stoppedAt = await composerY()
    await wait(700)
    expect('a scroll during the glide stops it', (await composerY()) === stoppedAt && stoppedAt !== rest, `${stoppedAt} → ${await composerY()}`)
  }

  // Everything typed went into the draft.
  await scrollUp(30)
  await c.press('cmd-enter')
  await wait(1500)
  expect('sending from far up brings the note down too', (await composerY()) !== undefined)
  await app.screenshot({ path: `screenshots/glide-${mode}-sent.png` })
} finally {
  await app.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
