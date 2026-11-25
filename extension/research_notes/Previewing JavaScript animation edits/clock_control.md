# Taking over a page's clock from Vellum Snapshot (slow motion, pause, frame step, restore)

Scope: how Snapshot (MV3; Chrome, Edge, Dia) can virtualize page time so script-driven animation (Motion on
flora.so) can be slowed to 0.1x–1x, paused and stepped one frame at a time, then hand the real clock back
with no residue. Everything here is as of 2026-11-25.

Evidence labels used throughout:
- **[executed]**: measured by a script in `scripts/clock-*.mjs` (Playwright 1.63.0, bundled Chromium
  158.0.8127.36 headless, flora.so live on 2026-11-25). Each script has a header saying what it proves and how
  to run it. All of them were re-run from the repo location before these notes were finalized.
- **[source]**: read in the shipped code: flora's production chunks, or the npm tarballs of motion-dom /
  framer-motion / devtools-protocol / playwright-core. Tarballs were only read, never executed.
- **[documented]**: vendor documentation.
- **[inference]** / **[speculation]**: my reasoning, not verified.

Versions relied on: flora ships **motion-dom 14.1.0** (latest Motion on npm is 14.14.0, published 2026-11-13).
Flora also ships Next.js 16.4.0. Tests used Playwright 1.63.0, Chromium 158.0.8127.36 headless (default
headless-shell build; one test repeated on the full `chromium` channel) and devtools-protocol 0.0.1752859.
The proof scripts are `scripts/clock-vclock.mjs` (the clock), `scripts/clock-lib.mjs` (harness and
per-real-frame sampler), and `clock-late`, `clock-docstart`, `clock-waapi`, `clock-cdp-knobs`,
`clock-cdp-inject` and `clock-release` (all `.mjs`).

## Which time sources Motion's frame loop and spring use, which version flora ships, and whether late injection can work

### Takeaway
Motion keeps the native `requestAnimationFrame` it saw when its module loaded, but it calls the global
`performance.now()` afresh on every frame, and it times springs from that value, not from the rAF
timestamp. So a clock that overrides `performance.now` **after load** fully controls flora's spring.
Injecting at `document_start` is needed only for timers the page has already created (flora's autoplay
`setInterval`) and for libraries that keep a reference to the clock function itself.

