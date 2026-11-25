// clock-late.mjs - PROVES: a virtual clock injected AFTER load (like Snapshot's on-demand executeScript)
// slows Motion's spring exactly (1x 567 ms -> 0.25x ~2216 ms, overshoot 2.22 px both), freezes it on pause,
// and steps it deterministically - but the carousel's autoplay setInterval, created before injection, keeps
// real time (pause still advances the index; the stepped move then travels 2 pages). Also shows uninstall()
// mid-transition snaps (forward jump = accumulated lag) while uninstall at idle does not.
// Run: node "research_notes/Previewing JavaScript animation edits/scripts/clock-late.mjs"  (from extension/; needs
//   require('playwright') resolvable, network access to https://flora.so/; Playwright 1.63 / Chromium 158 used)

import { open, installSampler, clockSource, realWait, mark, tnow, segments, fmt } from './clock-lib.mjs'

const { browser, page } = await open()
await page.evaluate(installSampler)
const evalClock = (opts) => page.evaluate(`(${clockSource})(${JSON.stringify(opts)})`)
const clock = (fn, ...a) => page.evaluate(([fn, a]) => { const c = window.__vclock; return typeof c[fn] === 'function' ? c[fn](...a) : c[fn] }, [fn, a])
const moving = () => page.evaluate(() => { const s = window.__sampler.take(window.__sampler.t() - 250).samples; return s.some((r, i) => i && r[1] !== s[i - 1][1]) })
const waitMoving = async (want, max = 15000) => { const end = Date.now() + max; while (Date.now() < end) { if (await moving() === want) return true; await realWait(page, 50) } return false }

// 1x baseline: wait for one autoplay transition to finish
await waitMoving(true); await waitMoving(false)
await mark(page, 'install late + rate 0.25')
console.log('install:', await evalClock({ waapi: true }))
await clock('setRate', 0.25)
const docAnims = await page.evaluate(() => document.getAnimations().map((a) => `${a.constructor.name}:${a.animationName ?? a.transitionProperty ?? a.id}:${a.playState}:${a.playbackRate}`))
console.log('document animations after rate 0.25:', docAnims)
await waitMoving(true, 8000); await mark(page, '0.25x transition started'); await waitMoving(false, 8000)
await mark(page, 'pause'); await clock('pause')
await realWait(page, 7000)
await mark(page, 'stepping 30 x 16.67ms, 120ms apart')
const steps = []
for (let i = 0; i < 30; i++) {
  await clock('step')
  await realWait(page, 120)
  steps.push(await page.evaluate(() => window.__sampler.take().samples.at(-1)[1]))
}
console.log('x after each step:', steps.join(', '))
await mark(page, 'resume 1x'); await clock('setRate', 1)
await waitMoving(false, 8000)
const lag = await clock('lag')
await mark(page, `uninstall at idle (lag ${Math.round(lag)}ms)`)
console.log('uninstall at idle:', await clock('uninstall'))
await waitMoving(true, 8000); await waitMoving(false, 4000)
await waitMoving(true, 8000); await waitMoving(false, 4000)
// Snap case: reinstall, slow down, uninstall mid-transition
await evalClock({ waapi: true }); await clock('setRate', 0.1); await mark(page, 'reinstall + rate 0.1')
await waitMoving(true, 8000); await realWait(page, 1500)
await mark(page, 'uninstall MID-transition'); console.log('uninstall mid-transition:', await page.evaluate(() => window.__vclock.uninstall()))
await realWait(page, 1500)
const { samples, marks } = await page.evaluate(() => window.__sampler.take())
console.log('marks:', marks.map(([t, l]) => `${t}:${l}`).join(' | '))
for (const s of segments(samples)) console.log(fmt(s))
// zoom around mid-transition uninstall
const u = marks.find((m) => m[1].startsWith('uninstall MID'))[0]
console.log('around mid uninstall:', samples.filter((s) => s[0] > u - 120 && s[0] < u + 120).map((s) => `${Math.round(s[0])}:${s[1]}`).join(' '))
const pauseAt = marks.find((m) => m[1] === 'pause')[0], stepAt = marks.find((m) => m[1].startsWith('stepping'))[0]
const during = samples.filter((s) => s[0] > pauseAt + 50 && s[0] < stepAt)
console.log('during pause: distinct x =', [...new Set(during.map((s) => s[1]))], 'frames', during.length)
await browser.close()
