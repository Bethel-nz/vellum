// clock-release.mjs - PROVES: the recommended restore. release({ scope }) mid-transition at 0.5x finishes the
// spring at 1x with no snap (max per-frame step stays below the 1x reference), uninstalls once the carousel
// is quiet (jump lands while idle), and afterwards every patched global is native again once the page's
// takeover-era timer ids end.
// Run: node "research_notes/Previewing JavaScript animation edits/scripts/clock-release.mjs"  (from extension/; needs
//   require('playwright') resolvable, network access to https://flora.so/; Playwright 1.63 / Chromium 158 used)

import { open, installSampler, clockSource, realWait, mark, segments, fmt } from './clock-lib.mjs'

const { browser, page } = await open({ init: [installSampler, `(${clockSource})({ waapi: true, translateStartTime: true })`] })
const clock = (fn, ...a) => page.evaluate(([fn, a]) => window.__vclock[fn](...a), [fn, a])
const moving = () => page.evaluate(() => { const s = window.__sampler.take(window.__sampler.t() - 250).samples; return s.some((r, i) => i && r[1] !== s[i - 1][1]) })
const waitMoving = async (want, max = 15000) => { const end = Date.now() + max; while (Date.now() < end) { if (await moving() === want) return true; await realWait(page, 50) } return false }
const maxStep = (rows) => rows.reduce((m, r, i) => i && rows[i - 1][1] !== null && r[1] !== null ? Math.max(m, Math.abs(r[1] - rows[i - 1][1])) : m, 0)

await waitMoving(true, 12000); await waitMoving(false)
await clock('setRate', 0.5); await mark(page, 'rate 0.5')
await waitMoving(true, 20000); await realWait(page, 400)
await mark(page, 'release() mid-transition')
const r = await page.evaluate(() => window.__vclock.release({ scope: '.journal-carousel', quietMs: 250 }))
await mark(page, 'released'); console.log('release ->', r)
await waitMoving(true, 12000); await waitMoving(false)
const { samples, marks } = await page.evaluate(() => window.__sampler.take())
console.log('marks:', marks.map(([t, l]) => `${t}:${l}`).join(' | '))
for (const s of segments(samples)) console.log(fmt(s))
const segs = segments(samples)
const inSeg = (s) => samples.filter((x) => x[0] >= s.start && x[0] <= s.end)
segs.forEach((s, i) => console.log(`segment ${i}: largest per-frame step ${maxStep(inSeg(s)).toFixed(2)} px over ${s.frames} frames (longest frame gap ${inSeg(s).reduce((m, r, j, a) => j ? Math.max(m, r[0] - a[j - 1][0]) : m, 0).toFixed(1)} ms)`))
const inAny = (r) => segs.some((s) => r[0] >= s.start && r[0] <= s.end)
console.log('largest step between consecutive frames outside motion segments (a restore jump would show here):', samples.reduce((m, r, i) => i && !inAny(r) && !inAny(samples[i - 1]) && r[1] !== null && samples[i - 1][1] !== null ? Math.max(m, Math.abs(r[1] - samples[i - 1][1])) : m, 0).toFixed(2), 'px')
const rel = marks.find((m) => m[1].startsWith('release'))[0]
console.log('frames around release():', samples.filter((s) => s[0] > rel - 60 && s[0] < rel + 120).map((s) => `${Math.round(s[0])}:${s[1]}`).join(' '))
const natives = () => page.evaluate(() => { const n = (f) => /native code/.test(String(f)); return Object.entries({ 'performance.now': n(performance.now) && !Object.getOwnPropertyDescriptor(performance, 'now'), 'Date.now': n(Date.now), Date: n(Date), setTimeout: n(setTimeout), setInterval: n(setInterval), clearTimeout: n(clearTimeout), clearInterval: n(clearInterval), requestAnimationFrame: n(requestAnimationFrame), 'Event#timeStamp': n(Object.getOwnPropertyDescriptor(Event.prototype, 'timeStamp').get), 'Animation#startTime': n(Object.getOwnPropertyDescriptor(Animation.prototype, 'startTime').set) }).filter(([, ok]) => !ok).map(([k]) => k) })
console.log('not native right after release:', await natives(), '(clear* stay pass-through while takeover-era ids live)')
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await realWait(page, 8000)
console.log('not native after the page cleared its interval and the moved timeout fired:', await natives())
console.log('Temporal present (not virtualized by this clock):', await page.evaluate(() => typeof Temporal))
await browser.close()
