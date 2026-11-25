// library-flora-motion-fiber.mjs
//
// PROVES (by execution, against the live production site https://flora.so/, Next.js + React
// 19.3 canary + Motion 13.3+/14.x-era motion-dom):
//   1. From a DOM node, a MAIN-world script reaches the Motion VisualElement through React's
//      __reactFiber$<random> expando: host fiber -> .return -> MotionContext.Provider whose
//      memoizedProps.value.visualElement.current === the node (fallback: useRef in the hook list of
//      the fiber whose elementType carries Symbol.for('motionComponentSymbol')).
//   2. It reads the live transition ({type:'spring', duration:0.55, bounce:0.16}).
//   3. Mutating ve.props.transition is LOST on the next React render (the site passes a fresh object).
//   4. Shadowing ve.getDefaultTransition on the instance is STICKY across re-renders and changes
//      the measured motion (overshoot ~2.2 px / settle ~540 ms -> ~47 px / ~1490 ms).
//   5. Previews on demand: the carousel's own keyboard handler, a production useState
//      queue.dispatch, or animationState.animateChanges() after forgetting prevResolvedValues.
//   6. In-flight retarget works; time-defined springs (duration/bounce) drop the inherited
//      velocity (visible hitch), physics springs (stiffness/damping) keep it.
//   7. `delete ve.getDefaultTransition` restores the original exactly (no reload).
//
// RUN: node "library-flora-motion-fiber.mjs"   (needs the global `playwright` package; ~80 s;
//      prints one JSON row per phase). installVellumMotion() is self-contained and can be passed
//      verbatim to chrome.scripting.executeScript({ world: 'MAIN', func: installVellumMotion }).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

