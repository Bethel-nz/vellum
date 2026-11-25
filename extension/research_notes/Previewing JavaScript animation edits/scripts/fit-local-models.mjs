// fit-local-models.mjs: does the fitter pick the right family on motion it didn't make up?
// What it proves (headless Chromium, local page, no network): sampling getComputedStyle every frame and
// fitting recovers (a) a CSS transition cubic-bezier(0.2, 0.8, 0.2, 1) 600 ms and (b) ease-in-out 400 ms as
// cubic-bezier, (c) Motion's {duration 1.0, bounce .4} played by WAAPI as the linear() string from
// fit-motion-spring.mjs as a spring with those parameters (round trip of the preview easing), and
// (d) a JS rAF power3.out 700 ms as cubic-bezier(1/3, 1, 2/3, 1), which is exactly power3.out.
// Run: node fit-local-models.mjs [out.json]
import { createRequire } from 'module'
import fs from 'fs'
import { springToWaapi } from './fit-motion-spring.mjs'
import { detectSegments, fitSegment, describe } from './fit-core.mjs'
const { chromium } = createRequire(import.meta.url)('playwright')
const spring = springToWaapi({ keyframes: [0, 1], duration: 1000, bounce: 0.4 })
const browser = await chromium.launch()
const page = await browser.newPage()
await page.setContent(`<style>div{position:absolute;width:40px;height:40px;background:#888}</style>
<div id=a style="top:0;transition:transform 600ms cubic-bezier(0.2,0.8,0.2,1)"></div>
<div id=b style="top:60px;transition:transform 400ms ease-in-out"></div>
<div id=c style="top:120px"></div><div id=d style="top:180px"></div>`)
const data = await page.evaluate(({ easing, duration }) => new Promise((resolve) => {
  const ids = ['a', 'b', 'c', 'd'], rows = Object.fromEntries(ids.map((id) => [id, []]))
  const els = ids.map((id) => document.getElementById(id))
  let start
  const go = (ts) => {
    start = ts
    els[0].style.transform = 'translateX(300px)'; els[1].style.transform = 'translateX(300px)'
    els[2].animate([{ transform: 'translateX(0px)' }, { transform: 'translateX(300px)' }], { duration, easing, fill: 'forwards' })
    const t0 = ts
    const js = (t) => { const p = Math.min(1, (t - t0) / 700); els[3].style.transform = `translateX(${300 * (1 - (1 - p) ** 3)}px)`; if (p < 1) requestAnimationFrame(js) }
    requestAnimationFrame(js)
  }
  let frames = 0
  const tick = (ts) => {
    frames++
    if (frames === 10) go(ts)
    els.forEach((el, i) => rows[ids[i]].push({ t: ts, v: new DOMMatrix(getComputedStyle(el).transform === 'none' ? undefined : getComputedStyle(el).transform).e }))
    if (frames < 120) requestAnimationFrame(tick); else resolve(rows)
  }
  requestAnimationFrame(tick)
}), { easing: spring.easing, duration: spring.duration })
await browser.close()
const truth = { a: 'CSS transition 600ms cubic-bezier(0.2, 0.8, 0.2, 1)', b: 'CSS transition 400ms ease-in-out = cubic-bezier(0.42, 0, 0.58, 1)', c: 'WAAPI linear() from Motion spring {duration 1.0, bounce 0.4}', d: 'JS rAF power3.out over 700 ms' }
const out = {}
for (const [id, rows] of Object.entries(data)) {
  const seg = detectSegments(rows)[0]
  out[id] = { truth: truth[id], ...describe(fitSegment(rows, seg)) }
  console.log(truth[id].padEnd(62), '->', out[id].choice, 'dBIC', out[id].deltaBIC, '| spring', out[id].spring.motion.duration, out[id].spring.motion.bounce, 'rmse', out[id].spring.fit.rmse, '| bezier', out[id].bezier.css, out[id].bezier.duration, 'rmse', out[id].bezier.fit.rmse)
}
fs.writeFileSync(process.argv[2] ?? 'fit-local-models.json', JSON.stringify({ samples: data, fits: out }, null, 1))
