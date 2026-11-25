// End-to-end: the built extension edits flora.so's Motion carousel spring through its own panel.
// Run from the repo: `cd extension && bun run build && node review/script-motion/motion-e2e.mjs` (~90 s).
// Expect: baseline ~2.2 px overshoot / ~530 ms; edited (duration 1.5, bounce 0.5) ~46.9 px / ~1470 ms on
// Replay and on autoplay; the original back after Reset, close and Discard; the edit back after reopening.
import { open, TRACK, S, startSampler, lastMove } from './harness.mjs'
const { ctx, sw, page, tabId, errors } = await open()
const log = (label, value) => console.log(label.padEnd(36), typeof value === 'string' ? value : JSON.stringify(value))
const overridden = () => page.evaluate((sel) => {
  const track = document.querySelector(sel); const key = Object.keys(track).find((k) => k.startsWith('__reactFiber$'))
  for (let f = track[key]; f; f = f.return) { const ve = f.memoizedProps?.value?.visualElement; if (ve?.current === track) return { own: Object.hasOwn(ve, 'getDefaultTransition'), transition: ve.getDefaultTransition() } }
  return null
}, TRACK)
// The next move that starts after this call (a move already under way doesn't count).
async function nextMove(timeout = 11000) {
  const since = await page.evaluate(() => performance.now()); const start = Date.now()
  while (Date.now() - start < timeout) { await page.waitForTimeout(150); const m = await lastMove(page); if (m && m.startedAt > since && m.endedAgoMs > 250) { const { startedAt, moves, ...rest } = m; return rest } }
  return 'no move'
}
const sliders = () => page.getByRole('slider').evaluateAll((all) => all.filter((s) => ['Duration', 'Bounce'].includes(s.getAttribute('aria-label'))).map((s) => `${s.getAttribute('aria-label')}=${s.getAttribute('aria-valuenow')}`).join(' '))
const press = async (name, keys) => { const slider = page.getByRole('slider', { name }); await slider.focus(); for (const key of keys) await slider.press(key) }
const edit = async () => {
  await press('Bounce', ['PageUp', 'PageUp', 'PageUp', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight'])
  await press('Duration', [...Array(9).fill('PageUp'), ...Array(5).fill('ArrowRight')])
  await page.waitForTimeout(300)
}
const card = await page.locator('.journal-carousel').boundingBox()
await page.mouse.click(card.x + card.width / 2, card.y + card.height / 2)
await page.getByRole('button', { name: 'Show element controls' }).click()
await page.waitForTimeout(600)
await startSampler(page)
log('note', await page.locator('.vellum-motion-note').textContent())
log('sliders as read', await sliders())
log('a. baseline, autoplay', await nextMove())
await edit()
log('sliders after keyboard edit', await sliders())
log('page override', await overridden())
await page.screenshot({ path: `${S}/edited.png` }); log('screenshot', `${S}/edited.png`)
const clicked = Date.now()
await page.getByRole('button', { name: 'Replay', exact: true }).click()
await page.waitForTimeout(2300)
const replayed = await lastMove(page)
log('b. edited, Replay', { ...replayed, startedAfterClickMs: Date.now() - clicked - replayed.endedAgoMs - replayed.settleMs })
log('c. edited, next autoplay', await nextMove())
const note = await sw.evaluate(async (tabId) => (await chrome.tabs.sendMessage(tabId, { type: 'extract' })).capture.elements[0].note, tabId)
log('d. note for the agent', note.split('\n').filter((line) => line.includes('Motion')).join(' | '))
await page.getByRole('button', { name: 'Reset', exact: true }).click()
await page.waitForTimeout(400)
log('e. Reset: page override', await overridden())
log('e. Reset, next autoplay', await nextMove())
await page.getByRole('button', { name: 'Show element controls' }).click()
await page.waitForTimeout(500)
log('f. sliders after Reset', await sliders())
await edit()
log('f. edited again: page override', (await overridden()).own)
await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
await page.waitForTimeout(400)
log('g. closed: page override', (await overridden()).own)
log('g. closed, next autoplay', await nextMove())
await sw.evaluate(async (tabId) => chrome.tabs.sendMessage(tabId, { type: 'toggle' }), tabId)
await page.waitForTimeout(600)
log('h. reopened: page override', (await overridden()).own)
log('h. reopened, next autoplay', await nextMove())
await page.getByRole('button', { name: 'Discard annotations' }).click()
await page.waitForTimeout(400)
log('i. discarded: page override', (await overridden()).own)
log('i. discarded, next autoplay', await nextMove())
log('page errors', errors)
await ctx.close()
