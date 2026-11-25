// fit-flora-sample.mjs: record flora.so's carousel track every frame, then fit each move.
//
// What it proves (by execution): sampling a JS-driven transform with no library hooks (main-world rAF
// loop reading getComputedStyle + the inline style, plus a MutationObserver on the style attribute) and
// fitting a damped spring recovers the Motion transition read back from React props,
// {type: "spring", duration: 0.55, bounce: 0.16}, at 60 Hz, 30 Hz, 12 Hz and with 0-2 ms timing jitter;
// a cubic-bezier fit loses on BIC. It also checks the standalone Motion port (fit-motion-spring.mjs)
// against Motion's own per-frame writes: inverting the port's curve at each written value gives Motion's
// elapsed time, which should be a constant offset from the frame time (only timestamp rounding left).
// And it shows the motion owner problem: the slide a person selects has no transform; its box x is the
// track's translateX plus a constant that steps +288 px one frame before each move (React rewrites the
// recycled slides' `left`), so the preview and the code change belong to the track, not the slide.
//
// Run: node fit-flora-sample.mjs [samples.json] [fits.json]      (records, then fits)
//      node fit-flora-sample.mjs fit-flora-samples.json fits.json reuse   (refits a saved recording offline)
//   needs network to flora.so; playwright resolves from the global node_modules (no `playwright install`).
import { createRequire } from 'module'
import fs from 'fs'
import { spring } from './fit-motion-spring.mjs'
import { detectSegments, fillHolds, fitSegment, fitSpring, describe } from './fit-core.mjs'
const { chromium } = createRequire(import.meta.url)('playwright')
const [samplesFile = 'fit-flora-samples.json', fitsFile = 'fit-flora-fits.json', reuse] = process.argv.slice(2) // reuse: refit an existing samples file offline

