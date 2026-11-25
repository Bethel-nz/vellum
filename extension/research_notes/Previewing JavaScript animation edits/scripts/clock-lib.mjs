// clock-lib.mjs - shared harness for the clock-*.mjs experiments: launches Chromium, opens flora.so, and
// installs a sampler that reads the journal carousel track's translateX on every REAL frame using native
// rAF/performance.now captured before any clock exists. segments() turns samples into motion segments.
// Used by: node "research_notes/Previewing JavaScript animation edits/scripts/clock-lib.mjs"  (from extension/; needs
//   require('playwright') resolvable, network access to https://flora.so/; Playwright 1.63 / Chromium 158 used)

import { createRequire } from 'node:module'
import { clockSource } from './clock-vclock.mjs'
export { clockSource }
const require = createRequire(import.meta.url)
export const { chromium } = require('playwright')

export function installSampler() {
  if (window.__sampler) return
  const nativeNow = Performance.prototype.now, raf = window.requestAnimationFrame
  const rnow = () => nativeNow.call(performance)
  const out = []; const marks = []
  const t0 = rnow()
  const tick = () => {
    const track = document.querySelector('.journal-carousel > div > div')
    if (track) {
      const m = /translateX\((-?[\d.]+)px\)/.exec(track.style.transform)
      const x = m ? Number(m[1]) : (track.style.transform === 'none' ? 0 : null)
      const v = window.__vclock ? window.__vclock.now() - t0 : null
      out.push([Math.round((rnow() - t0) * 10) / 10, x, v === null ? null : Math.round(v * 10) / 10])
    }
    raf.call(window, tick)
  }
  raf.call(window, tick)
  Object.defineProperty(window, '__sampler', { value: {
    t: () => rnow() - t0,
    mark: (label) => marks.push([Math.round(rnow() - t0), label]),
    take: (from = 0) => ({ samples: out.filter((s) => s[0] >= from), marks }),
  } })
}

export const realWait = (page, ms) => page.waitForTimeout(ms)
export const mark = (page, label) => page.evaluate((l) => window.__sampler.mark(l), label)
export const tnow = (page) => page.evaluate(() => window.__sampler.t())

// Segments of motion: consecutive frames where x changes, split by >gap ms of stillness.
export function segments(samples, gap = 150) {
  const segs = []; let cur = null
  for (let i = 1; i < samples.length; i++) {
    const [t, x] = samples[i]; const [pt, px] = samples[i - 1]
    if (x === null || px === null) continue
    if (x !== px) {
      if (!cur) cur = { start: pt, from: px, min: Math.min(px, x), max: Math.max(px, x), frames: 0 }
      cur.end = t; cur.to = x; cur.frames++
      cur.min = Math.min(cur.min, x); cur.max = Math.max(cur.max, x)
    } else if (cur && t - cur.end > gap) { segs.push(cur); cur = null }
  }
  if (cur) segs.push(cur)
  return segs.map((s) => ({ ...s, dur: Math.round(s.end - s.start), overshoot: +(s.to < s.from ? s.to - s.min : s.max - s.to).toFixed(2) }))
}
export const fmt = (s) => `t=${s.start}..${s.end} real ms, dur=${s.dur} ms, frames=${s.frames}, ${s.from} -> ${s.to}, overshoot=${s.overshoot}px`

export async function open({ init = [], viewport = { width: 1440, height: 1700 } } = {}) {
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport })
  for (const s of init) await context.addInitScript(s)
  const page = await context.newPage()
  await page.goto('https://flora.so/', { waitUntil: 'load', timeout: 60000 })
  await page.waitForSelector('.journal-carousel > div > div', { state: 'attached' })
  return { browser, context, page }
}
