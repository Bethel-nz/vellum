// clock-docstart.mjs - PROVES: the same clock installed at document start (context.addInitScript) also
// virtualizes the autoplay timer: 5 s interval -> ~17.5 s real at 0.25x (as predicted), no autoplay while
// paused, page input still handled while paused, 16.67 ms steps trace the 1x spring frame for frame
// (settles after 33 steps = 550 ms), and uninstall at idle hands back the clock with no jump; the page's
// later clearInterval(takeover-era id) still works.
// Run: node "research_notes/Previewing JavaScript animation edits/scripts/clock-docstart.mjs"  (from extension/; needs
//   require('playwright') resolvable, network access to https://flora.so/; Playwright 1.63 / Chromium 158 used)

import { open, installSampler, clockSource, realWait, mark, segments, fmt } from './clock-lib.mjs'

const { browser, page } = await open({ init: [installSampler, `(${clockSource})({ waapi: true })`] })
const clock = (fn, ...a) => page.evaluate(([fn, a]) => { const c = window.__vclock; return typeof c[fn] === 'function' ? c[fn](...a) : c[fn] }, [fn, a])
const moving = () => page.evaluate(() => { const s = window.__sampler.take(window.__sampler.t() - 250).samples; return s.some((r, i) => i && r[1] !== s[i - 1][1]) })
const waitMoving = async (want, max = 15000) => { const end = Date.now() + max; while (Date.now() < end) { if (await moving() === want) return true; await realWait(page, 50) } return false }
const lastX = () => page.evaluate(() => window.__sampler.take().samples.at(-1)[1])

console.log('installed at doc start:', await page.evaluate(() => !!window.__vclock), 'setInterval is wrapper:', await page.evaluate(() => !/native code/.test(String(window.setInterval))))
await waitMoving(true, 12000); await waitMoving(false)
await mark(page, 'rate 0.25'); await clock('setRate', 0.25)
const consistency = await page.evaluate(() => new Promise((res) => {
  const el = document.querySelector('.journal-carousel')
  el.addEventListener('keydown', (e) => res({ eventMinusPerf: +(e.timeStamp - performance.now()).toFixed(2), dateMinusPerf: Math.round(Date.now() - performance.now() - performance.timeOrigin), newDateMinusDateNow: new Date().getTime() - Date.now() }), { once: true })
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }))
}))
console.log('time-source consistency under 0.25x (ms):', consistency)
await waitMoving(true, 30000); await mark(page, 'autoplay fired at 0.25x'); await waitMoving(false, 8000)
await mark(page, 'pause'); await clock('pause')
await realWait(page, 8000)
await mark(page, 'ArrowRight while paused')
await page.focus('.journal-carousel'); await page.keyboard.press('ArrowRight'); await realWait(page, 400)
const afterKey = await page.evaluate(() => [...document.querySelectorAll('.journal-carousel article')].findIndex((a) => a.getAttribute('aria-hidden') === 'false'))
console.log('React handled key while paused: current article index', afterKey, 'x still', await lastX())
await mark(page, 'stepping 45 x 16.67ms')
const steps = []
for (let i = 0; i < 45; i++) { await clock('step'); await realWait(page, 100); steps.push(await lastX()) }
console.log('x per step:', steps.join(', '))
await mark(page, 'resume 1x'); await clock('setRate', 1)
await waitMoving(false, 8000)
await mark(page, 'uninstall at idle'); console.log('uninstall:', await clock('uninstall'), 'setInterval native again:', await page.evaluate(() => /native code/.test(String(window.setInterval))))
await waitMoving(true, 12000); await waitMoving(false, 4000)
// The page's own clearInterval(id-from-takeover) must still work: scroll out of view (useInView false -> cleanup)
await mark(page, 'scroll carousel out of view'); await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await realWait(page, 11000)
await mark(page, 'scroll back'); await page.evaluate(() => window.scrollTo(0, 0)); await page.evaluate(() => document.querySelector('.journal-carousel').scrollIntoView({ block: 'center' }))
await waitMoving(true, 12000); await waitMoving(false, 4000)
console.log('clearTimeout back to native:', await page.evaluate(() => /native code/.test(String(window.clearTimeout))))
const { samples, marks } = await page.evaluate(() => window.__sampler.take())
console.log('marks:', marks.map(([t, l]) => `${t}:${l}`).join(' | '))
for (const s of segments(samples)) console.log(fmt(s))
const p = marks.find((m) => m[1] === 'pause')[0], k = marks.find((m) => m[1].startsWith('ArrowRight'))[0]
console.log('during pause before key: distinct x', [...new Set(samples.filter((s) => s[0] > p + 50 && s[0] < k).map((s) => s[1]))])
// 1x reference frames of a transition (first segment) for comparison with stepping
const seg = segments(samples)[0]
console.log('1x frames:', samples.filter((s) => s[0] >= seg.start && s[0] <= seg.end + 1).map((s) => s[1]).join(', '))
await browser.close()
