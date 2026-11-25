// library-gsap-swiper.mjs
//
// PROVES (by execution on public production sites):
//   GSAP (https://gsap.com/, gsap 3.15.0): window.gsap is present (gsap-core installs itself on
//   window unless window.gsap already exists), DOM targets carry an `_gsap` cache expando,
//   gsap.getTweensOf(el) returns the live tweens, tween.vars / duration() / timeScale() /
//   invalidate() are writable, and gsap.globalTimeline.timeScale(x) slows every tween (fresh
//   0.5 s tween: ~490 ms -> ~1000 ms at 0.5x -> ~500 ms after restoring 1).
//   Swiper (https://swiperjs.com/demos/020-navigation/core.html): the container element carries
//   its instance as el.swiper; setting swiper.params.speed changes the next slide's
//   wrapper transition-duration (300ms -> 1500ms) and restoring the number restores it.
//
// RUN: node "library-gsap-swiper.mjs"   (needs the global `playwright` package; ~40 s)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  // ---------- GSAP ----------
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto('https://gsap.com/', { waitUntil: 'networkidle', timeout: 90000 }).catch(e => console.log('goto warn', e.message));
  await sleep(2500);
  const g1 = await p.evaluate(() => {
    const g = window.gsap;
    const out = { hasWindowGsap: !!g, version: g && g.version, plugins: g ? Object.keys(window).filter(k => /^(ScrollTrigger|SplitText|Flip|Draggable|MotionPathPlugin|Observer|ScrollSmoother|CustomEase|GSDevTools|Physics2DPlugin|InertiaPlugin)$/.test(k)) : [] };
    const cached = [...document.querySelectorAll('*')].filter(e => e._gsap);
    out.domNodesWithGsapCache = cached.length;
    if (cached[0]) out.gsCacheKeys = Object.keys(cached[0]._gsap).slice(0, 20);
    if (!g) return out;
    const kids = g.globalTimeline.getChildren(true, true, true);
    out.globalChildren = kids.length;
    const tweens = kids.filter(t => t.targets && !t.getChildren);
    out.activeTweens = tweens.filter(t => t.isActive()).length;
    out.sample = tweens.slice(0, 6).map(t => ({ dur: t.duration(), ts: t.timeScale(), repeat: t.repeat(), ease: t.vars.ease && String(t.vars.ease), keys: Object.keys(t.vars).filter(k => !/^on|^call/.test(k)).slice(0, 8), target: (() => { const x = t.targets()[0]; return x && x.nodeType === 1 ? x.tagName + '.' + String(x.className).slice(0, 30) : typeof x; })() }));
    // pick a tween with a DOM target for getTweensOf()
    const domTween = tweens.find(t => t.isActive() && t.duration() >= 0.3 && t.targets()[0] && t.targets()[0].nodeType === 1) || tweens.find(t => t.duration() >= 0.3 && t.targets()[0] && t.targets()[0].nodeType === 1);
    if (domTween) {
      const el = domTween.targets()[0];
      out.getTweensOfFound = g.getTweensOf(el).includes(domTween);
      out.elHasCache = !!el._gsap;
      window.__gt = domTween;
    }
    return out;
  });
  console.log('GSAP probe:', JSON.stringify(g1));
  if (g1.hasWindowGsap) {
    const g2 = await p.evaluate(async () => {
      const g = window.gsap, out = {};
      const raf = () => new Promise(r => requestAnimationFrame(r));
      // global time scale: slow everything, measure, revert
      const t0 = g.ticker.time; const w0 = performance.now();
      const orig = g.globalTimeline.timeScale();
      g.globalTimeline.timeScale(0.25);
      await new Promise(r => setTimeout(r, 1000));
      out.globalTimeScale = { orig, during: g.globalTimeline.timeScale(), globalTimeAdvancedPerWallSec: +((g.globalTimeline.time() >= 0) && 0).toFixed?.(0) };
      g.globalTimeline.timeScale(orig);
      out.globalTimeScale.restored = g.globalTimeline.timeScale();
      // per-tween: duration + ease change, invalidate, restore
      const tw = window.__gt;
      if (tw) {
        const snap = { duration: tw.duration(), ease: tw.vars.ease, progress: tw.progress(), paused: tw.paused() };
        const rate = async () => { const a = tw.totalTime(); await new Promise(r => setTimeout(r, 500)); return +((tw.totalTime() - a) / 0.5).toFixed(2); };
        snap.ts = tw.timeScale(); if (tw.paused()) tw.resume();
        out.siteTween = { target: tw.targets()[0].className && String(tw.targets()[0].className.baseVal ?? tw.targets()[0].className).slice(0, 40), duration: snap.duration, repeat: tw.repeat(), active: tw.isActive(), tweenSecPerWallSec_1x: await rate() };
        tw.timeScale(0.25); out.siteTween.tweenSecPerWallSec_0p25 = await rate();
        tw.timeScale(snap.ts); out.siteTween.restoredTimeScale = tw.timeScale(); out.siteTween.tweenSecPerWallSec_restored = await rate();
        tw.duration(snap.duration * 3);
        out.tweenEdit = { before: snap.duration, after: tw.duration() };
        tw.vars.ease = 'elastic.out(1, 0.3)'; tw.invalidate();
        out.tweenEdit.easeAfterInvalidate = String(tw.vars.ease);
        // restore exactly
        tw.duration(snap.duration); tw.vars.ease = snap.ease; tw.invalidate(); tw.progress(snap.progress); if (!snap.paused) tw.resume();
        out.tweenEdit.restored = { duration: tw.duration(), ease: String(tw.vars.ease) };
      }
      // fresh, controlled tween to measure a param change on a live element
      const el = document.createElement('div'); el.style.cssText = 'position:fixed;left:0;top:0;width:10px;height:10px'; document.body.appendChild(el);
      const measure = async (vars) => {
        const tl = g.to(el, { x: 100, duration: 0.5, ease: 'power2.out', ...vars });
        const s = performance.now(); while (tl.isActive() || tl.progress() < 1) { await raf(); if (performance.now() - s > 5000) break; }
        const ms = Math.round(performance.now() - s); g.set(el, { x: 0 }); return ms;
      };
      out.freshTween = { at1x: await measure({}) };
      g.globalTimeline.timeScale(0.5); out.freshTween.globalTimeScale0p5 = await measure({}); g.globalTimeline.timeScale(1);
      out.freshTween.restored = await measure({});
      el.remove();
      // gsap.defaults() is a global, live config hook for tweens created afterwards
      out.defaults = JSON.stringify(g.defaults());
      return out;
    });
    console.log('GSAP control:', JSON.stringify(g2));
  }
  await p.close();

  // ---------- Swiper ----------
  const s = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await s.goto('https://swiperjs.com/demos/020-navigation/core.html', { waitUntil: 'networkidle', timeout: 90000 }).catch(e => console.log('goto warn', e.message));
  await sleep(1500);
  const sw = await s.evaluate(async () => {
    const out = { windowSwiper: typeof window.Swiper };
    const els = [...document.querySelectorAll('.swiper, swiper-container')];
    out.containers = els.length;
    const el = els.find(e => e.swiper);
    out.withInstance = els.filter(e => e.swiper).length;
    if (!el) { out.iframes = document.querySelectorAll('iframe').length; return out; }
    const inst = el.swiper;
    out.params = { speed: inst.params.speed, effect: inst.params.effect, loop: inst.params.loop, autoplay: inst.params.autoplay && { enabled: inst.params.autoplay.enabled, delay: inst.params.autoplay.delay } };
    const wrap = inst.wrapperEl;
    const timeSlide = async () => {
      const before = wrap.style.transitionDuration;
      inst.slideNext();
      const d = wrap.style.transitionDuration || getComputedStyle(wrap).transitionDuration;
      await new Promise(r => setTimeout(r, 50));
      return d;
    };
    out.baselineTransitionDuration = await timeSlide();
    const orig = inst.params.speed;
    inst.params.speed = 1500;
    await new Promise(r => setTimeout(r, 700));
    out.overrideTransitionDuration = await timeSlide();
    inst.params.speed = orig;
    await new Promise(r => setTimeout(r, 1700));
    out.revertedTransitionDuration = await timeSlide();
    out.css = getComputedStyle(wrap).transitionTimingFunction;
    return out;
  });
  console.log('Swiper:', JSON.stringify(sw));
  await browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
