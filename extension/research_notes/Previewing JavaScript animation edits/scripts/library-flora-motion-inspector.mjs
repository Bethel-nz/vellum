// library-flora-motion-inspector.mjs
//
// PROVES (by execution on https://flora.so/): Motion's undocumented globalThis.__MOTION_INSPECT__
// hook (motion-dom >= 13.3.0, present in flora's bundle) fires on every JS animation start even when
// installed LATE (after load, as an on-demand MAIN-world injection would), because motion-dom reads
// the global at call time. The record's `options` object IS the live animation's options
// (record.animation.options === record.options), `options.element` is the VisualElement
// (element.current = DOM node) and `options.motionValue` is the MotionValue. Rewriting
// options.duration/bounce and calling record.animation.initAnimation() at start changes the spring
// (overshoot ~2.2 px -> ~47 px), stays in force for following re-renders, and the live handle
// supports pause() / time = s / speed = x / play(). Removing the hook restores the original.
// Run 2 installs the hook with addInitScript to list what fires during page load.
//
// RUN: node "library-flora-motion-inspector.mjs"   (needs the global `playwright` package; ~50 s)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const TRACK = '.journal-carousel .t-panel-slide > div';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// MAIN-world installer; chains any existing hook and is fully removable.
function installInspector() {
  if (window.__vmi) return 'already';
  const prev = Object.getOwnPropertyDescriptor(globalThis, '__MOTION_INSPECT__');
  const vmi = { records: [], samples: [], override: null, control: false, last: null, prev };
  const summarize = r => {
    const o = r.options || {};
    return {
      kind: r.kind, t: performance.now(), name: o.name,
      typeOf: typeof o.type, typeName: typeof o.type === 'function' ? o.type.name || '(fn)' : o.type,
      duration: o.duration, bounce: o.bounce, stiffness: o.stiffness, damping: o.damping, velocity: o.velocity,
      keyframes: Array.isArray(o.keyframes) ? o.keyframes.slice(0, 3) : o.keyframes,
      elementIsVisualElement: !!(o.element && typeof o.element.getDefaultTransition === 'function'),
      elementTag: o.element && o.element.current ? o.element.current.tagName + '.' + o.element.current.className : null,
      isCarousel: !!(o.element && o.element.current && o.element.current.matches && o.element.current.matches('.journal-carousel .t-panel-slide > div')),
      motionValueIsLive: !!(o.motionValue && o.motionValue.animation === r.animation),
      optionsIsAnimationOptions: r.animation && r.animation.options === r.options,
      animKeys: r.animation ? ['time', 'speed', 'state', 'duration'].map(k => [k, r.animation[k]]) : null,
      hasInitAnimation: !!(r.animation && typeof r.animation.initAnimation === 'function'),
    };
  };
  const hook = function (r) {
    try {
      const s = summarize(r);
      const o = r.options || {};
      if (s.isCarousel && o.name === 'x') {
        vmi.last = r;
        if (vmi.override && typeof r.animation.initAnimation === 'function') {
          s.before = { duration: o.duration, bounce: o.bounce };
          Object.assign(o, vmi.override);       // options are the animation's live options object
          r.animation.initAnimation();          // rebuild the generator at t≈0 with the new spring
          s.after = { duration: o.duration, bounce: o.bounce, calc: r.animation.calculatedDuration };
        }
      }
      vmi.records.push(s);
    } catch (e) { vmi.records.push({ error: String(e) }); }
    if (prev && typeof prev.value === 'function') return prev.value.call(this, r);
  };
  Object.defineProperty(globalThis, '__MOTION_INSPECT__', { value: hook, configurable: true, writable: true });
  vmi.remove = () => {
    if (prev) Object.defineProperty(globalThis, '__MOTION_INSPECT__', prev); else delete globalThis.__MOTION_INSPECT__;
    return { present: '__MOTION_INSPECT__' in globalThis };
  };
  const track = document.querySelector('.journal-carousel .t-panel-slide > div');
  const loop = () => {
    const m = /translateX\((-?[\d.]+)px\)/.exec(track.style.transform);
    vmi.samples.push([performance.now(), m ? parseFloat(m[1]) : 0]);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  window.__vmi = vmi;
  return 'installed';
}

function metrics(samples, t0, t1, to) {
  const seg = samples.filter(s => s[0] >= t0 - 1 && s[0] <= t1);
  const from = seg[0][1]; const dir = Math.sign(to - from) || 1;
  let peak = -Infinity, settle = seg[0][0];
  for (const [, x] of seg) peak = Math.max(peak, dir * (x - to));
  for (let i = seg.length - 1; i >= 0; i--) if (Math.abs(seg[i][1] - to) > 0.5) { settle = seg[Math.min(i + 1, seg.length - 1)][0]; break; }
  return { from: +from.toFixed(1), to, overshootPx: +Math.max(0, peak).toFixed(2), settleWithin0p5pxMs: Math.round(settle - t0) };
}

(async () => {
  const browser = await chromium.launch();
  // --- Run 1: late, on-demand install (what an activeTab + executeScript MAIN-world injection can do)
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('https://flora.so/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector(TRACK, { state: 'attached' });
  await sleep(500);
  console.log('hook before install:', await page.evaluate(() => typeof globalThis.__MOTION_INSPECT__));
  console.log('install (late, after load):', await page.evaluate(installInspector));
  const carouselStarts = () => page.evaluate(() => window.__vmi.records.filter(r => r.isCarousel && r.name === 'x').length);
  const waitStart = async n => page.waitForFunction(n => window.__vmi.records.filter(r => r.isCarousel && r.name === 'x').length > n, n, { timeout: 9000, polling: 16 });
  async function slide(label, setup) {
    const n = await carouselStarts();
    if (setup) await page.evaluate(setup);
    await waitStart(n);
    await sleep(2600);
    const { recs, samples } = await page.evaluate(() => ({ recs: window.__vmi.records.filter(r => r.isCarousel && r.name === 'x'), samples: window.__vmi.samples.slice(-400) }));
    const r = recs[n];
    const to = r.keyframes[r.keyframes.length - 1];
    const row = { label, record: r, ...metrics(samples, r.t, r.t + 2500, to) };
    console.log(JSON.stringify(row));
    return row;
  }
  await slide('I1 hook fires on autoplay (no change)');
  await slide('I2 hook rewrites options + initAnimation()', () => { window.__vmi.override = { duration: 1500, bounce: 0.5 }; });
  await slide('I3 still overriding on the following re-render', null);
  // I4: control the live handle: pause, scrub time, change speed
  const n = await carouselStarts();
  await page.evaluate(() => { window.__vmi.override = null; });
  await waitStart(n);
  await sleep(100);
  const ctl = await page.evaluate(async () => {
    const a = window.__vmi.last.animation, mv = window.__vmi.last.options.motionValue;
    const out = {};
    a.pause(); out.paused = { state: a.state, time: a.time, v: mv.get() };
    await new Promise(r => setTimeout(r, 300));
    out.after300msPaused = { time: a.time, v: mv.get() };
    a.time = 0.3; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    out.scrubbedTo0p3s = { time: a.time, v: mv.get() };
    a.time = 0.05; a.speed = 0.25; a.play(); const t0 = performance.now();
    await new Promise(r => { const chk = () => (a.state === 'finished' || !mv.isAnimating()) ? r() : requestAnimationFrame(chk); chk(); });
    out.speed0p25 = { wallMsFrom0p05s: Math.round(performance.now() - t0), state: a.state, duration: a.duration, v: mv.get() };
    return out;
  });
  console.log('I4 control:', JSON.stringify(ctl));
  console.log('I5 remove hook:', JSON.stringify(await page.evaluate(() => window.__vmi.remove())));
  const before = await page.evaluate(() => window.__vmi.records.length);
  const x0 = await page.evaluate(() => window.__vmi.samples[window.__vmi.samples.length - 1][1]);
  await page.waitForFunction(x0 => Math.abs(window.__vmi.samples[window.__vmi.samples.length - 1][1] - x0) > 1, x0, { timeout: 9000, polling: 'raf' });
  const startT = await page.evaluate(x0 => { const s = window.__vmi.samples; let i = s.length - 1; while (i > 0 && Math.abs(s[i][1] - x0) > 0.5) i--; return s[i][0]; }, x0);
  await sleep(2600);
  const after = await page.evaluate(() => window.__vmi.records.length);
  const samples = await page.evaluate(() => window.__vmi.samples.slice(-400));
  console.log('I5 next autoplay after removal: records added =', after - before, JSON.stringify(metrics(samples, startT, startT + 2500, Math.round(x0 - 288))));
  await page.close();

  // --- Run 2: document-start install via addInitScript; what fires during load?
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => {
    const recs = []; window.__early = recs;
    globalThis.__MOTION_INSPECT__ = r => recs.push({ kind: r.kind, t: Math.round(performance.now()), name: r.options && r.options.name, el: r.options && r.options.element && r.options.element.current ? r.options.element.current.className.slice(0, 30) : r.node ? 'projection-node' : null });
  });
  const p2 = await ctx.newPage();
  await p2.goto('https://flora.so/', { waitUntil: 'networkidle', timeout: 60000 });
  await sleep(6000);
  const early = await p2.evaluate(() => window.__early);
  const byKind = {}; for (const r of early) { const k = r.kind + ':' + r.name + ':' + r.el; byKind[k] = (byKind[k] || 0) + 1; }
  console.log('Run2 addInitScript: total', early.length, 'first at', early[0] && early[0].t, 'ms; groups', JSON.stringify(byKind).slice(0, 1500));
  await browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