### Cited Findings
- **[source]** Flora's production chunk builds Motion's frame loop as
  `eR("u">typeof requestAnimationFrame?requestAnimationFrame:eT,!0,e$)`. That is
  `createRenderBatcher(typeof requestAnimationFrame !== "undefined" ? requestAnimationFrame : noop, true, frameData)`,
  evaluated once at module load, so the rAF reference is fixed at load. — [flora chunk 43t38g6et1zz8.js](https://flora.so/_next/static/immutable/chunks/43t38g6et1zz8.js); [motion-dom 14.1.0 frameloop/frame.mjs](https://unpkg.com/motion-dom@14.1.0/dist/es/frameloop/frame.mjs)
- **[source]** Each frame, `processBatch` takes its timestamp from
  `MotionGlobalConfig.useManualTiming ? state.timestamp : performance.now()` and ignores the rAF argument. It
  sets `delta = max(min(timestamp - last, 40), 1)` (`maxElapsed = 40`), and the first frame after waking uses
  `1000/60`. — [motion-dom 14.1.0 frameloop/batcher.mjs](https://unpkg.com/motion-dom@14.1.0/dist/es/frameloop/batcher.mjs) (flora's minified copy: `a=s?i.timestamp:performance.now()`, same chunk as above)
- **[source]** `time.now()` returns the frame timestamp while a frame is processing. Otherwise it returns
  `performance.now()`, cached until the next microtask. The animation driver's `now()` uses
  `frameData.isProcessing ? frameData.timestamp : time.now()`. — [sync-time.mjs](https://unpkg.com/motion-dom@14.1.0/dist/es/frameloop/sync-time.mjs); [animation/drivers/frame.mjs](https://unpkg.com/motion-dom@14.1.0/dist/es/animation/drivers/frame.mjs)
- **[source]** `JSAnimation.tick(timestamp)` computes `currentTime = (timestamp - startTime) * speed`, so a spring
  is a pure function of elapsed time. It clamps `startTime = Math.min(startTime, timestamp)`, which means a
  clock that runs backwards would corrupt it. `resolveStartTime` restarts an animation from "now" if its
  first frame comes more than 40 ms after it was created (`MAX_START_DELAY = 40`, skipped under
  `useManualTiming`). — [JSAnimation.mjs](https://unpkg.com/motion-dom@14.1.0/dist/es/animation/JSAnimation.mjs); [resolve-start-time.mjs](https://unpkg.com/motion-dom@14.1.0/dist/es/animation/utils/resolve-start-time.mjs)
- **[source]** In motion-dom 14.1.0 the only `performance.now()` reads are in `batcher.mjs` and `sync-time.mjs`.
  There are no `Date.now`, `setTimeout` or `document.timeline` reads (grep of `dist/es`). framer-motion 14.1.0
  also calls `performance.now()` once, for optimised appear animations. — [motion-dom 14.1.0 tarball](https://registry.npmjs.org/motion-dom/-/motion-dom-14.1.0.tgz); [framer-motion 14.1.0 animation/optimized-appear/start.mjs](https://unpkg.com/framer-motion@14.1.0/dist/es/animation/optimized-appear/start.mjs)
- **[source]** Version identification:
  - `globalThis.__MOTION_INSPECT__` is present in motion-dom 13.3.0 and later, and absent in 13.2.0.
  - `resolve-start-time.mjs` first appears in 14.1.0.
  - `animation/waapi/transforms/TransformAnimation.mjs` first appears in 14.2.0.
  - Flora's chunk has the inspector hook and `resolveStartTime` (`nk=(e,t)=>t-e>40&&!eL.useManualTiming?t:e`)
    but none of TransformAnimation's method names (`demote`, `liveValue`, `isAccelerated`, `stopJS`).
  - It calls `i({...e,keyframes:[0,t]})` without the velocity rescale that 14.1.1 added to
    `create-generator-easing.mjs`.

  So flora runs **motion-dom 14.1.0** (released 2026-10-09). — [flora chunk](https://flora.so/_next/static/immutable/chunks/43t38g6et1zz8.js); [motion-dom 14.1.1 create-generator-easing.mjs](https://unpkg.com/motion-dom@14.1.1/dist/es/animation/generators/utils/create-generator-easing.mjs); [npm registry times](https://registry.npmjs.org/motion-dom)
- **[source]** The carousel is a `motion.div` with `animate:{x:-m*j+y}` and
  `transition:{type:"spring",duration:f.motion.springDuration,bounce:f.motion.springBounce}`. Its defaults are
  `springDuration .55`, `springBounce .16` and `pageWidth 240 + pageGap 48`, which gives 288 px per page. The
  autoplay is
  `window.setInterval(()=>{g(e=>e+1)},1e3*f.playback.interval)` with a default `interval` of **5 s**, set up in a
  `useEffect` that depends on in-view, dragging and reduced motion. `window.setInterval` is looked up when the
  effect runs, not stored. — [flora chunk, `JournalCard`](https://flora.so/_next/static/immutable/chunks/43t38g6et1zz8.js)
- **[source]** Flora's React scheduler reads time with `u=performance; n.unstable_now=function(){return u.now()}`.
  It keeps the `performance` object, not the function, so an instance override of `performance.now` reaches
  it too. — [flora chunk 0uswttq3yh8ka.js](https://flora.so/_next/static/immutable/chunks/0uswttq3yh8ka.js)
- **[executed]** With the clock injected after load, the spring obeys it exactly:
  - 1x: 567 ms, 34 frames, overshoot 2.22 px.
  - 0.25x: 2216–2217 ms, 133 frames, overshoot 2.22 px.

  The only thing late injection missed was the autoplay timer. — `scripts/clock-late.mjs`

### Inferences
- Motion's `MotionGlobalConfig.useManualTiming` would be the cleanest switch, but it lives in module scope
  of a minified bundle and the page cannot reach it. Overriding `performance.now` gets the same effect from
  outside.
- The time sources that matter for Motion are therefore `performance.now()` (frame time and spring time)
  and, for gestures, `event.timeStamp`. Flora's own drag code calls `A(!0,e.timeStamp)`. The rAF timestamp
  argument matters for page code that reads it, for example flora's marquee loop
  `n=r=>{let a=Math.min(.05,(r-i)/1e3)...}`, which looks up `requestAnimationFrame` globally on each call.

### Gaps
- I did not check other libraries' caching behaviour (GSAP, anime.js, Swiper, Embla). Any library that stores
  `performance.now` or `Date.now` as a function reference at load is unaffected by late injection.
- I could not identify Motion's exact `motion`/`framer-motion` package version beyond motion-dom 14.1.0.
  framer-motion versions track motion-dom, so 14.1.0 is likely ([inference]).

## Whether Motion hands animations to WAAPI and how to keep CSS/WAAPI in step

### Takeaway
Yes. Motion 14.1 runs `opacity`, `clipPath`, `filter`, a literal `transform` and `backgroundColor` (plus
browser-only colour formats) as WAAPI animations. Motion 14.2+ can also accelerate individual transforms
such as `x` through WAAPI (`TransformAnimation`). A complete takeover must therefore also scale every
`document.getAnimations()` entry. It must also translate `Animation.startTime` writes: Motion sets them from
the virtualized `performance.now()` while `document.timeline` stays real, and without translation those
animations jump straight to their end.

### Cited Findings
- **[source]** In 14.1.0, `acceleratedValues = {opacity, clipPath, filter, transform, backgroundColor}`.
  `supportsBrowserAnimation` also requires an `HTMLElement`/`SVGElement` owner, no `onUpdate`, no
  `transformTemplate` for `transform`, no `repeatDelay`, `repeatType !== "mirror"`, `damping !== 0` and
  `type !== "inertia"`. Browser-only colours (oklch and similar) are forced onto WAAPI. — [accelerated-values.mjs](https://unpkg.com/motion-dom@14.1.0/dist/es/animation/waapi/utils/accelerated-values.mjs); [waapi/supports/waapi.mjs](https://unpkg.com/motion-dom@14.1.0/dist/es/animation/waapi/supports/waapi.mjs)
- **[source]** For WAAPI animations that start synchronously, `AsyncMotionValueAnimation` sets
  `options.startTime = resolveStartTime(this.createdAt, this.resolvedAt)`, and those come from `time.now()`.
  `NativeAnimationExtended` then writes `this.animation.startTime = options.startTime` onto the real WAAPI
  `Animation`, which runs on `document.timeline`. — [AsyncMotionValueAnimation.mjs](https://unpkg.com/motion-dom@14.1.0/dist/es/animation/AsyncMotionValueAnimation.mjs); [NativeAnimationExtended.mjs](https://unpkg.com/motion-dom@14.1.0/dist/es/animation/NativeAnimationExtended.mjs); [NativeAnimation.mjs](https://unpkg.com/motion-dom@14.1.0/dist/es/animation/NativeAnimation.mjs)
- **[source]** From 14.2.0, `AsyncMotionValueAnimation` can create a `TransformAnimation`. It runs transform
  values such as `x` on WAAPI when `canAccelerateTransform` passes: no handoff, no `onUpdate`, no
  `transformTemplate`, not inertia, a literal `transform` of `none`, not projecting, no mixer. — [motion-dom 14.14.0 TransformAnimation.mjs](https://unpkg.com/motion-dom@14.14.0/dist/es/animation/waapi/transforms/TransformAnimation.mjs); [motion-dom 14.2.0 TransformAnimation.mjs](https://unpkg.com/motion-dom@14.2.0/dist/es/animation/waapi/transforms/TransformAnimation.mjs)
- **[executed]** On flora, the carousel transition produces no WAAPI animation: `document.getAnimations()` is `[]`
  when it starts. The 10 animations present at load are all `CSSTransition`s (opacity/transform/filter)
  from the panel entrance. — `scripts/clock-cdp-knobs.mjs`, `scripts/clock-late.mjs`
- **[executed]** Scaling every animation's `playbackRate` each real frame keeps CSS in step:
  - An existing CSS animation advanced 996–1000 ms per 4000 ms of wall time at 0.25x.
  - A CSS animation created while slowed had `playbackRate 0.25` by the next frame and advanced 500 ms in 2000 ms.
  - Paused, it advanced 0 ms; one step advanced 17 ms.
  - Rates went back to 1 on uninstall.

  — `scripts/clock-waapi.mjs`
- **[executed]** The startTime hazard, reproduced Motion-style (`a = el.animate(...2000 ms); a.startTime = performance.now()`)
  under a virtual clock lagging 4.59 s behind real time:
  - Without translation, `currentTime` was **4578 ms** two frames later and opacity was 1, so the animation
    finished instantly.
  - With the `Animation.prototype.startTime` setter translated to `currentTime = (vnow - v) * pageRate`, it
    was **4 ms** in (opacity 0.002), as expected.

  — `scripts/clock-waapi.mjs`

### Inferences
- On sites running Motion 14.2+, a carousel like flora's will probably run on WAAPI rather than JS, unless
  one of the exclusions applies ([inference]). In that case Snapshot's existing `getAnimations()`
  speed/pause controls would already see it, but Motion would still read the virtual clock when it
  interrupts or samples the animation. The startTime translation is what keeps both views consistent.
- Pausing by setting `playbackRate = 0` is less visible to the page than `pause()`, which changes `playState`.
  Motion and other libraries branch on `playState`.

### Gaps
- I did not exercise Motion's own `NativeAnimation` path on a live page, because no Motion WAAPI animation
  runs on flora. The hazard and fix are verified on a synthetic animation written to match Motion's source.
- I did not test scroll-driven animations (`ScrollTimeline`/`ViewTimeline`). They are not time-based, so they
  should be left alone ([inference]).
- I did not test page code that sets `playbackRate` itself while the takeover is active. The clock would
  overwrite it on the next frame; it needs a getter/setter shim on `playbackRate` ([inference]).

## How to inject from the MAIN world under MV3, and how the ISOLATED content script and the MAIN-world clock talk safely

### Takeaway
There are two routes and both are allowed:
- **Late, no reload:** `chrome.scripting.executeScript({ world: 'MAIN', func: installVirtualClock, args })`.
  Snapshot can do this today under `activeTab`.
- **Document start:** CDP `Page.addScriptToEvaluateOnNewDocument` + `Page.reload` through the `debugger`
  permission Snapshot already holds. This works without new permissions, survives detach, and the
  registration disappears with the session.

`registerContentScripts({world:'MAIN', runAt:'document_start'})` would need host permissions Snapshot does
not have. For the channel, use a per-install random-named `CustomEvent` on `document` with a JSON-string
`detail`. The page can always spoof or sniff MAIN-world traffic, so the isolated side must treat anything
coming from MAIN as untrusted data and never give it privileges.

### Cited Findings
- **[documented]**
  - `ExecutionWorld.MAIN` is "the main world of the DOM, which is the execution environment shared with the
    host page's JavaScript".
  - `func` "will be serialized, and then deserialized for injection… any bound parameters and execution
    context will be lost".
  - `args` "must be JSON-serializable".
  - `world` is supported in `executeScript` since Chrome 95 and in `registerContentScripts` since Chrome 102.
  - `injectImmediately` does not guarantee injection before page load.
  - `RegisteredContentScript.persistAcrossSessions` defaults to true.

  — [chrome.scripting reference](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- **[documented]** "When a content script is injected into the main world, the CSP of the page applies."
  `document_start` scripts are injected "before any other DOM is constructed or any other script is run".
  On the isolated world: "An isolated world is a private execution environment that isn't accessible to the
  page or other extensions." On communicating with the page: "Be sure to filter for malicious web pages." — [Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- **[documented]** The activeTab grant "lasts while the user is on that page" and is revoked when the user
  "navigates away or closes the tab". The example: example.com to example.com/foo keeps access, chromium.org
  revokes it. The page does not mention `registerContentScripts`. — [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- **[documented]** Sources disagree on whether `registerContentScripts` works under activeTab:
  - MDN says the extension needs permission for the page's URL "either explicitly as a host permission or
    using the activeTab permission".
  - Extension.js says persistent registration needs `host_permissions` covering `matches`, because activeTab
    does not apply to future pages.
  - Chrome's reference does not say.

  — [MDN registerContentScripts](https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/API/scripting/registerContentScripts); [Extension.js inject scripts](https://extension.js.org/docs/implementation-guide/inject-scripts)
- **[documented]** Remotely hosted code is "anything that is executed by the browser" that is loaded from
  outside the extension's files. Extensions "need to bundle *all* code they are using inside the extension
  itself". On `chrome.debugger`: "an extension can request and execute remote code". The user sees a
  warning bar, and dismissing it ends the session. — [Deal with remote hosted code violations](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code)
- **[documented]** `Page.addScriptToEvaluateOnNewDocument` "Evaluates given script in every frame upon creation
  (before loading frame's scripts)". It takes `worldName` (experimental, creates an isolated world) and
  `runImmediately` (experimental: "runs the script immediately on existing execution contexts"). — [devtools-protocol 0.0.1752859 browser_protocol.json](https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/browser_protocol.json); [CDP Page domain](https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-addScriptToEvaluateOnNewDocument)
- **[executed]** The CDP sequence `Page.enable` → `addScriptToEvaluateOnNewDocument(source)` → `Page.reload` (wait
  for `Page.loadEventFired`) gave `{clock: true, setIntervalWrapped: true}`. After `detach` it was still
  `{clock: true}`. After a later reload with that session gone it was `{clock: false}`, so the registration
  died with the session. An earlier run that skipped `Page.enable` and waited on Playwright's load state
  instead found no clock; that was probably a wait race and the cause is not isolated.
  `runImmediately: true` installed into the current document. — `scripts/clock-cdp-inject.mjs`
- **[executed]** Channel behaviour in Chromium 158 (CDP isolated world standing in for Snapshot's ISOLATED world):
  - A `CustomEvent` dispatched on `document` from the isolated world reaches a MAIN-world listener.
  - Its `detail` arrives intact as an object or a JSON string.
  - Events dispatched by the page are indistinguishable from ours, because `isTrusted` is false either way.
  - A page that had already hooked `EventTarget.prototype.addEventListener` captured our "secret" event name.
  - MAIN → isolated status events arrive the same way.
  - Neither world sees the other's globals.

  — `scratchpad exp-channel.mjs` (see Gaps; not copied as a proof script)

### Inferences
- `executeScript` with `func` and `files` runs code that ships in the package, so it is not remote code
  ([inference] from the RHC definition). The CDP `source` string should be built from that same packaged
  function (`installVirtualClock.toString()`), never fetched.
- Because the page's scripts run before ours in MAIN, no channel there can be secret against a
  determined page. The random event name only stops accidental collisions and casual spoofing. What spoofing
  could do is control the page's own clock, which the page can do anyway. Security rule: MAIN → isolated
  messages are display data only. Validate them (numbers in range) and never let them trigger capture,
  upload or native messaging.
- `registerContentScripts` would need new `optional_host_permissions` plus a runtime prompt, and a reload
  anyway. The CDP route needs only the `debugger` permission Snapshot already holds. The infobar shows only
  during the reload window.

### Gaps
- I did not run the cross-world channel test inside a real extension; a CDP isolated world was the
  stand-in. Its script is in the scratchpad (`clock/exp-channel.mjs`), not in `scripts/`.
- Whether activeTab survives a CDP-initiated `Page.reload` of the same URL is not stated in the docs. The
  example suggests same-site navigation keeps it ([inference]), but I did not test it in a real extension.
- I did not test Edge or Dia. Both are Chromium-based. Dia's `chrome.debugger` support is assumed because
  Snapshot already uses it there.

## Virtual clock design and edge cases

### Takeaway
The clock is `virtual = anchorV + (real - anchorR) * rate`. It is re-anchored on every rate change and
clamped to be monotonic. Pause freezes the anchor and step adds 16.67 ms to it. The clock patches
`performance.now`, `Date.now`, `new Date()`, `Event#timeStamp`, rAF/cAF, timers on a virtual heap, WAAPI
`playbackRate`/`startTime`, and nothing else. This design measured correctly on every edge case I tested.
The two things only document-start install fixes are timers created before injection and references
captured at load. The one thing that can make restore jump is uninstalling while something is mid-flight;
`release()` avoids it.

### Cited Findings
- **[executed]** Rate changes mid-animation do not jump. Re-anchoring (`anchorV = vnow(); anchorR = realNow()`)
  before changing the rate kept the largest per-frame step during a 0.5x → 1x change mid-spring at
  16.83 px. The 1x reference's largest step is 31.89 px. — `scripts/clock-release.mjs`
- **[executed]** The patched time sources agree with each other under 0.25x:
  - `event.timeStamp - performance.now()` = −0.05 ms.
  - `Date.now() - performance.now() - timeOrigin` = −1 ms (floor).
  - `new Date().getTime() - Date.now()` = 0.

  — `scripts/clock-docstart.mjs`
- **[executed]** Under pause, the page stays responsive. A keyboard `ArrowRight` was handled while the
  clock was paused: the React state advanced and the next stepped move went one page. Frames kept
  rendering (418 frames at a constant x over 7 s). — `scripts/clock-docstart.mjs`, `scripts/clock-late.mjs`
- **[executed]** Stepping is deterministic and frame-exact. Forty-five 16.67 ms steps traced the spring:
  - −585.04, −605.52, −634.22, −665.85, … peak −866.22 (overshoot 2.22 px), settling at −864 after
    **33 steps = 550 ms**, which matches `duration: 0.55`.
  - The late-injection run produced the same first four values.
  - The 1x per-frame trace of the same transition peaks at −290.216 relative to its target, the same 2.22 px.

  — `scripts/clock-docstart.mjs`, `scripts/clock-late.mjs`
- **[executed]** Timers created before injection stay on real time. With late injection, flora's autoplay
  interval kept firing every 5 s real time during pause and during stepping. The stepped move retargeted
  mid-way (steps 5+ diverge) and travelled two pages (−576 → −1152, overshoot 3.5–3.75 px). With
  document-start install, there was no autoplay during an 8 s pause. — `scripts/clock-late.mjs`, `scripts/clock-docstart.mjs`
- **[executed]** Restore behaviour:
  - `uninstall()` while idle: no visible jump (lag 15.2 s and 26.7 s absorbed). The next transitions ran
    at 567 ms.
  - `uninstall()` mid-transition at 0.1x **snapped** 62 px in one frame (−1951.8 → −2016), because the 5.1 s
    accumulated lag landed inside the spring.
  - `release({scope:'.journal-carousel'})` mid-transition: switched to 1x at once, finished the spring
    (783 ms total, overshoot 2.22 px), uninstalled 580 ms later once the carousel was quiet, and the next
    autoplay ran at 567 ms.

  — `scripts/clock-late.mjs`, `scripts/clock-release.mjs`
- **[executed]** Residue after uninstall: `performance.now` (own property deleted), `Date.now`, `Date`,
  `setTimeout`, `setInterval`, rAF/cAF, `Event#timeStamp` and `Animation#startTime` are native immediately.
  Timers still pending were moved to native timers with their remaining virtual delay (flora: the 5000 ms
  autoplay interval and a 7500 ms timeout). `clearTimeout`/`clearInterval` stay as pass-through wrappers
  only until those ids end. When the page later called `clearInterval(id from the takeover)` (carousel
  scrolled out of view), it worked: no autoplay for 11 s. When the moved timeout fired, both were native
  again. — `scripts/clock-release.mjs`, `scripts/clock-docstart.mjs`
- **[executed]** `typeof Temporal === 'object'` in Chromium 158, so `Temporal.Now` exists and this clock does
  not virtualize it. — `scripts/clock-release.mjs`
- **[documented]** Playwright's clock overrides `Date`, `Temporal.Now`, `setTimeout`, `clearTimeout`,
  `setInterval`, `clearInterval`, `requestAnimationFrame`, `cancelAnimationFrame`, `requestIdleCallback`,
  `cancelIdleCallback`, `performance` and `Event.timeStamp`. That is the reference surface for a complete
  takeover. — [Playwright Clock](https://playwright.dev/docs/clock)

### Inferences
Design details, implemented in `scripts/clock-vclock.mjs` unless marked:
- **Monotonic.** `lastV = max(lastV, computed)` on every read. rAF callbacks get
  `max(lastV, toVirtual(rafTimestamp))`, so every callback in one real frame sees the same virtual
  timestamp. Motion's `Math.min(startTime, timestamp)` clamp makes a backwards clock harmful, so the clamp
  is required.
- **rAF while paused.** rAF callbacks keep running every real frame with a frozen timestamp. This keeps
  rAF-scheduled UI work (React/Motion `frame.read`/`update`) responsive, and delta-based loops see dt = 0.
  Queuing callbacks until the next step would stall UI.
- **Timers.** Timers live on a virtual heap with a single real wake-up at
  `(due - vnow) / rate`, re-armed on every rate change, pause and step. A timer whose virtual due time has
  passed fires even while paused, so `setTimeout(0)` and promise-like hops still run (by construction; not
  separately measured). Ids come from a separate range (`0x50000000+`); unknown ids pass through to the
  native `clearTimeout`, so pre-existing timers can still be cleared.
- **Nested rAF and rAF inside timers.** These keep native semantics, because each wrapper call goes
  through the real rAF.
- **Date.** `Date` is replaced by a `Proxy` of the native constructor. `instanceof` keeps working for
  existing dates through the forwarded `prototype`, and argument-less construction and calls read virtual
  time. `Date.now` is patched on the native constructor itself.
- **Restore policy.** Rate goes to 1 immediately, then the clock uninstalls when the selected element's
  subtree has had no `style`/`class` mutations for 250 ms, with a fallback of 8 s. The forward jump of
  `performance.now` (equal to the accumulated lag) lands while nothing is mid-animation. Motion clamps big
  gaps (`maxElapsed 40`, velocity resets after 30 ms), and flora's own dt loop clamps at 50 ms, so a jump
  while idle is harmless.
- **Document-start install.** Libraries capture the wrappers (React's scheduler caches `setTimeout` at load,
  for example). After uninstall every wrapper checks `active === false` and calls the native function
  directly. Behaviour is identical to native; only function identity remains different.
- **Page visibility [speculation, not tested].** In a hidden tab, rAF stops but virtual time keeps
  advancing at `rate`. Auto-pausing on `visibilitychange` (hidden) and resuming on visible would make
  "paused" mean paused.
- **Iframes [speculation].** Each same-origin frame needs its own clock (`allFrames: true`), and rate
  commands should be broadcast to all of them.
- **Workers [speculation].** Workers have their own realm and are untouched. Animation driven from a
  worker (OffscreenCanvas) keeps real time.

### Gaps
- Not virtualized by this prototype: `Temporal.Now`, `requestIdleCallback` deadlines,
  `AudioContext.currentTime`, `HTMLMediaElement` playback (could be scaled with `playbackRate`;
  untested), `requestVideoFrameCallback`, and `performance.mark`/`measure`.
- I did not test iframes, workers, a hidden tab, or a page that saved `performance.now` as a function
  reference at load.
- The quiet detector watches `style`/`class` attribute writes. It would miss canvas/WebGL animation and
  CSS-variable changes on ancestors outside the scope.

## What CDP's own knobs actually do (Emulation.setVirtualTimePolicy, Animation.setPlaybackRate, Emulation.setCPUThrottlingRate)

### Takeaway
None of them slows flora's carousel. `Animation.setPlaybackRate` scales only CSS/WAAPI on the document
timeline. CPU throttling does not change time-based motion. `Emulation.setVirtualTimePolicy` can freeze
page time, but it also stops every timer (even `setTimeout(0)`), does not pause CSS, has no real-time
mode, and `advance` fast-forwards hours of page time per second. Neither detaching nor reloading undid it,
which makes it unusable on a user's live tab.

### Cited Findings
- **[documented]** `setVirtualTimePolicy` (experimental) "Turns on virtual time for all frames (replacing
  real-time with a synthetic time source) and sets the current virtual time policy". Policies:
  - `advance`: "If the scheduler runs out of immediate work, the virtual time base may fast forward to allow
    the next delayed task (if any) to run".
  - `pause`: "The virtual time base may not advance".
  - `pauseIfNetworkFetchesPending`.

  Parameters are `budget`, `maxVirtualTimeTaskStarvationCount` and `initialVirtualTime`. The Emulation
  domain has no command to turn virtual time off. `Animation.setPlaybackRate` "Sets the playback rate of the
  document timeline" (the Animation domain is experimental). `setCPUThrottlingRate` "Enables CPU
  throttling to emulate slow CPUs". — [devtools-protocol browser_protocol.json](https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/browser_protocol.json); [CDP Emulation](https://chromedevtools.github.io/devtools-protocol/tot/Emulation/#method-setVirtualTimePolicy); [CDP Animation](https://chromedevtools.github.io/devtools-protocol/tot/Animation/#method-setPlaybackRate)
- **[executed]** `Animation.setPlaybackRate(0.25)`: our CSS probe advanced 2749 ms in 10998 ms of wall time
  (0.25x). The carousel was unchanged: 564/577 ms on the same 5 s cadence. — `scripts/clock-cdp-knobs.mjs`
- **[executed]** `Emulation.setCPUThrottlingRate(6)`: the carousel still took 571/605 ms, rAF ran 656 frames
  per 11 s, and the cadence was unchanged. — `scripts/clock-cdp-knobs.mjs`
- **[executed]** `setVirtualTimePolicy({policy:'pause'})` on a normal tab:
  - `performance.now`/`Date.now` advanced 0 ms over 6 s.
  - rAF kept firing (359 frames).
  - The CSS animation kept running (5983 ms).
  - `setTimeout(0)` did **not** fire within 6 s.
  - CDP keyboard input was still processed: after `ArrowRight` the carousel's target moved one page,
    visible when time next advanced.
  - In one run (exp-cdp-inject, after another session had added a `runImmediately` script) `pause` did not
    freeze time (993 ms/s). On a fresh tab it froze reliably (0 ms over 3 × 1 s). That behaviour is not
    understood.

  — `scripts/clock-cdp-knobs.mjs`, `scripts/clock-cdp-inject.mjs`
- **[executed]** `advance` with `budget: 100`: virtual time moved about 50 ms and then stopped, and one
  `virtualTimeBudgetExpired` arrived. `advance` with no budget: `performance.now` advanced **13,685,000 ms in
  8 s of wall time**, and the autoplay interval fired thousands of times (track at −789,408 px). After
  `cdp.detach()` it kept running away (23,680,050 ms in 11 s). A fresh session and even `page.reload()` did not
  restore real time (1.25–2.5 million ms per wall second). The same happened on the full `chromium` channel
  build. — `scripts/clock-cdp-knobs.mjs`, `scripts/clock-cdp-inject.mjs`

### Inferences
- Virtual time is a headless-rendering tool, built for deterministic capture with budgets. It has no
  "real time × rate" mode, so slow motion is impossible with it, and its pause also freezes the page's
  zero-delay timers.
- The breakage is sticky in the renderer. In Snapshot, sending `setVirtualTimePolicy` to a user's tab would
  ruin the tab until it is closed ([inference] from the reload result; headful not tested).
- `Animation.setPlaybackRate` is a reasonable one-call way to scale all CSS/WAAPI animations, including ones
  created later. But it needs the debugger attached the whole time, with the infobar showing. The JS-side
  `playbackRate` pump does the same without the debugger.

### Gaps
- Not tested in headful Chrome, Edge or Dia. Virtual-time stickiness might differ, but the protocol offers
  no off switch.
- Not tested: `Animation.setPaused`/`seekAnimations` (CSS/WAAPI only by definition), and `Debugger.pause`,
  which freezes JS entirely including input.

## Prior art for clock takeover and the lessons that apply

### Takeaway
Every mature tool installs before page scripts: Playwright's clock in its examples, timesnap/timeweb via
`evaluateOnNewDocument` or "before any time-handling JavaScript", sinon in tests. They patch roughly the
same set of globals our clock does. None of them slows CSS by playback rate; timeweb pauses and seeks it
instead. The new piece for Snapshot is late install with a smooth rate and a jump-free hand-back, because
it attaches to a page that is already running.

### Cited Findings
- **[documented]**
  - Playwright warns: "If you call `install` at any point in your test, the call _MUST_ occur before any other
    clock related calls."
  - Its examples call `install` before `page.goto()`.
  - `runFor` "fires timers and animation frames along the way". `pauseAt`, `fastForward` ("All the timers due
    will fire once immediately"), `setFixedTime` (fixes `Date.now()`/`new Date()`, timers keep running) and
    `resume` exist.

  — [Playwright Clock](https://playwright.dev/docs/clock)
- **[source]** Playwright 1.63's clock (`playwright-core/lib/coreBundle.js`) builds fake `setTimeout…clearInterval`,
  `requestAnimationFrame` and `requestIdleCallback` on one `clock.addTimer` heap, plus fake `Date`, `Intl` and
  `performance` (`fakePerformance` with `now: () => clock.performanceNow()`). Playwright's own injected script
  keeps `utils.builtins.requestAnimationFrame`/`performance.now`, originals captured so its own polling is
  unaffected. That is the same reason our sampler captures natives before installing the clock. — [playwright-core 1.63.0 on npm](https://www.npmjs.com/package/playwright-core)
- **[documented]** @sinonjs/fake-timers fakes `setTimeout`/`setInterval`/`Date` by default, plus `performance`,
  `requestAnimationFrame`, `queueMicrotask`, `Intl`, `Temporal` and `scheduler` when available. It has
  `shouldAdvanceTime`/`advanceTimeDelta`, which are real-time-driven fake time, the same idea as `rate`.
  `runToFrame()` "Advances the clock to the next frame". — [sinonjs/fake-timers](https://github.com/sinonjs/fake-timers)
- **[documented]** timesnap uses puppeteer's `evaluateOnNewDocument` to "overwrite a page's native time-handling
  JavaScript functions", replacing Date/`Date.now`, `performance.now`, rAF, `setTimeout` and `setInterval`.
  Its README warns that pages changing through CSS "will likely not render as intended". — [tungs/timesnap](https://github.com/tungs/timesnap)
- **[documented]** timeweb overwrites `performance.now()`, `Date.now()`, `new Date()`, `Date()`, rAF/cAF and
  timers. It detects animations through `transitionstart`/`animationrun` listeners, `document.getAnimations`
  and an overwritten `Element.prototype.animate`, then pauses and seeks them. It must be included "before
  any time-handling JavaScript in the HTML file" and only moves forward (`goTo`). Listed limitations:
  iframes, `event.timeStamp`, audio analyser nodes. — [tungs/timeweb](https://github.com/tungs/timeweb)
- **[documented, via sibling notes]** Motion 13.3.0+ calls `globalThis.__MOTION_INSPECT__` with each live
  animation handle, and Motion's own Playwright test drives `animation.pause()`, `.time` and `.speed` through
  it. — [prior_art.md](prior_art.md); [motion tests/react/inspect-playback.spec.ts](https://github.com/motiondivision/motion/blob/main/tests/react/inspect-playback.spec.ts)

### Inferences
- Why Playwright and timeweb insist on installing first: anything the page creates or keeps before install
  stays real. Our flora autoplay result shows exactly this. A JS clock cannot enumerate existing native
  timers, so late install cannot take them over.
- timeweb's pause-and-seek approach to CSS is better for frame capture. For live slow motion, scaling
  `playbackRate` keeps the compositor running smoothly. Both need new animations to be caught (pump or
  events).

### Gaps
- I did not research Replay.io; nothing here comes from it.
- I found no maintained "slow motion" Chrome extension worth citing; my searches did not turn one up.

## Hands-on measurements on flora.so (late vs document start vs CDP, and restore)

### Takeaway
Late injection gets the spring exactly right: 4.0x longer at 0.25x with identical overshoot. It cannot
freeze the autoplay, which was created before injection. Document-start install gets everything right:
spring, autoplay (5 s became about 17.5 s real, as predicted), pause, step and restore. CDP knobs miss the
carousel entirely.

### Cited Findings
All measurements are **[executed]**, sampled from `translateX` on every real frame (about 60 Hz).

| Condition | Transition (real ms) | Frames | Overshoot | Autoplay | Script |
|---|---|---|---|---|---|
| Baseline 1x | 566–567 | 33–34 | 2.20–2.22 px | every 5000 ms (5.35 s, 10.35 s after load) | clock-late, clock-docstart, clock-cdp-knobs |
| Late clock, 0.25x | 2216–2217 (≈ 3.91x; the last sub-pixel tail is below detection) | 133 | 2.22 px | **unchanged, 5 s real** (native interval) | clock-late |
| Late clock, pause 7 s | frozen (1 distinct x over 418 frames) | — | — | **kept firing**; stepped move went 2 pages, overshoot 3.5–3.75 px | clock-late |
| Late clock, 0.1x, uninstall mid-transition | snapped 62 px in one frame | — | lost | — | clock-late |
| Doc-start clock, 0.25x | 2216 | 133 | 2.22 px | **17,533 ms real** between starts (predicted 0.81 s at 1x + 4.19 s / 0.25 = 17.6 s) | clock-docstart |
| Doc-start clock, pause 8 s | frozen | — | — | **none** | clock-docstart |
| Doc-start clock, 45 steps × 16.67 ms | settled at step 33 (= 550 ms virtual) | 33 changes | 2.22 px (peak −866.22 vs target −864) | none | clock-docstart |
| release() mid-transition at 0.5x | 783 (0.5x then 1x) | 47 | 2.22 px, max step 16.8 px | next one 567 ms | clock-release |
| After uninstall/release | 566–567 | 34 | 2.21–2.22 px | 5 s cadence; page clearInterval honoured | clock-docstart, clock-release |
| CDP Animation.setPlaybackRate 0.25 | 564/577 | — | 2.21–2.22 px | 5 s (CSS probe at 0.25x) | clock-cdp-knobs |
| CDP setCPUThrottlingRate 6 | 571/605 | — | 2.22 px | 5 s | clock-cdp-knobs |
| CDP setVirtualTimePolicy pause / advance | frozen / ran thousands of pages | — | — | frozen / thousands of fires | clock-cdp-knobs |

- **[executed]** The 0.25x run proves the spring obeys the virtual clock: the virtual-time durations of
  both transitions are the same, about 550 ms to rest. — `scripts/clock-late.mjs`, `scripts/clock-docstart.mjs`

### Inferences
- The task brief's "holds ~3 s at −1152px" does not match flora's current default of `interval 5`. That
  value is a dial in flora's own control panel (`[5,1.5,12,.1]`), so the brief may have been measured with
  a different setting or a partially visible card ([inference]).

### Gaps
- Headless only; I did not measure headful frame pacing or a 120 Hz display. Step size should arguably
  follow the display's frame interval rather than a fixed 16.67 ms ([inference]).

## Recommended design for Snapshot (reviewed against the measurements)

### Takeaway
Ship the virtual clock as packaged MAIN-world code with two install modes:
- **Slow motion now:** late install via `executeScript`, no reload.
- **Include timers (reloads the page):** CDP document-start install.

Drive it with a nonce-named `CustomEvent` channel from the isolated content script, scale CSS/WAAPI from
inside the clock, and always restore with `release()`: back to 1x, then uninstall when the selection is
quiet. Never use `setVirtualTimePolicy`.

### Cited Findings
- **[executed]** Every component below is implemented and measured in `scripts/clock-vclock.mjs`
  (install, `setRate`, `pause`, `step`, `release`, `uninstall`) and the experiments cited above.
- **[documented]** `func` + JSON `args` injection into `MAIN` ([scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting));
  `addScriptToEvaluateOnNewDocument` before frame scripts ([protocol JSON](https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/browser_protocol.json));
  the debugger infobar ([RHC](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code)).

### Inferences
Concrete design, in the order Snapshot would run it:

1. **Package.** Create `src/clock-main.ts`, exporting `installVirtualClock(options)` with the code of
   `scripts/clock-vclock.mjs` hardened:
   - Capture natives first.
   - Add the `playbackRate` getter/setter shim and `Temporal.Now`.
   - Auto-pause while hidden.
   - Store state in a closure; no `window.__vclock` global. The handle is reachable only through the event
     channel.
2. **Late install (default).** The background calls
   `chrome.scripting.executeScript({ target: { tabId, allFrames: true }, world: 'MAIN', func: installVirtualClock, args: [{ token, waapi: true, translateStartTime: true }] })`.
   `token = crypto.randomUUID()` is generated in the background and also sent to content.ts. The clock
   installs at rate 1, so the page sees no change at install.
3. **Channel.**
   - content.ts → MAIN: `document.dispatchEvent(new CustomEvent('vellum-clock:' + token, { detail: JSON.stringify({ cmd, value }) }))`,
     with `cmd ∈ {rate, pause, resume, step, release}`.
   - MAIN → content.ts: status (`rate`, `paused`, `lag`, `pendingTimers`) on `'vellum-clock-status:' + token`.
   - content.ts validates every field and uses it for display only.
   - Spoofing by the page is accepted as harmless; it is the page's own clock.
4. **Controls.** Dials speed 0.1–1x maps to `setRate` (re-anchored, no jump). Pause, and Step = 16.67 ms, or
   the measured display frame interval ([speculation]). They should share the speed/pause UI Snapshot already
   uses for `getAnimations()`, so JS motion and CSS/WAAPI motion move together. When late install could not
   cover timers created before it, say so in one line: "Timers that started before slow motion keep real
   time. Reload to include them." Show nothing celebratory.
5. **Include timers (opt-in, reload).** In the background:
   - `debugger.attach`, `Page.enable`, `Page.addScriptToEvaluateOnNewDocument({ source: '(' + installVirtualClock + ')(' + JSON.stringify(opts) + ')' })`.
   - `Page.reload`, wait for `Page.loadEventFired`.
   - `Page.removeScriptToEvaluateOnNewDocument`, `debugger.detach` (in `finally`, like the screenshot path).

   Then re-inject content.ts and restore Snapshot's own selection/notes state. That needs persistence (for
   example `chrome.storage.session`), because the reload drops page state. Flag the reload to the user before
   doing it.
6. **Restore.** `release({ scope: selected element, quietMs: 250, maxWaitMs: 8000 })`:
   - 1x immediately.
   - Uninstall when the scope has been quiet for 250 ms; pending timers move to native timers with their
     remaining delay; `playbackRate`s go back to the page's values; `clear*` pass-through disappears once
     takeover-era ids end.
   - If `maxWaitMs` forces it during motion, rebase Motion handles first. With the `__MOTION_INSPECT__` hook
     installed alongside the clock, record `handle.time` before uninstall and set it after. This is
     [speculation], to be validated by the inspector researcher.
   - Also release on tab hide, navigation and Snapshot close.
7. **Never** send `Emulation.setVirtualTimePolicy` to a user tab. Use `Animation.setPlaybackRate` only if the
   debugger is attached anyway.

**Clock vs `__MOTION_INSPECT__`.** Flora's motion-dom 14.1.0 has the hook (present since 13.3.0).

| | Virtual clock | `__MOTION_INSPECT__` handles |
|---|---|---|
| Coverage | Any time-based JS (Motion of any version, GSAP-like libraries if installed before them, hand-written rAF loops), timers incl. autoplay (document-start), CSS/WAAPI via `playbackRate` | Motion 13.3+ only, and only animations that start after the hook is set (a document-start hook catches all of them) |
| Autoplay timer | Slowed and paused (document-start) | Not covered: `setInterval` keeps firing and retargets the spring |
| Granularity | Whole page | Per animation (scrub `.time`, `.speed` on one value) |
| Restore | Needs `release()` to avoid the lag jump | Trivial (`speed = 1`); no global state |
| Risk | Patches globals; residue limited to function identity after document-start install | Undocumented internal hook; can change in any Motion release |

Best combination: the clock for page-wide slow motion, pause and step, plus the hook for per-animation
scrubbing and for exact rebasing on forced restore.

### Gaps
- `release()` mid-motion on a page with perpetual JS animation inside the scope always hits `maxWaitMs`.
  The rebase step for non-Motion libraries is unsolved.
- I did not test the design inside the real extension, in Dia, or against a hostile page beyond the
  event-name sniffing check.
