// End-to-end: the built extension edits GSAP tweens on a local page that loads GSAP 3.15.1 from jsDelivr.
// Run from the repo: `cd extension && bun run build && node review/script-motion/gsap-e2e.mjs` (~60 s).
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { HERE, S, open } from './harness.mjs'
const server = createServer((request, response) => {
  try { const body = readFileSync(path.join(HERE, 'site', path.basename(request.url) || 'index.html')); response.setHeader('content-type', 'text/html'); response.end(body) }
  catch { response.statusCode = 404; response.end() }
})
await new Promise((resolve) => server.listen(8766, '127.0.0.1', resolve))
const { ctx, sw, page, tabId, errors } = await open({ url: 'http://127.0.0.1:8766/gsap.html', ready: '#loop', scroll: '#loop' })
const log = (label, value) => console.log(label.padEnd(34), typeof value === 'string' ? value : JSON.stringify(value))
const EXPLORE = process.argv.includes('--explore')
try {
  const tween = (selector) => page.evaluate((selector) => { const t = window.gsap.getTweensOf(selector).at(-1); return t ? { duration: t.duration(), ease: t.vars.ease } : null }, selector)
  // Twice the tween's duration: the time between successive upward passes through the middle of the loop.
  const period = () => page.evaluate(() => new Promise((resolve) => {
    const crossings = []; let last = window.gsap.getProperty('#loop', 'x')
    const tick = () => { const x = window.gsap.getProperty('#loop', 'x'); if (last < 150 && x >= 150) crossings.push(performance.now()); last = x; if (crossings.length < 3) requestAnimationFrame(tick); else resolve(Math.round((crossings[2] - crossings[0]) / 2)) }
    requestAnimationFrame(tick); setTimeout(() => resolve('timeout'), 12000)
  }))
  const select = async (selector) => { const box = await page.locator(selector).boundingBox(); await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2) }
  const press = async (name, keys) => { const slider = page.getByRole('slider', { name }); await slider.focus(); for (const key of keys) await slider.press(key) }
  log('a. loop period before (ms)', String(await period()))
  await select('#loop')
  await page.getByRole('button', { name: 'Show element controls' }).click()
  await page.waitForTimeout(600)
  log('note', await page.locator('.vellum-motion-note').textContent())
  log('duration slider', await page.getByRole('slider', { name: 'Duration' }).getAttribute('aria-valuenow'))
  if (EXPLORE) { const html = await page.locator('.vellum-dial-editor').innerHTML(); const at = html.indexOf('>Ease<'); console.log(html.slice(Math.max(0, at - 400), at + 900).replace(/<svg[\s\S]*?<\/svg>/g, '<svg/>')) }
  await press('Duration', Array(10).fill('PageUp'))
  await page.waitForTimeout(300)
  log('b. edited tween', await tween('#loop'))
  log('b. loop period after (ms)', String(await period()))
  const note = await sw.evaluate(async (tabId) => (await chrome.tabs.sendMessage(tabId, { type: 'extract' })).capture.elements[0].note, tabId)
  log('c. note for the agent', note.split('\n').filter((line) => line.includes('GSAP')).join(' | '))
  await page.locator('.dialkit-select-trigger').filter({ hasText: 'Ease' }).click()
  log('ease shown', await page.locator('.dialkit-select-trigger').filter({ hasText: 'Ease' }).locator('.dialkit-select-value').textContent())
  await page.getByRole('option', { name: 'none', exact: true }).click()
  await page.waitForTimeout(300)
  log('d. ease set to none', await tween('#loop'))
  await page.screenshot({ path: `${S}/gsap-edited.png` }); log('screenshot', `${S}/gsap-edited.png`)
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await page.waitForTimeout(300)
  log('e. Reset', await tween('#loop'))
  log('e. loop period (ms)', String(await period()))
  await page.getByRole('button', { name: 'Show element controls' }).click()
  await page.waitForTimeout(400)
  await press('Duration', Array(10).fill('PageUp'))
  await page.waitForTimeout(300)
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  log('f. closed', await tween('#loop'))
  await sw.evaluate(async (tabId) => chrome.tabs.sendMessage(tabId, { type: 'toggle' }), tabId)
  await page.waitForTimeout(500)
  log('g. reopened', await tween('#loop'))
  await page.keyboard.press('Escape') // leave picking off the page so the next click selects
  await sw.evaluate(async (tabId) => chrome.tabs.sendMessage(tabId, { type: 'toggle' }), tabId)
  await page.waitForTimeout(400)
  await select('#tl-a')
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Show element controls' }).click()
  await page.waitForTimeout(400)
  log('h. timeline note', await page.locator('.vellum-motion-note').textContent())
  await page.getByRole('button', { name: 'Done' }).click()
  // A hover tween: hovering starts one, the edit applies, and the next hover's new tween picks it up.
  await page.getByRole('button', { name: 'Select an element' }).click()
  await page.hover('#hover'); await page.waitForTimeout(100)
  await select('#hover')
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Show element controls' }).click()
  await page.waitForTimeout(400)
  log('i. hover note', await page.locator('.vellum-motion-note').textContent())
  await press('Duration', Array(10).fill('PageUp'))
  await page.waitForTimeout(300)
  // The panel covers the box, so the next hover is fired directly: the page's handler creates a new tween.
  await page.dispatchEvent('#hover', 'mouseleave'); await page.waitForTimeout(50)
  log('i. tween the page made after the edit', await tween('#hover'))
  await page.getByRole('button', { name: 'Discard annotations' }).click()
  await page.waitForTimeout(400)
  log('j. discarded: methods unwrapped', await page.evaluate(() => !window[Symbol.for('vellum.snapshot.motion')].gsapWrapped && !String(window.gsap.to).includes('original.apply')))
  log('j. discarded: loop tween', await tween('#loop'))
} finally { log('page errors', errors); await ctx.close(); server.close() }