// MAIN-world helper. Self-contained so it can be passed verbatim as `func` to
// chrome.scripting.executeScript({ world: 'MAIN', func: installVellumMotion }).
// It installs window.__vellumMotion with: locate(el), read(), override(t), revert(),
// replay({from}), retarget(), sample(on), and an event log.
function installVellumMotion() {
  if (window.__vellumMotion) return 'already-installed';
  const MSYM = Symbol.for('motionComponentSymbol');
  const api = { log: [], samples: [], sampling: false, ve: null, el: null, patched: null };

  function fiberOf(node) {
    for (const k in node) if (k.startsWith('__reactFiber$')) return node[k];
    return null;
  }
  function isVE(v) {
    return v && typeof v === 'object' && typeof v.getDefaultTransition === 'function' &&
      typeof v.getValue === 'function' && 'latestValues' in v;
  }
  // Fiber walk from a host node to the Motion VisualElement that renders it.
  // Strategy 1: nearest MotionContext.Provider value whose visualElement.current === node.
  // Strategy 2: the motion component fiber (elementType[Symbol.for('motionComponentSymbol')]),
  //             scanning its hook list for a useRef holding a VisualElement.
  function veForNode(node) {
    let f = fiberOf(node);
    for (let d = 0; f && d < 25; f = f.return, d++) {
      const v = f.memoizedProps && f.memoizedProps.value && f.memoizedProps.value.visualElement;
      if (isVE(v) && v.current === node) return { ve: v, via: 'MotionContext.Provider value', depth: d };
      if (f.elementType && f.elementType[MSYM]) {
        for (let h = f.memoizedState, i = 0; h && i < 60; h = h.next, i++) {
          const c = h.memoizedState && h.memoizedState.current;
          if (isVE(c) && c.current === node) return { ve: c, via: 'useRef in motion component hook list #' + i, depth: d };
        }
        return null; // reached the owning motion component without a match
      }
    }
    return null;
  }
  // Nearest Motion-driven element at or above `start`.
  api.locate = function (start) {
    const el0 = typeof start === 'string' ? document.querySelector(start) : start;
    for (let n = el0, up = 0; n && n.nodeType === 1; n = n.parentElement, up++) {
      const r = veForNode(n);
      if (r) {
        api.ve = r.ve; api.el = n;
        return { found: true, via: r.via, fiberDepth: r.depth, domHops: up, tag: n.tagName, cls: String(n.className) };
      }
    }
    return { found: false };
  };
  const clone = o => (o == null ? o : JSON.parse(JSON.stringify(o)));
  api.read = function () {
    const ve = api.ve;
    const values = {};
    ve.values.forEach((mv, k) => { values[k] = { v: mv.get(), vel: mv.getVelocity(), animating: mv.isAnimating() }; });
    const st = ve.animationState && ve.animationState.getState();
    return {
      transition: clone(ve.props.transition),
      defaultTransition: clone(ve.getDefaultTransition()),
      animateProp: clone(ve.props.animate),
      initialProp: clone(ve.props.initial),
      ownGetDefaultTransition: Object.prototype.hasOwnProperty.call(ve, 'getDefaultTransition'),
      values,
      prevResolvedAnimate: st ? clone(st.animate.prevResolvedValues) : null,
      inlineTransform: api.el.style.transform,
    };
  };
  // Sticky override: shadow the prototype method on this instance. React re-renders call
  // ve.update(props) which replaces ve.props but never touches this own property.
  api.override = function (t) {
    const ve = api.ve;
    const original = ve.getDefaultTransition; // prototype method
    api.patched = { t };
    ve.getDefaultTransition = function () {
      const base = original.call(this);
      return Object.assign({}, base, api.patched.t);
    };
    return api.read();
  };
  api.revert = function () {
    const ve = api.ve;
    delete ve.getDefaultTransition; // prototype method shows through again
    api.patched = null;
    return { ownGetDefaultTransition: Object.prototype.hasOwnProperty.call(ve, 'getDefaultTransition'), sameAsProps: ve.getDefaultTransition() === ve.props.transition };
  };
  // Make Motion's own animationState re-animate keys whose target did not change.
  function forgetPrev(keys) {
    const st = ve().animationState.getState();
    for (const type in st) for (const k of keys) delete st[type].prevResolvedValues[k];
  }
  function ve() { return api.ve; }
  // Preview without touching React state: put the value back to `from` and let
  // animationState.animateChanges() run the real pipeline to the current target.
  api.replay = function (key, from) {
    const mv = mvOf(key);
    if (from !== undefined) mv.jump(from);
    forgetPrev([key]);
    ve().animationState.animateChanges();
    return { started: mv.isAnimating() };
  };
  // Retarget in flight: same call without the jump; Motion seeds the new animation
  // with the value's current velocity (animateMotionValue reads value.getVelocity()).
  api.retarget = function (key) {
    const mv = mvOf(key);
    const before = { v: mv.get(), vel: mv.getVelocity() };
    forgetPrev([key]);
    ve().animationState.animateChanges();
    return { before, startedNew: mv.isAnimating() };
  };
  function animInfo(mv) {
    const a = mv.animation;
    if (!a) return null;
    const pick = o => {
      if (!o) return null;
      const r = {};
      for (const k of ['type', 'duration', 'bounce', 'stiffness', 'damping', 'mass', 'visualDuration', 'velocity', 'keyframes', 'restDelta', 'restSpeed', 'ease'])
        if (o[k] !== undefined) r[k] = Array.isArray(o[k]) ? o[k].slice(0, 4) : o[k];
      return r;
    };
    return { ctor: a.constructor && a.constructor.name, keys: Object.keys(a).slice(0, 30), options: pick(a.options), inner: a._animation || a.animation ? pick((a._animation || a.animation).options) : null };
  }
  // getValue(key, default) creates the MotionValue the same way animateTarget would
  // (values are created lazily; with initial={false} none exists before the first change).
  const mvOf = key => ve().getValue(key, ve().latestValues[key] !== undefined ? ve().latestValues[key] : 0);
  api.watch = function (key) {
    const mv = mvOf(key);
    for (const ev of ['animationStart', 'animationComplete', 'animationCancel']) {
      mv.on(ev, () => api.log.push({ ev, t: performance.now(), v: mv.get(), vel: mv.getVelocity(), info: ev === 'animationStart' ? animInfo(mv) : null }));
    }
    const loop = () => {
      api.samples.push([performance.now(), mv.get(), api.el.style.transform]);
      if (api.samples.length > 20000) api.samples.splice(0, 10000);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return true;
  };
  window.__vellumMotion = api;
  return 'installed';
}

const TRACK = '.journal-carousel .t-panel-slide > div';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function metrics(samples, t0, t1, target) {
  const seg = samples.filter(s => s[0] >= t0 - 1 && s[0] <= t1);
  if (seg.length < 2) return { frames: seg.length };
  const from = seg[0][1];
  const to = target !== undefined ? target : seg[seg.length - 1][1];
  const dir = Math.sign(to - from) || 1;
  let peak = -Infinity, peakT = 0, firstReach = null, settle = null;
  for (const [t, x] of seg) {
    const over = dir * (x - to);
    if (over > peak) { peak = over; peakT = t; }
    if (firstReach === null && over >= 0) firstReach = t;
  }
  for (let i = seg.length - 1; i >= 0; i--) { if (Math.abs(seg[i][1] - to) > 0.5) { settle = seg[Math.min(i + 1, seg.length - 1)][0]; break; } }
  if (settle === null) settle = seg[0][0];
  return {
    from: +from.toFixed(2), to: +to.toFixed(2), frames: seg.length,
    overshootPx: +Math.max(0, peak).toFixed(2), peakAtMs: Math.round(peakT - t0),
    firstReachMs: firstReach === null ? null : Math.round(firstReach - t0),
    settleWithin0p5pxMs: Math.round(settle - t0),
  };
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('https://flora.so/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector(TRACK, { state: 'attached', timeout: 20000 });
  await page.evaluate(installVellumMotion); // page.evaluate runs in the MAIN world
  const located = await page.evaluate(sel => window.__vellumMotion.locate(document.querySelector(sel).firstElementChild || sel), TRACK);
  console.log('locate (from a slide <article> child):', JSON.stringify(located));
  console.log('read:', JSON.stringify(await page.evaluate(() => window.__vellumMotion.read())));
  await page.evaluate(() => window.__vellumMotion.watch('x'));

  const S = async () => page.evaluate(() => ({ log: window.__vellumMotion.log.slice(), samples: window.__vellumMotion.samples.slice() }));
  const nextStart = async (afterIdx, timeout = 9000) => {
    await page.waitForFunction(n => window.__vellumMotion.log.filter(e => e.ev === 'animationStart').length > n, afterIdx, { timeout, polling: 16 });
  };
  const startCount = async () => page.evaluate(() => window.__vellumMotion.log.filter(e => e.ev === 'animationStart').length);
  const results = [];
  const quiet = async () => { // wait for the next autoplay slide to start and finish, leaving ~3 s of quiet
    const n0 = await startCount(); await nextStart(n0);
    await page.waitForFunction(() => { const l = window.__vellumMotion.log; return l[l.length - 1].ev !== 'animationStart'; }, null, { timeout: 6000, polling: 16 });
    await sleep(150);
  };
  async function capture(label, triggerFn, holdMs = 3200) {
    if (triggerFn) { await quiet(); holdMs = 2700; }
    const n = await startCount();
    const tTrig = await page.evaluate(() => performance.now());
    if (triggerFn) await triggerFn();
    await nextStart(n);
    await sleep(holdMs);
    const { log, samples } = await S();
    const starts = log.filter(e => e.ev === 'animationStart');
    const st = starts[n];
    const nextSt = starts[n + 1];
    const end = nextSt ? nextSt.t : st.t + holdMs;
    const target = await page.evaluate(() => window.__vellumMotion.ve.animationState.getState().animate.prevResolvedValues.x);
    const m = metrics(samples, st.t, end, target);
    const propsT = await page.evaluate(() => JSON.stringify(window.__vellumMotion.ve.props.transition));
    const row = { label, triggerToStartMs: triggerFn ? Math.round(st.t - tTrig) : null, animOptions: st.info && (st.info.inner || st.info.options), ...m, propsTransitionAfter: propsT };
    results.push(row);
    console.log(JSON.stringify(row));
    return { st, samples, log };
  }

  // A. baseline: wait for the site's own autoplay
  await capture('A baseline (autoplay)', null);
  // B. naive mutation of props.transition, then the next autoplay re-render
  await page.evaluate(() => { const t = window.__vellumMotion.ve.props.transition; t.duration = 1.5; t.bounce = 0.5; window.__vellumMotion.mutatedRef = t; });
  await capture('B naive props.transition mutation, next autoplay', null);
  console.log('B props.transition replaced by React re-render:', await page.evaluate(() => window.__vellumMotion.ve.props.transition !== window.__vellumMotion.mutatedRef));
  // C. sticky override via instance getDefaultTransition, next autoplay re-render
  await page.evaluate(() => window.__vellumMotion.override({ type: 'spring', duration: 1.5, bounce: 0.5 }));
  await capture('C override getDefaultTransition, next autoplay', null);
  // D. on-demand preview through the carousel's own keyboard control
  await capture('D override, keyboard ArrowRight preview', () => page.evaluate(() => {
    document.querySelector('.journal-carousel').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  }));
  // D2. on-demand preview through React state in a production build: find the carousel component's
  //     index useState hook in its fiber and call its queue.dispatch (what the site's own setter does).
  await capture('D2 override, useState queue.dispatch preview', () => page.evaluate(() => {
    const host = document.querySelector('.journal-carousel');
    const key = Object.keys(host).find(k => k.startsWith('__reactFiber$'));
    let f = host[key]; while (f && typeof f.type !== 'function') f = f.return; // nearest function component
    const idx = Math.round(-window.__vellumMotion.ve.getValue('x').get() / 288);
    const hooks = []; for (let h = f.memoizedState; h; h = h.next) hooks.push(h);
    const hook = hooks.find(h => h.queue && typeof h.queue.dispatch === 'function' && h.memoizedState === idx);
    window.__vellumMotion.dispatchInfo = { component: f.type.name || '(anonymous)', hookCount: hooks.length, hookIndex: hooks.indexOf(hook), idx };
    hook.queue.dispatch(i => i + 1);
  }));
  console.log('D2 dispatch info:', JSON.stringify(await page.evaluate(() => window.__vellumMotion.dispatchInfo)));
  // E. on-demand replay without touching React state (jump back one page, re-run animateChanges)
  await capture('E override, replay via animationState', () => page.evaluate(() => {
    const vm = window.__vellumMotion; const x = vm.ve.getValue('x');
    return vm.replay('x', x.get() + 288 * (vm.ve.current.getBoundingClientRect().width ? 1 : 1));
  }));
  // F. revert, next autoplay
  console.log('F revert:', JSON.stringify(await page.evaluate(() => window.__vellumMotion.revert())));
  await capture('F reverted, next autoplay', null);
  // G. in-flight retarget: start the original via keyboard, 120 ms later apply an override and
  //    re-run animateChanges() without changing the target. G1 = time-defined spring (duration/bounce),
  //    G2 = physics spring (stiffness/damping), to show which one inherits the in-flight velocity.
  async function retargetTest(label, patch) {
    await quiet();
    const n = await startCount();
    await page.evaluate(() => document.querySelector('.journal-carousel').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    await nextStart(n);
    await sleep(120);
    const rt = await page.evaluate(p => { const vm = window.__vellumMotion; vm.override(p); return vm.retarget('x'); }, patch);
    await sleep(2600);
    const { log, samples } = await S();
    const starts = log.filter(e => e.ev === 'animationStart');
    const a = starts[n], b = starts[n + 1];
    const around = samples.filter(s => s[0] > b.t - 70 && s[0] < b.t + 70).map(s => [Math.round(s[0] - a.t), +s[1].toFixed(2)]);
    const steps = around.slice(1).map((s, i) => +(s[1] - around[i][1]).toFixed(1));
    const target = await page.evaluate(() => window.__vellumMotion.ve.animationState.getState().animate.prevResolvedValues.x);
    console.log(label, JSON.stringify({ patch, rt, origStartToRetargetMs: Math.round(b.t - a.t), cancels: log.filter(e => e.ev === 'animationCancel' && e.t > a.t).length, newAnim: b.info && (b.info.inner || b.info.options), framesAroundRetarget: around, perFrameStepPx: steps, ...metrics(samples, b.t, b.t + 2500, target) }));
    console.log(label + ' revert:', JSON.stringify(await page.evaluate(() => window.__vellumMotion.revert())));
  }
  await retargetTest('G1 retarget (time-defined spring)', { type: 'spring', duration: 1.5, bounce: 0.5 });
  await retargetTest('G2 retarget (physics spring)', { type: 'spring', stiffness: 120, damping: 9 });
  await capture('H reverted again, keyboard preview', () => page.evaluate(() => {
    document.querySelector('.journal-carousel').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  }));
  console.log('final read:', JSON.stringify(await page.evaluate(() => window.__vellumMotion.read())));
  await browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
