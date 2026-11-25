// clock-cdp-knobs.mjs - PROVES what CDP's own knobs do on flora (timing measured from Node's wall clock):
// Animation.setPlaybackRate slows CSS/WAAPI only (carousel unchanged); Emulation.setCPUThrottlingRate does not
// slow time-based motion; Emulation.setVirtualTimePolicy 'pause' freezes performance.now/Date.now and ALL timers
// (even setTimeout 0) but not CSS animations or input; 'advance' fast-forwards hours of page time per second
// and does not stop on detach. WARNING: leaves that tab's clock broken - run only in a throwaway browser.
// Run: node "research_notes/Previewing JavaScript animation edits/scripts/clock-cdp-knobs.mjs"  (from extension/; needs
//   require('playwright') resolvable, network access to https://flora.so/; Playwright 1.63 / Chromium 158 used)

import { open, realWait } from './clock-lib.mjs'

const { browser, context, page } = await open()
const cdp = await context.newCDPSession(page)
console.log('document animations at load:', await page.evaluate(() => document.getAnimations().map((a) => `${a.constructor.name}:${a.animationName ?? a.transitionProperty ?? ''}:${a.playState}`)))
// A CSS animation of our own, to see what each knob does to CSS/WAAPI time.
await page.evaluate(() => {
  const s = document.createElement('style'); s.textContent = '@keyframes vprobe{from{left:0}to{left:100px}} #vprobe{position:fixed;top:0;left:0;width:4px;height:4px;animation:vprobe 1000s linear}'
  document.head.append(s); const d = document.createElement('div'); d.id = 'vprobe'; document.body.append(d)
  let frames = 0; const raf = window.requestAnimationFrame; const tick = () => { frames++; raf(tick) }; raf(tick)
  window.__probe = () => ({ x: (/translateX\((-?[\d.]+)px\)/.exec(document.querySelector('.journal-carousel > div > div').style.transform) || [0, 0])[1] * 1, css: Math.round(document.getElementById('vprobe').getAnimations()[0].currentTime), perf: Math.round(performance.now()), date: Date.now(), frames })
})
const probe = async (ms) => { try { return await Promise.race([page.evaluate(() => window.__probe()), new Promise((r) => setTimeout(() => r('evaluate timed out'), ms))]) } catch (e) { return String(e).slice(0, 80) } }
// Poll the carousel from Node for `ms`, return motion segments in wall-clock ms.
async function watch(label, ms) {
  const t0 = Date.now(); const rows = []; const p0 = await probe(2000)
  while (Date.now() - t0 < ms) { const p = await probe(1000); rows.push([Date.now() - t0, p]); await new Promise((r) => setTimeout(r, 15)) }
  const p1 = rows.at(-1)[1]; const segs = []; let cur = null
  for (let i = 1; i < rows.length; i++) { const [t, p] = rows[i], q = rows[i - 1][1]; if (typeof p !== 'object' || typeof q !== 'object') continue
    if (p.x !== q.x) { if (!cur) cur = { start: rows[i - 1][0], from: q.x, min: Math.min(q.x, p.x) }; cur.end = t; cur.to = p.x; cur.min = Math.min(cur.min, p.x) } else if (cur && t - cur.end > 150) { segs.push(cur); cur = null } }
  if (cur) segs.push(cur)
  const wall = rows.at(-1)[0]
  console.log(`\n[${label}] wall ${wall} ms: css advanced ${typeof p1 === 'object' ? p1.css - p0.css : p1} ms, performance.now advanced ${typeof p1 === 'object' ? p1.perf - p0.perf : '-'} ms, Date.now advanced ${typeof p1 === 'object' ? p1.date - p0.date : '-'}, rAF frames ${typeof p1 === 'object' ? p1.frames - p0.frames : '-'}`)
  for (const s of segs) console.log(`   carousel moved ${s.start}..${s.end} (dur ${s.end - s.start} ms wall) ${s.from} -> ${s.to}, overshoot ${(s.to - s.min).toFixed(2)}`)
  return rows
}
await watch('baseline 1x', 11000)
await cdp.send('Animation.enable'); await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.25 })
console.log('Animation.getPlaybackRate ->', await cdp.send('Animation.getPlaybackRate'))
await watch('Animation.setPlaybackRate 0.25', 11000)
await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 }); await cdp.send('Animation.disable')
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 })
await watch('Emulation.setCPUThrottlingRate 6', 11000)
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
// Virtual time
const vt = await cdp.send('Emulation.setVirtualTimePolicy', { policy: 'pause' })
console.log('\nsetVirtualTimePolicy pause ->', vt)
const timeoutFired = page.evaluate(() => new Promise((r) => setTimeout(() => r('setTimeout(0) fired'), 0))).catch((e) => String(e))
await watch('virtual time: pause', 6000)
console.log('setTimeout(0) under pause:', await Promise.race([timeoutFired, new Promise((r) => setTimeout(() => r('setTimeout(0) did NOT fire within 6 s'), 10))]))
await page.focus('.journal-carousel').catch((e) => console.log('focus', String(e).slice(0, 60)))
const keyT = Date.now(); await Promise.race([page.keyboard.press('ArrowRight'), new Promise((r) => setTimeout(r, 3000))]); console.log('keyboard.press returned after', Date.now() - keyT, 'ms')
console.log('aria current after key under pause:', await Promise.race([page.evaluate(() => [...document.querySelectorAll('.journal-carousel article')].findIndex((a) => a.getAttribute('aria-hidden') === 'false')), new Promise((r) => setTimeout(() => r('timeout'), 2000))]))
let budgetExpired = 0; cdp.on('Emulation.virtualTimeBudgetExpired', () => { budgetExpired++ })
console.log('advance budget 100 ->', await cdp.send('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: 100 }))
await watch('virtual time: advance, budget 100 ms', 4000)
console.log('budget expired events:', budgetExpired)
console.log('advance (no budget) ->', await cdp.send('Emulation.setVirtualTimePolicy', { policy: 'advance' }))
await watch('virtual time: advance, no budget', 8000)
await cdp.detach()
await watch('after CDP session detached', 11000)
const cdp2 = await context.newCDPSession(page)
await watch('after a fresh CDP session attached', 3000)
await browser.close()
