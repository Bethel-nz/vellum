// fit-flora-preview.mjs: record -> fit -> edit -> preview -> hand back, on flora.so's Motion-driven carousel track.
//
// What it proves (by execution, headless Chromium via Playwright, no page JavaScript patched):
//  1. Sampling the track's translateX every frame (main-world rAF, getComputedStyle + inline style) across
//     two moves, then fitting a damped spring, recovers Motion's {duration .55, bounce .16}; the React
//     props read back from the fiber give the ground truth to compare.
//  2. A WAAPI animation (element.animate, fill 'forwards') on `transform` overrides the inline transform
//     Motion writes every frame: computed style follows the preview while inline style keeps Motion's values.
//  3. Started from a MutationObserver callback at the page's own move start, the edited spring
//     ({duration 1.0, bounce .4} as Motion's own linear() string) replaces the move from its first frame;
//     after cancel() the computed value is Motion's value again, with no jump if it ended on the same target.
//  4. Inline `!important` is not a preview layer: Motion's next write drops the priority.
//  5. Replay in place, slow motion (playbackRate .25) and scrubbing (pause + currentTime) of the edited and
//     the original fitted curve, the original shown on a temporary inert clone (ghost); cancel + remove
//     restores the page exactly.
//  6. Handing back mid-move: cancelling a preview while Motion is moving jumps by the difference; a
//     composite:'add' offset animation that decays to 0 hands back to the live motion with no jump.
//  7. Afterwards Motion's own moves still fit {duration .55, bounce .16}: the page's JS was never touched.
//
// Run: node fit-flora-preview.mjs [out.json]   (needs network to flora.so; playwright from the global
// node_modules; no `playwright install`). Takes about 50 s. Writes samples + fits + checks to out.json.
import { createRequire } from 'module'
import fs from 'fs'
import { springToWaapi, spring as motionSpring } from './fit-motion-spring.mjs'
import { detectSegments, fitSegment, describe } from './fit-core.mjs'
const { chromium } = createRequire(import.meta.url)('playwright')
const outFile = process.argv[2] ?? 'fit-flora-preview.json'
const EDITED = { duration: 1000, bounce: 0.4 } // ms, as Motion's generator takes it

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console: ' + m.text()) })
await page.goto('https://flora.so/', { waitUntil: 'load', timeout: 60000 })
await page.evaluate(() => scrollTo(0, 400))
await page.waitForFunction(() => [...document.querySelectorAll('div[class="absolute"]')].some((el) => /translateX/.test(el.style.transform)), null, { timeout: 30000 })