let data
if (reuse) data = JSON.parse(fs.readFileSync(samplesFile))
else {
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto('https://flora.so/', { waitUntil: 'load', timeout: 60000 })
await page.evaluate(() => scrollTo(0, 400))
await page.waitForFunction(() => [...document.querySelectorAll('div[class="absolute"]')].some((el) => /translateX/.test(el.style.transform)), null, { timeout: 30000 })
data = await page.evaluate(() => new Promise((resolve) => {
  const el = [...document.querySelectorAll('div[class="absolute"]')].find((el) => /translateX/.test(el.style.transform))
  const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'))
  let transition = null
  for (let f = el[key]; f && !transition; f = f.return) transition = f.memoizedProps?.transition ?? null
  const num = (s) => Number(/translateX\((-?[\d.e-]+)px\)/.exec(s)?.[1] ?? NaN)
  const raf = [], writes = []
  const mo = new MutationObserver(() => writes.push({ tl: document.timeline.currentTime, v: num(el.style.transform) }))
  // Start just after a move ends so two full moves fit in ~10.6 s (flora moves every 5 s).
  let value = el.style.transform, since = performance.now(), moved = false
  const wait = () => {
    if (el.style.transform !== value) { value = el.style.transform; since = performance.now(); moved = true }
    if (!(moved && performance.now() - since > 120)) return requestAnimationFrame(wait)
    mo.observe(el, { attributes: true, attributeFilter: ['style'] })
    let start
    const tick = (ts) => {
      start ??= ts
      const m = getComputedStyle(el).transform
      // card: the box x of a visible slide (what a person would select); it has no transform of its own
      raf.push({ ts, now: performance.now(), tx: new DOMMatrix(m === 'none' ? undefined : m).e, inline: num(el.style.transform), card: el.children[2].getBoundingClientRect().x, animations: el.closest('article').getAnimations({ subtree: true }).length })
      if (ts - start < 10600) requestAnimationFrame(tick); else { mo.disconnect(); resolve({ transition, raf, writes, ua: navigator.userAgent }) }
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(wait)
}))
await browser.close()
data = { when: new Date().toISOString(), ...data }
fs.writeFileSync(samplesFile, JSON.stringify(data))
}
console.log('React props transition:', JSON.stringify(data.transition), '|', data.raf.length, 'frames,', data.writes.length, 'style writes |', data.ua)

const variants = {
  'rAF frame time (60 Hz)': data.raf.map((r) => ({ t: r.ts, v: r.tx })),
  'performance.now() in rAF': data.raf.map((r) => ({ t: r.now, v: r.tx })),
  // the held value at the start and end of the recording bracket the change-only stream
  'style writes only (MutationObserver)': fillHolds([{ t: data.raf[0].ts, v: data.raf[0].inline }, ...data.writes.map((w) => ({ t: w.tl, v: w.v })), { t: data.raf.at(-1).ts, v: data.raf.at(-1).inline }]),
  '30 Hz (every 2nd frame)': data.raf.filter((r, i) => i % 2 === 0).map((r) => ({ t: r.ts, v: r.tx })),
  '12 Hz (sample() at 60 s records every 83 ms)': data.raf.filter((r, i) => i % 5 === 0).map((r) => ({ t: r.ts, v: r.tx })),
  '60 Hz + 0-2 ms timestamp jitter': data.raf.map((r, i) => ({ t: r.ts + Math.abs((Math.sin(i * 12.9898) * 43758.5453) % 1) * 2, v: r.tx })),
}
const fits = {}
for (const [name, samples] of Object.entries(variants)) {
  fits[name] = detectSegments(samples).filter((s) => s.settled && !s.jump && s.start > 0).map((seg) => ({ from: seg.from, to: seg.to, observedMs: Math.round(seg.durationObserved), ...describe(fitSegment(samples, seg)) }))
  for (const f of fits[name]) console.log(name.padEnd(46), `${f.from} -> ${f.to}`, f.choice.padEnd(6), 'dBIC', String(f.deltaBIC).padEnd(6), '| spring duration', f.spring.motion.duration, 'bounce', f.spring.motion.bounce, 'rmse', f.spring.fit.rmse, 'max', f.spring.fit.maxError, '| bezier', f.bezier.css, f.bezier.duration + 'ms', 'rmse', f.bezier.fit.rmse)
}

// Port check: Motion's elapsed time implied by each written value (monotonic part of each move) vs frame time.
const port = []
const writes = data.writes
let seg = []
const flush = () => {
  if (seg.length < 20) return
  const target = seg.at(-1).v, from = target - Math.sign(target - seg[0].v) * 288
  const gen = spring({ keyframes: [from, target], duration: 550, bounce: 0.16 })
  const offsets = []
  for (const w of seg) {
    if (Math.abs(w.v - from) >= Math.abs(target - from)) break // past the first crossing
    let lo = 0, hi = 300
    for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (Math.abs(gen.next(mid).value - from) < Math.abs(w.v - from)) lo = mid; else hi = mid }
    offsets.push(lo - (w.tl - seg[0].tl))
  }
  // A wrong time scale in the port would make the offset drift with time; fit a slope (ms per ms).
  const ts = seg.slice(0, offsets.length).map((w) => w.tl - seg[0].tl), mt = ts.reduce((a, b) => a + b) / ts.length, mo = offsets.reduce((a, b) => a + b) / offsets.length
  const slope = ts.reduce((a, t, i) => a + (t - mt) * (offsets[i] - mo), 0) / ts.reduce((a, t) => a + (t - mt) ** 2, 0)
  port.push({ from, target, writes: seg.length, writeSpanMs: +(seg.at(-1).tl - seg[0].tl).toFixed(1), impliedElapsedAtFirstWriteMs: +offsets[0].toFixed(2), offsetSpreadMs: +(Math.max(...offsets) - Math.min(...offsets)).toFixed(2), driftPercent: +(slope * 100).toFixed(2), checked: offsets.length })
}
for (let i = 0; i < writes.length; i++) { if (i && writes[i].tl - writes[i - 1].tl > 100) { flush(); seg = [] } seg.push(writes[i]) }
flush()
console.log('port check (offset spread = timestamp rounding only if the port is exact):', port)
// Motion owner: the selected slide moves only because its ancestor's transform does. Its box x minus the
// track's translateX is constant except for a step when React rewrites the recycled slides' `left`.
const runs = []
for (const r of data.raf) { const o = +(r.card - r.tx).toFixed(3); if (!runs.length || runs.at(-1).offsetPx !== o) runs.push({ offsetPx: o, fromMs: +(r.ts - data.raf[0].ts).toFixed(1), frames: 0 }); runs.at(-1).frames++ }
const moveStarts = data.raf.filter((r, i) => i && r.tx !== data.raf[i - 1].tx && data.raf[i - 1].tx === data.raf[Math.max(0, i - 2)].tx).map((r) => +(r.ts - data.raf[0].ts).toFixed(1))
const owner = { slideMinusTrack: runs, trackMoveStartsMs: moveStarts }
console.log('slide box x - track translateX:', JSON.stringify(owner))
// Duration-spring fingerprint: Motion snaps to the target at the first frame with elapsed >= duration.
const frames60 = variants['rAF frame time (60 Hz)']
const snap = detectSegments(frames60).filter((s) => s.settled && !s.jump && s.start > 0).map((seg) => {
  const f = fitSpring(frames60, seg, { fixVelocity: true })
  const i = frames60.findIndex((r) => r.t > seg.tFrom && r.v === seg.to)
  return { t0AfterLastStillMs: +(f.t0 - seg.tFrom).toFixed(1), snapAfterT0Ms: +(frames60[i].t - f.t0).toFixed(1), lastStepPx: +Math.abs(frames60[i].v - frames60[i - 1].v).toFixed(3), fittedDurationMs: +(f.motion.duration * 1000).toFixed(1) }
})
const animationsWhileMoving = Math.max(...data.raf.filter((r, i) => i && r.tx !== data.raf[i - 1].tx).map((r) => r.animations))
console.log('end snap:', JSON.stringify(snap), '| WAAPI/CSS animations in the card while moving:', animationsWhileMoving)
fs.writeFileSync(fitsFile, JSON.stringify({ groundTruth: data.transition, fits, portCheck: port, owner, snap, animationsWhileMoving }, null, 1))
