// fit-local-cascade.mjs: where a WAAPI preview sits against the other ways a page can move an element.
// Proves (headless Chromium, local page): a preview element.animate(..., {fill:'forwards'}) on `transform`
//  (a) beats an inline style transform (what Motion/JS-thread libraries write every frame);
//  (b) loses to an inline `!important` transform;
//  (c) beats a running CSS transition on transform in Chromium (both are in one effect stack, script
//      animations above CSS transitions), even though CSS Cascade 5 lists a 'Transition declarations' origin first;
//  (d) beats a page WAAPI animation created before it, but loses to one created after it (composite order);
//  (e) does not leak into the page's own commitStyles(): the page animation commits its own value;
//  (f) composite:'add' appends to the underlying inline transform (translateX(a) + translateX(b) = a+b).
// Run: node fit-local-cascade.mjs   (playwright from the global node_modules; no network)
import { createRequire } from 'module'
const { chromium } = createRequire(import.meta.url)('playwright')
const browser = await chromium.launch()
const page = await browser.newPage()
await page.setContent('<div id=x style="width:10px;height:10px"></div>')
const r = await page.evaluate(async () => {
  const el = document.getElementById('x')
  const tx = () => new DOMMatrix(getComputedStyle(el).transform === 'none' ? undefined : getComputedStyle(el).transform).e
  const frame = () => new Promise((f) => requestAnimationFrame(() => requestAnimationFrame(f)))
  const preview = () => el.animate([{ transform: 'translateX(500px)' }, { transform: 'translateX(500px)' }], { duration: 10000, fill: 'forwards' })
  const out = {}
  const reset = async () => { for (const a of el.getAnimations()) a.cancel(); el.removeAttribute('style'); el.style.cssText = 'width:10px;height:10px'; await frame() }
  // (a) inline
  el.style.transform = 'translateX(10px)'; let p = preview(); await frame(); el.style.transform = 'translateX(20px)'
  out.a_inlineVsPreview = { computed: tx(), inline: el.style.transform }; p.cancel(); out.a_afterCancel = tx(); await reset()
  // (b) inline important
  el.style.setProperty('transform', 'translateX(30px)', 'important'); p = preview(); await frame()
  out.b_importantVsPreview = tx(); p.cancel(); await reset()
  // (c) running CSS transition
  el.style.transition = 'transform 4s linear'; el.style.transform = 'translateX(0px)'; await frame()
  el.style.transform = 'translateX(100px)'; await frame()
  const running = el.getAnimations().map((a) => a.constructor.name)
  p = preview(); await frame()
  out.c_transitionVsPreview = { computed: tx(), running }
  // c2: transition-property none (an override the preview could add) cancels the transition, then the preview wins
  el.style.setProperty('transition', 'none', 'important'); await frame()
  out.c2_afterTransitionNone = { computed: tx(), running: el.getAnimations().map((a) => a.constructor.name) }
  p.cancel(); await reset()
  // (d) page WAAPI before / after preview
  const pageAnim = () => el.animate([{ transform: 'translateX(0px)' }, { transform: 'translateX(200px)' }], { duration: 10000, fill: 'forwards' })
  let a = pageAnim(); a.pause(); a.currentTime = 5000; p = preview(); await frame()
  out.d_pageBeforePreview = tx()
  a.cancel(); a = pageAnim(); a.pause(); a.currentTime = 5000; await frame()
  out.d_pageRecreatedAfterPreview = tx()
  // (e) commitStyles of the page animation while the preview is (re)created on top
  p.cancel(); p = preview(); await frame()
  a.commitStyles()
  out.e_commitStyles = { inline: el.style.transform, computed: tx() }
  await reset()
  // (f) composite add over inline
  el.style.transform = 'translateX(40px)'
  p = el.animate([{ transform: 'translateX(7px)' }, { transform: 'translateX(7px)' }], { duration: 10000, fill: 'forwards', composite: 'add' }); await frame()
  out.f_addOverInline = { computed: tx(), computedString: getComputedStyle(el).transform }
  return out
})
console.log(JSON.stringify(r, null, 1))
await browser.close()
