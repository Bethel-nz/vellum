// clock-waapi.mjs - PROVES: CSS/WAAPI animations can be kept in step by scaling each animation's
// playbackRate (existing and newly created ones, pause = 0, step = currentTime += 16.67 ms), and that a
// Motion-style WAAPI start (animation.startTime = performance.now()) under a lagging virtual clock jumps to
// its end unless Animation#startTime writes are translated (4578 ms -> 4 ms into a 2000 ms animation).
// Run: node "research_notes/Previewing JavaScript animation edits/scripts/clock-waapi.mjs"  (from extension/; needs
//   require('playwright') resolvable, network access to https://flora.so/; Playwright 1.63 / Chromium 158 used)

import { open, clockSource, realWait } from './clock-lib.mjs'

const { browser, page } = await open()
const install = (o) => page.evaluate(`(${clockSource})(${JSON.stringify(o)})`)
const clock = (fn, ...a) => page.evaluate(([fn, a]) => window.__vclock[fn](...a), [fn, a])
await page.evaluate(() => {
  const s = document.createElement('style'); s.textContent = '@keyframes vprobe{from{left:0}to{left:100px}} .vprobe{position:fixed;top:0;left:0;width:4px;height:4px;animation:vprobe 1000s linear}'
  document.head.append(s); const d = document.createElement('div'); d.className = 'vprobe'; d.id = 'css1'; document.body.append(d)
})
const cssTime = (id) => page.evaluate((id) => Math.round(document.getElementById(id).getAnimations()[0].currentTime), id)
// Motion-style WAAPI start: create, then set startTime from performance.now() (virtual).
const motionStyle = () => page.evaluate(() => new Promise((res) => {
  const el = document.createElement('div'); el.style.cssText = 'position:fixed;top:8px;left:0;width:4px;height:4px'; document.body.append(el)
  const a = el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 2000, fill: 'both' })
  a.startTime = performance.now()
  requestAnimationFrame(() => requestAnimationFrame(() => { res({ currentTimeAfter2Frames: Math.round(a.currentTime), playbackRate: a.playbackRate, opacity: getComputedStyle(el).opacity }); a.cancel(); el.remove() }))
}))

for (const translateStartTime of [false, true]) {
  console.log(`\n--- clock installed late, waapi sync on, translateStartTime=${translateStartTime}`)
  await install({ waapi: true, translateStartTime })
  await clock('setRate', 0.25)
  const c0 = await cssTime('css1'), w0 = Date.now(); await realWait(page, 4000)
  console.log(`existing CSS animation: +${(await cssTime('css1')) - c0} ms over ${Date.now() - w0} ms wall at 0.25x`)
  await page.evaluate(() => { const d = document.createElement('div'); d.className = 'vprobe'; d.id = 'css2'; document.body.append(d) })
  await realWait(page, 100)
  const r2 = await page.evaluate(() => document.getElementById('css2').getAnimations()[0].playbackRate)
  const c2 = await cssTime('css2'); await realWait(page, 2000)
  console.log(`CSS animation created while slowed: playbackRate ${r2}, +${(await cssTime('css2')) - c2} ms over 2000 ms wall`)
  console.log(`lag virtual vs real: ${Math.round(await clock('lag'))} ms`)
  console.log('Motion-style WAAPI start (2000 ms opacity, should be ~2 frames in):', await motionStyle())
  await clock('pause'); const p0 = await cssTime('css1'); await realWait(page, 1000)
  console.log(`paused: CSS advanced ${(await cssTime('css1')) - p0} ms in 1000 ms wall`)
  await clock('step'); console.log(`one step: CSS advanced ${(await cssTime('css1')) - p0} ms`)
  const u = await clock('uninstall')
  const rr = await page.evaluate(() => [...document.querySelectorAll('.vprobe')].map((d) => d.getAnimations()[0].playbackRate))
  console.log('uninstall', u, '-> CSS playbackRates restored to', rr)
  await page.evaluate(() => document.getElementById('css2').remove())
}
await browser.close()