// ---- helpers installed in the page's main world (reads only, plus the preview's own animations) ----
await page.evaluate(() => {
  const el = [...document.querySelectorAll('div[class="absolute"]')].find((el) => /translateX/.test(el.style.transform))
  const tx = () => new DOMMatrix(getComputedStyle(el).transform === 'none' ? undefined : getComputedStyle(el).transform).e
  const inline = () => { const m = /translateX\((-?[\d.e-]+)px\)/.exec(el.style.transform); return m ? Number(m[1]) : (el.style.transform === 'none' ? 0 : NaN) }
  const frames = (ms, extra = () => ({})) => new Promise((resolve) => {
    const rows = []; let start
    const tick = (ts) => { start ??= ts; rows.push({ ts, tx: tx(), inline: inline(), ...extra() }); if (ts - start < ms) requestAnimationFrame(tick); else resolve(rows) }
    requestAnimationFrame(tick)
  })
  // Resolves at the page's next move start: the first inline write after a hold of >= holdMs.
  const nextMove = (holdMs = 150) => new Promise((resolve) => {
    let last = performance.now(), value = el.style.transform
    const mo = new MutationObserver(() => {
      const now = performance.now()
      if (el.style.transform !== value) {
        if (now - last >= holdMs) { mo.disconnect(); resolve({ from: Number(/translateX\((-?[\d.e-]+)px\)/.exec(value)?.[1] ?? 0), first: inline(), tl: document.timeline.currentTime }) }
        value = el.style.transform; last = now
      }
    })
    mo.observe(el, { attributes: true, attributeFilter: ['style'] })
  })
  // Resolves once the page's inline value has held for holdMs after moving.
  const settled = (holdMs = 120) => new Promise((resolve) => {
    let value = el.style.transform, since = performance.now(), moved = false
    const tick = () => { if (el.style.transform !== value) { value = el.style.transform; since = performance.now(); moved = true } if (moved && performance.now() - since >= holdMs) resolve(inline()); else requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
  })
  window.__vp = { el, tx, inline, frames, nextMove, settled }
})

// ---- 0. ground truth from React props (fiber walk, read only) ----
const groundTruth = await page.evaluate(() => {
  const { el } = window.__vp
  const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'))
  for (let f = el[key]; f; f = f.return) {
    const p = f.memoizedProps
    if (p && p.transition) return { component: f.type?.displayName ?? f.type?.render?.displayName ?? '?', transition: p.transition, animate: p.animate, initial: p.initial }
  }
  return null
})
console.log('React props transition:', JSON.stringify(groundTruth))

// ---- 1. record two moves, every frame, plus what else changes in the card ----
const recording = await page.evaluate(async () => {
  const { el, frames } = window.__vp
  const card = el.closest('article')
  const changed = new Map()
  const mo = new MutationObserver((recs) => { for (const r of recs) { if (r.target === el) continue; const k = `${r.target.tagName}.${String(r.target.className).slice(0, 40)} [${r.attributeName}]`; changed.set(k, (changed.get(k) ?? 0) + 1) } })
  mo.observe(card, { attributes: true, subtree: true, attributeFilter: ['style', 'class', 'data-state', 'aria-hidden', 'aria-current'] })
  await window.__vp.settled() // start right after a move so two full moves fit in the window
  const rows = await frames(10600)
  mo.disconnect()
  return { rows, relatedChanges: Object.fromEntries(changed), cardAnimations: card.getAnimations({ subtree: true }).length, kids: [...el.children].map((k) => k.getAttribute('style')) }
})
const samples = recording.rows.map((r) => ({ t: r.ts, v: r.tx }))
const segments = detectSegments(samples).filter((s) => s.settled && !s.jump && s.start > 0)
const fits = segments.map((seg) => ({ from: seg.from, to: seg.to, ...describe(fitSegment(samples, seg)) }))
for (const f of fits) console.log('fit', f.from, '->', f.to, f.choice, 'spring', f.spring.motion, 'rmse', f.spring.fit.rmse, '| bezier', f.bezier.css, f.bezier.duration, 'rmse', f.bezier.fit.rmse)
const fitted = fits[0]
const delta = fitted.to - fitted.from // -288 per slide

// Edited and original curves as WAAPI easings (Motion's own linear() generation)
const edited = springToWaapi({ keyframes: [0, 1], ...EDITED })
// Rounded as it would be sent (0.55 / 0.16): an unrounded 0.5509 s would make Motion's 50 ms-stepped WAAPI duration 600 ms.
const rounded = { duration: Math.round(fitted.spring.motion.duration * 100) / 100, bounce: Math.round(fitted.spring.motion.bounce * 100) / 100 }
const original = springToWaapi({ keyframes: [0, 1], duration: rounded.duration * 1000, bounce: rounded.bounce })
const easeAt = (w, ms) => w.ease(Math.min(1, Math.max(0, ms / w.duration)))
console.log('edited', EDITED, '->', edited.duration, 'ms,', edited.easing.length, 'chars;', 'original fitted ->', original.duration, 'ms')

// ---- 2+3. intercept the page's next move and replace it with the edited spring ----
const intercept = await page.evaluate(async ({ delta, easing, duration }) => {
  const { el, frames, nextMove, tx, inline } = window.__vp
  const move = await nextMove()
  // Inside the MutationObserver callback's resolution (a microtask after Motion's rAF write, before paint).
  const from = move.from, to = from + delta
  const preview = el.animate([{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }], { duration, easing, fill: 'forwards' })
  const sameFrame = { tx: tx(), inline: inline() } // computed already shows the preview in Motion's first moved frame
  const during = await frames(duration + 300, () => ({ t: preview.currentTime, state: preview.playState }))
  const before = tx()
  preview.cancel()
  const afterCancelSameTask = { tx: tx(), inline: inline() }
  const after = await frames(300)
  return { move, from, to, sameFrame, during, before, afterCancelSameTask, after, important: null }
}, { delta, easing: edited.easing, duration: edited.duration })
{
  const d = intercept.during.filter((r) => typeof r.t === 'number')
  const err = d.map((r) => Math.abs(r.tx - (intercept.from + delta * easeAt(edited, r.t))))
  const motionUnder = d.filter((r) => Math.abs(r.inline - r.tx) > 0.5).length
  intercept.checks = {
    sameFrameOverride: Math.abs(intercept.sameFrame.tx - intercept.from) < 0.01 && Math.abs(intercept.sameFrame.inline - intercept.from) > 0.5,
    maxErrorVsEditedCurvePx: Math.max(...err),
    framesWhereMotionDiffersUnderneath: motionUnder, frames: d.length,
    editedOvershootPx: Math.min(...d.map((r) => r.tx)) - intercept.to,
    motionInlineMinPx: Math.min(...d.map((r) => r.inline)) - intercept.to,
    jumpOnCancelPx: intercept.afterCancelSameTask.tx - intercept.before,
    afterCancelEqualsInline: intercept.after.every((r) => Math.abs(r.tx - r.inline) < 1e-6),
  }
  console.log('intercept', intercept.checks)
}

// ---- 4. inline !important does not survive Motion's next write ----
const important = await page.evaluate(async () => {
  const { el, nextMove } = window.__vp
  const held = el.style.transform
  el.style.setProperty('transform', held, 'important') // same value: invisible
  const priorityBefore = el.style.getPropertyPriority('transform')
  await nextMove()
  const priorityAfterMotionWrite = el.style.getPropertyPriority('transform')
  return { priorityBefore, priorityAfterMotionWrite, valueAfter: el.style.transform }
})
console.log('important', important)

// ---- 5. replay in place with ghost, slow motion, scrubbing ----
const replay = await page.evaluate(async ({ delta, edited, original, rate }) => {
  const { el, frames, settled, tx, inline } = window.__vp
  const P = await settled()
  const ghost = el.cloneNode(true)
  ghost.setAttribute('aria-hidden', 'true'); ghost.inert = true; ghost.setAttribute('data-vellum-ghost', '')
  ghost.style.opacity = '0.35'; ghost.style.pointerEvents = 'none'
  el.after(ghost)
  const kf = [{ transform: `translateX(${P - delta}px)` }, { transform: `translateX(${P}px)` }]
  const real = el.animate(kf, { duration: edited.duration, easing: edited.easing, fill: 'forwards' })
  const shadow = ghost.animate(kf, { duration: original.duration, easing: original.easing, fill: 'forwards' })
  const startTime = document.timeline.currentTime
  for (const a of [real, shadow]) { a.startTime = startTime; a.playbackRate = rate }
  const gtx = () => new DOMMatrix(getComputedStyle(ghost).transform).e
  const slow = await frames(700, () => ({ realT: real.currentTime, ghostT: shadow.currentTime, ghost: gtx() }))
  const scrub = []
  real.pause(); shadow.pause()
  for (const t of [0, 100, 200, 300, 450, 600, 800, 1000]) {
    real.currentTime = t; shadow.currentTime = t
    scrub.push({ t, real: tx(), ghost: gtx(), inline: inline() })
  }
  real.cancel(); shadow.cancel(); ghost.remove()
  const restored = { tx: tx(), inline: inline(), P, ghostGone: !document.querySelector('[data-vellum-ghost]'), animationsLeft: el.getAnimations().length }
  return { P, slow, scrub, restored }
}, { delta, edited: { duration: edited.duration, easing: edited.easing }, original: { duration: original.duration, easing: original.easing }, rate: 0.25 })
{
  const P = replay.P
  const at = (w, t) => P - delta + delta * easeAt(w, t)
  replay.checks = {
    slowMotionRealMaxErr: Math.max(...replay.slow.filter((r) => typeof r.realT === 'number').map((r) => Math.abs(r.tx - at(edited, r.realT)))),
    slowMotionGhostMaxErr: Math.max(...replay.slow.filter((r) => typeof r.ghostT === 'number').map((r) => Math.abs(r.ghost - at(original, r.ghostT)))),
    slowMotionAdvancedMs: replay.slow.at(-1).realT - replay.slow[0].realT,
    scrubMaxErr: Math.max(...replay.scrub.map((s) => Math.max(Math.abs(s.real - at(edited, s.t)), Math.abs(s.ghost - at(original, s.t))))),
    restoredExactly: replay.restored.tx === replay.restored.inline && replay.restored.inline === P && replay.restored.ghostGone && replay.restored.animationsLeft === 0,
  }
  console.log('replay', replay.checks)
}

// ---- 6. hand back to the live motion mid-move: naive cancel vs composite:'add' offset ----
const handback = await page.evaluate(async ({ delta }) => {
  const { el, frames, nextMove, tx, inline } = window.__vp
  const hold = inline()
  // Hold a preview at the current value (as if a preview just ended), then let the page start its move.
  const run = async (mode) => {
    const held = el.animate([{ transform: `translateX(${hold}px)` }, { transform: `translateX(${hold}px)` }], { duration: 1, fill: 'forwards' })
    const move = await nextMove()
    await frames(150) // Motion is ~150 ms into its move underneath
    const shown = tx(), page = inline()
    held.cancel()
    const first = { tx: tx(), inline: inline() }
    const rows = await frames(450)
    return { mode, hold, shown, page, offset: shown - page, first, rows, move }
  }
  const naive = await run('cancel')
  await new Promise((r) => setTimeout(r, 300))
  return { naive, hold }
}, { delta })
const handbackAdd = await page.evaluate(async () => {
  const { el, frames, nextMove, tx, inline } = window.__vp
  const hold = inline()
  const held = el.animate([{ transform: `translateX(${hold}px)` }, { transform: `translateX(${hold}px)` }], { duration: 1, fill: 'forwards' })
  await nextMove()
  await frames(150)
  const shown = tx(), page = inline()
  held.cancel()
  // ease-in-out: the offset starts with zero velocity, so the element leaves the held preview at the page's own speed
  const blend = el.animate([{ transform: `translateX(${shown - page}px)` }, { transform: 'translateX(0px)' }], { duration: 300, easing: 'ease-in-out', composite: 'add' })
  const first = { tx: tx(), inline: inline() }
  const rows = await frames(450, () => ({ state: blend.playState }))
  return { mode: 'add', hold, shown, page, offset: shown - page, first, rows }
})
{
  const step = (h) => Math.abs(h.first.tx - h.shown)
  const maxFrameStep = (h) => Math.max(...h.rows.slice(1).map((r, i) => Math.abs(r.tx - h.rows[i].tx)))
  handback.checks = {
    naiveJumpPx: step(handback.naive), naiveMaxFrameStepPx: maxFrameStep(handback.naive),
    addJumpPx: step(handbackAdd), addMaxFrameStepPx: maxFrameStep(handbackAdd),
    addConvergesToPage: handbackAdd.rows.slice(-5).every((r) => Math.abs(r.tx - r.inline) < 1e-6),
    addFirstEqualsInlinePlusOffset: Math.abs(handbackAdd.first.tx - (handbackAdd.first.inline + handbackAdd.offset)) < 0.01,
  }
  console.log('handback', handback.checks)
}

// ---- 7. the page's own motion is unaffected afterwards ----
const afterRows = await page.evaluate(async () => { await window.__vp.settled(); return window.__vp.frames(10600) })
const afterSamples = afterRows.map((r) => ({ t: r.ts, v: r.tx }))
const afterFits = detectSegments(afterSamples).filter((s) => s.settled && !s.jump && s.start > 0).map((seg) => ({ from: seg.from, to: seg.to, ...describe(fitSegment(afterSamples, seg)) }))
for (const f of afterFits) console.log('after', f.from, '->', f.to, f.spring.motion, 'rmse', f.spring.fit.rmse)
const leftovers = await page.evaluate(() => ({ animations: window.__vp.el.getAnimations().length, ghosts: document.querySelectorAll('[data-vellum-ghost]').length, important: window.__vp.el.style.getPropertyPriority('transform') }))
console.log('leftovers', leftovers, 'page errors', pageErrors)

const result = {
  when: new Date().toISOString(), userAgent: await page.evaluate(() => navigator.userAgent), url: 'https://flora.so/',
  groundTruth, edited: { ...EDITED, waapiDurationMs: edited.duration, linear: edited.easing }, originalFittedWaapi: { durationMs: original.duration, linear: original.easing },
  recording: { frames: recording.rows.length, relatedChanges: recording.relatedChanges, cardAnimations: recording.cardAnimations, rows: recording.rows },
  fits, rounded, intercept, important, replay, handback: { naive: handback.naive, add: handbackAdd, checks: handback.checks }, afterFits, afterRows, leftovers, pageErrors,
}
fs.writeFileSync(outFile, JSON.stringify(result))
await browser.close()
