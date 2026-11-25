# Runtime handles into production animation libraries (Motion via React, Motion's inspector hook, GSAP, Swiper and others)

Evidence labels used throughout: **[executed]** means I ran it with Playwright (headless Chromium, 1440x900) against the live site on 2026-11-25. **[source]** means I read it in the published npm tarball or the site's shipped chunk, but did not run it. **[documented]** means it comes from vendor docs or the coordinator brief, and I did not re-check it. **[speculation]** means I have not verified it.

Proof scripts (copied into the repo; each has a header comment saying what it proves and how to run it):
- `research_notes/Previewing JavaScript animation edits/scripts/library-flora-motion-fiber.mjs`: React fiber to VisualElement, override, previews, retarget, revert.
- `research_notes/Previewing JavaScript animation edits/scripts/library-flora-motion-inspector.mjs`: the `globalThis.__MOTION_INSPECT__` hook.
- `research_notes/Previewing JavaScript animation edits/scripts/library-gsap-swiper.mjs`: GSAP on gsap.com, Swiper on swiperjs.com.

Run any of them with `node "<path>"`. They need the global `playwright` package and never run `playwright install`.

## Q1. What does flora.so ship, and how do you get from a DOM node to the live Motion VisualElement in a React production build?

### Takeaway
Two steps get you from the node to the element. Read the `__reactFiber$<random>` expando on the node, then walk `.return` to the `MotionContext.Provider` fiber whose `memoizedProps.value.visualElement.current === node`. On flora this sits one fiber above the host `<div>`. **[executed]** The same structure is in framer-motion 11.18.2, 12.23.26 and 14.14.0 **[source]**, so it is the most robust lookup across versions. If that misses, scan the hook list of the fiber whose `elementType` carries `Symbol.for('motionComponentSymbol')` for a `useRef` holding the VisualElement. Motion's own `visualElementStore` WeakMap is module-private and cannot be reached.

### Cited Findings
- **Versions [executed + source].**
  - flora ships React `19.3.0-canary-278794d7-20261002`. That is the `reconcilerVersion` string in its chunk `0uswttq3yh8ka.js`. The site is Next.js with Turbopack chunks under `/_next/static/immutable/chunks/`. — [flora.so](https://flora.so/)
  - Motion is in chunk `43t38g6et1zz8.js` ([chunk](https://flora.so/_next/static/immutable/chunks/43t38g6et1zz8.js); hashed names change on every deploy). It has no version string; MotionValue no longer embeds one.
  - The flora build contains `globalThis.__MOTION_INSPECT__` and `isTimeDefined`. Its `animateTarget` calls `n.start(...)`, not `value.run(...)`.
  - Per-version check of those features: the inspector file is absent in motion-dom 12.43.0 and 13.0.0 and present in 13.5.1, 14.0.0, 14.6.0 and 14.14.0. `value.run(` in `animateTarget` appears only in 14.14.0. Together these place flora's motion-dom at **≥13.3.0 and older than 14.14.0** (13.3.0 was released 2026-09-14). — [motion-dom 14.14.0 visual-element-target.mjs](https://unpkg.com/motion-dom@14.14.0/dist/es/animation/interfaces/visual-element-target.mjs), [motion-dom 13.5.1 same file](https://unpkg.com/motion-dom@13.5.1/dist/es/animation/interfaces/visual-element-target.mjs), [npm registry: motion-dom](https://registry.npmjs.org/motion-dom)
- **Latest versions on 2026-11-25 [source].** motion, framer-motion and motion-dom 14.14.0 (2026-11-13). react and react-dom 19.3.1 (2026-10-14). Majors: 12.x ran from 2025-01-20 to 12.43.0 (2026-07-28), 13.0.0 shipped 2026-08-05, 14.0.0 shipped 2026-10-02. — [npm: motion](https://registry.npmjs.org/motion), [npm: react-dom](https://registry.npmjs.org/react-dom)
- **Fiber keys [source].** React DOM builds the expando names from one random suffix per React copy: `__reactFiber$`, `__reactProps$` and `__reactContainer$` + `Math.random().toString(36).slice(2)`. — [react-dom 19.3.1 production client, line ~1009](https://unpkg.com/react-dom@19.3.1/cjs/react-dom-client.production.js)
- **Fiber keys on flora [executed].**
  - Every rendered node carries `__reactFiber$5q5wwlhou1y` and `__reactProps$5q5wwlhou1y`. Some also carry `__reactEvents$…`. — [flora.so](https://flora.so/)
  - `window.__REACT_DEVTOOLS_GLOBAL_HOOK__` is undefined.
  - The carousel track is `.journal-carousel .t-panel-slide > div`, a `div.absolute`. It starts with `transform: none`, then gets `translateX(-288px·n)`.
  - `locate()` started from a slide `<article>` child, climbed one DOM hop to the track, and matched at fiber depth 1 through "MotionContext.Provider value".
- **How Motion renders [source].** The motion component is `forwardRef(MotionDOMComponent)`.
  - It renders `jsxs(MotionContext.Provider, { value: context, … useRender(...) })` after `context.visualElement = useVisualElement(...)`.
  - It sets `ForwardRefMotionComponent[motionComponentSymbol] = Component`, where `motionComponentSymbol = Symbol.for("motionComponentSymbol")`. That string is also present in flora's chunk.
  - The same lines exist in framer-motion 11.18.2 and 12.23.26.
  - [framer-motion 14.14.0 motion/index.mjs](https://unpkg.com/framer-motion@14.14.0/dist/es/motion/index.mjs), [framer-motion 11.18.2 motion/index.mjs](https://unpkg.com/framer-motion@11.18.2/dist/es/motion/index.mjs), [framer-motion 14.14.0 symbol.mjs](https://unpkg.com/framer-motion@14.14.0/dist/es/motion/utils/symbol.mjs)
- **Where the element is created [source].** `useVisualElement` creates the VisualElement once and keeps it in `useRef(null)` (`visualElementRef.current`). — [framer-motion 14.14.0 use-visual-element.mjs](https://unpkg.com/framer-motion@14.14.0/dist/es/motion/utils/use-visual-element.mjs)
- **`visualElementStore` [source].** `VisualElement.mount(instance)` does `this.current = instance; visualElementStore.set(instance, this)`. The store is `const visualElementStore = new WeakMap()` inside the module and is never exported to `window`. — [motion-dom 14.14.0 VisualElement.mjs](https://unpkg.com/motion-dom@14.14.0/dist/es/render/VisualElement.mjs), [motion-dom store.mjs](https://unpkg.com/motion-dom@14.14.0/dist/es/render/store.mjs)
- **Minification [executed].** On flora's minified production build, all the property names the lookup needs survive: `memoizedProps`, `return`, `memoizedState`, `getDefaultTransition`, `animationState`, `getValue`, `latestValues` and `prevResolvedValues`. Only local variables are mangled. — [flora chunk](https://flora.so/_next/static/immutable/chunks/43t38g6et1zz8.js)

### Inferences
- Robust lookup, in order:
  1. Walk up the DOM from the selected node.
  2. For each element, get the fiber by key prefix (the suffix is random).
  3. Walk `.return` until a fiber has `memoizedProps.value.visualElement` and that element's `.current === element`. This identity check stops a non-motion child from being credited with its motion parent's context.
  4. Stop at the first fiber whose `elementType[Symbol.for('motionComponentSymbol')]` is set. Scan its hook list for `{current: VE}` as a fallback.
- Even if the expando points at a stale alternate fiber, the walk still lands on the same VisualElement. The element is created once per mount, and the context object is memoised.
- The `visualElementStore` WeakMap cannot be used from outside. A Turbopack or webpack module-registry hack might reach it [speculation], but that is build-specific and fragile.
- Q4's inspector hook gives a second route that needs no fiber: `record.options.element` is the VisualElement.

### Gaps
- I did not pin flora's exact Motion release. The feature probing bounds it to 13.3.0 or later and older than 14.14.0.
- I did not test React 17 or older, which used `__reactInternalInstance$`, or Preact, Vue Motion or Solid.
- I did not review bippy (npm 0.7.3, 2026-08-22) or react-grab's fiber utilities.

## Q2. Where is the transition read when an animation starts, and which override survives re-renders?

### Takeaway
Shadow `getDefaultTransition` on the VisualElement instance. `animateTarget()` reads that method on every start, and React re-renders never touch it, so the override is sticky; `delete ve.getDefaultTransition` reverts it exactly. **[executed]** Mutating `ve.props.transition` does not work on flora: the site passes a fresh transition literal on every render, so the mutation is lost before the next slide. **[executed]**

### Cited Findings
- **Where the transition is read [source].**
  - `VisualElement.getDefaultTransition()` returns `this.props.transition`. This holds in 11.18.2, 12.23.26, 12.43.0 and 14.14.0, and in flora's chunk.
  - `animateTarget()` does `const defaultTransition = visualElement.getDefaultTransition(); transition = transition ? resolveTransition(transition, defaultTransition) : defaultTransition; … if (transitionOverride) transition = transitionOverride;`.
  - It then calls `getValueTransition(animationTypeState?.out[key] || transition || {}, key)` for each value.
  - Under reduced motion, positional keys such as `x` get `{ type: false }`.
  - [motion-dom 14.14.0 visual-element-target.mjs](https://unpkg.com/motion-dom@14.14.0/dist/es/animation/interfaces/visual-element-target.mjs), [VisualElement.mjs](https://unpkg.com/motion-dom@14.14.0/dist/es/render/VisualElement.mjs)
- **Precedence [source].** `resolveTransition` merges with the parent transition only when the child has `inherit: true`. Otherwise a `transition` inside an `animate` or variant target wins outright over the component's `transition` prop. — [resolve-transition.mjs](https://unpkg.com/motion-dom@14.14.0/dist/es/animation/utils/resolve-transition.mjs)
- **MotionConfig [source].** The component spreads `{...useContext(MotionConfigContext), ...props}`, so MotionConfig's `transition` is only a fallback under the component's own prop. — [framer-motion motion/index.mjs](https://unpkg.com/framer-motion@14.14.0/dist/es/motion/index.mjs)
- **What a re-render does [source].** Each render runs a `useInsertionEffect` that calls `visualElement.update(props, presenceContext)` when `visualElement.props !== props`. `update()` assigns `this.props = props`. `animationState.animateChanges()` then runs in a layout or passive effect. — [use-visual-element.mjs](https://unpkg.com/framer-motion@14.14.0/dist/es/motion/utils/use-visual-element.mjs), [VisualElement.mjs](https://unpkg.com/motion-dom@14.14.0/dist/es/render/VisualElement.mjs)
- **flora's component [source].** The site's JournalCard renders:

  ```js
  motion.div {
    initial: false,
    animate: { x: -m*j + y },
    transition: b || h ? { duration: 0 }
      : { type: "spring", duration: f.motion.springDuration, bounce: f.motion.springBounce }
  }
  ```

  Here `f` comes from the DialKit hook `useDialKit("Journal carousel", { playback: { autoplay: true, interval: [5,1.5,12,.1] }, motion: { springDuration: [.55,.15,1.2,.01], springBounce: [.16,0,.55,.01], … } })`. The bundle includes `node_modules/dialkit/dist/index.js`. `h` is a reduced-motion flag, `b` is dragging, and autoplay is `setInterval(..., 1000*interval)` = 5 s, gated by `useInView(amount .45)`. — [flora chunk](https://flora.so/_next/static/immutable/chunks/43t38g6et1zz8.js)
- **What the brief says versus what I measured [executed].** The brief says the slide holds about 3 s. The autoplay starts I recorded were exactly 5.0 s apart: 6763, 11762 and 16761 ms. The read-back transition was `{type:"spring", duration:0.55, bounce:0.16}`, which confirms the earlier session's reading. — [flora.so](https://flora.so/)
- **Naive mutation is lost [executed].** I set `ve.props.transition.duration = 1.5; bounce = 0.5` and waited for the next autoplay. The animation still started with `{duration:550, bounce:0.16}`, and afterwards `ve.props.transition !== mutatedRef` was `true`. — [library-flora-motion-fiber.mjs phase B](https://flora.so/)
- **Instance override is sticky [executed].** I set `ve.getDefaultTransition = () => ({...original.call(this), type:'spring', duration:1.5, bounce:0.5})`. The next autoplay, keyboard, `useState` and replay animations all started with `{duration:1500, bounce:0.5}`. Throughout, `ve.props.transition` still read `{type:"spring",duration:0.55,bounce:0.16}`, so React kept re-applying the original while the override held. — [library-flora-motion-fiber.mjs phases C–E](https://flora.so/)
- **Revert [executed].** `delete ve.getDefaultTransition` gave `{ownGetDefaultTransition:false, sameAsProps:true}`. The next autoplay ran at `{duration:550, bounce:0.16}` again. — [phases F, H](https://flora.so/)

### Inferences
- Override points, ranked:
  1. **Instance `getDefaultTransition`.** Covers the `transition` prop, which is what flora and most code use. Zero allocation and exact revert.
  2. **Wrap `ve.update` or `ve.getProps`** to rewrite `animate.transition`, `variants[*].transition` and `whileX.transition` when inline transitions are used. Not executed. Revert by deleting the own property and calling `ve.update(lastOriginalProps)`.
  3. **`transitionOverride`** from `controls.start(def, override)` always wins and cannot be patched at the props level.
  4. **Per-value maps** (`transition: { x: {...} }`) win over a top-level patch. The patch has to be written under the same key.
- For imperative Motion animations (`animate()`, `useAnimate`) there are no props. The inspector hook (Q4) is the only parameter-level interception.
- Under the OS reduced-motion setting, Motion forces `{type:false}` on `x`, and flora also switches to `{duration:0}`. Any preview will be instant there. That matches the AGENTS.md reduced-motion gate, but Vellum should say so to the user.

### Gaps
- I did not execute the `getProps`/`update` wrapper for inline and variant transitions on a real site, because flora has none.

## Q3. Can the in-flight animation be retargeted, how do you trigger a preview on demand, and what does MotionValue expose?

### Takeaway
Three on-demand previews worked on flora, each starting within 1–6 ms. **[executed]**

1. Dispatch the carousel's own `keydown ArrowRight`.
2. Call the index `useState` hook's `queue.dispatch` from the fiber.
3. Replay through Motion with no React state change: `mv.jump(previousTarget)`, delete the key from `animationState.getState()[type].prevResolvedValues`, then call `animationState.animateChanges()`.

The same `forgetPrev` + `animateChanges()` call without the jump retargets an animation in flight. Motion drops the inherited velocity for time-defined springs (`duration`/`bounce`), which causes a visible hitch, and keeps it for physics springs (`stiffness`/`damping`). **[executed + source]**

### Cited Findings
- **Start latency per trigger [executed].** Keyboard `dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))` on `.journal-carousel`: 3–6 ms. `hook.queue.dispatch(i => i+1)` on the anonymous JournalCard component (hook 32 of 37): 5 ms. `replay('x', from)`: 1–2 ms. All three animations used the override params. — [library-flora-motion-fiber.mjs phases D, D2, E](https://flora.so/)
- **Why the replay works [source].** `animateChanges()` animates a key only when `next !== prev` against `typeState.prevResolvedValues`. Deleting the key forces it to animate. `animateTarget` skips a value already sitting at its target, so the `jump()` back is required. `initial:false` blocks only the mounting pass. — [animation-state.mjs](https://unpkg.com/motion-dom@14.14.0/dist/es/render/utils/animation-state.mjs), [visual-element-target.mjs](https://unpkg.com/motion-dom@14.14.0/dist/es/animation/interfaces/visual-element-target.mjs)
- **Retarget with a time-defined spring (G1) [executed].** I retargeted 125 ms in with `{duration:1.5, bounce:0.5}`. Motion cancelled the old animation (one `animationCancel`) and started a new one with `velocity ≈ -1490…-1760 px/s` in its options. Per-frame steps around the switch were `-30, -29, -28.5, -0.7, -2.4, -3.9` px, so the track nearly stopped and then re-accelerated.
- **Retarget with a physics spring (G2) [executed].** The same retarget with `{stiffness:120, damping:9}` gave steps of `-32, -18.4, -21.9, -21.9` px, so velocity carried over smoothly. — [phases G1/G2](https://flora.so/)
- **Why velocity drops [source].** Motion 13.5.1's spring has the comment "Time-defined springs ignore inherited velocity. Velocity from interrupted animations causes massive oscillation on small-range animations", implemented as `inheritVelocity = v => isTimeDefined ? 0 : -millisecondsToSeconds(v)`. 14.14.0 keys this on `isResolvedFromDuration`. flora's chunk contains `isTimeDefined`. — [motion-dom 13.5.1 spring.mjs](https://unpkg.com/motion-dom@13.5.1/dist/es/animation/generators/spring.mjs), [14.14.0 spring.mjs](https://unpkg.com/motion-dom@14.14.0/dist/es/animation/generators/spring.mjs)
- **The one-frame jump at a stop [source + executed].** JSAnimation's `stop()` first ticks to "now" if the value was not updated this frame. That explains the single larger step (about 52 px) at the retarget frame. — [flora chunk](https://flora.so/_next/static/immutable/chunks/43t38g6et1zz8.js)
- **MotionValue API [source].** `get`, `set`, `jump(v, endAnimation)`, `getVelocity()` (0 when the value has not changed recently), `getPrevious`, `on(event)`, `start(fn)` and `run(fn)` (14.14), `stop()` (fires `animationCancel`), `isAnimating()`, `destroy()`. — [motion-dom 14.14.0 value/index.mjs](https://unpkg.com/motion-dom@14.14.0/dist/es/value/index.mjs)
- **MotionValue events and the animation handle [executed].** `mv.on('animationStart' | 'animationComplete' | 'animationCancel')` all fired. `mv.animation` exposed `options` with `{duration:550, bounce:0.16, velocity:0, keyframes:[0,-288], ease:'easeOut'}`, with duration in milliseconds. — [phase A](https://flora.so/)
- **Values are created lazily [executed].** With `initial:false` the element has no `x` MotionValue until the first change, so `ve.values` was `{}`. `ve.getValue('x', ve.latestValues.x ?? 0)` creates it the same way `animateTarget` would. — [flora.so](https://flora.so/)

### Inferences
- Default preview for Vellum: the animationState replay. It needs no knowledge of the site's state or controls, runs Motion's real pipeline including the override, and leaves React state alone.
- Use the site's own control (keyboard, button, or `useState` dispatch) when the user wants the exact production path.
- For live slider edits during a running animation:
  - Physics springs can be retargeted smoothly.
  - Time-defined springs should restart from the current position with zero velocity, or replay from the previous rest point, to avoid the hitch.

### Gaps
- I did not test layout and projection animations (`layout`, `layoutId`), drag release (inertia), or `animationControls`.

## Q4. Motion's `globalThis.__MOTION_INSPECT__` hook (coordinator lead): does it work on flora, and which path is more robust?

### Takeaway
Yes. flora's bundle calls the hook, and it **does not need document start**: Motion reads the global on every animation start, so a late, on-demand MAIN-world install works. **[executed]**

- The record's `options` object is the live animation's options.
- Rewriting `duration`/`bounce` and calling `record.animation.initAnimation()` at start changes the spring, with results identical to the fiber path. The change persists across re-renders and reverts when you remove the hook.
- The handle supports `pause()`, `time = s`, `speed = x` and `play()`.

Use both paths. The fiber path maps a selected element to its params while idle, for React only. The hook intercepts every JS animation start, with or without React, but it is undocumented and only exists in motion-dom 13.3.0 and later.

### Cited Findings
- **Source [source].** `notifyAnimationStart(animation, options, transition)` reads `globalThis.__MOTION_INSPECT__` at call time.
  - It sends `{kind:'animation-start', animation, timestamp, frameTimestamp, frameIsProcessing, options: transition ? {...options, ...transition} : options}` inside a try/catch.
  - Its doc comment calls it a "raw firehose … without adding a public Motion API".
  - JSAnimation calls it at the end of its constructor, after `initAnimation()` and `play()`, as `notifyAnimationStart(this, this.options)`.
  - NativeAnimation passes `(this, options, transition)`.
  - [notify-inspector.mjs](https://unpkg.com/motion-dom@14.14.0/dist/es/animation/utils/notify-inspector.mjs), [JSAnimation.mjs 13.5.1](https://unpkg.com/motion-dom@13.5.1/dist/es/animation/JSAnimation.mjs)
- **Versions [source].** The hook file is present in motion-dom 13.5.1, 14.0.0, 14.6.0 and 14.14.0 and absent in 12.43.0 and 13.0.0. That is consistent with the coordinator's "13.3.0+" and changelog note "Hooks for Motion Editor", which I did not re-read. flora's chunk contains `globalThis.__MOTION_INSPECT__` in both the animation and layout paths. — [npm: motion-dom](https://registry.npmjs.org/motion-dom), [flora chunk](https://flora.so/_next/static/immutable/chunks/43t38g6et1zz8.js)
- **Late install [executed].** I installed the hook with `page.evaluate` after `networkidle` (`typeof` was `undefined` before). It fired for the next carousel autoplay.
  - The record had `name:'x'`, `type` = the spring generator function (minified `i6`), `duration:550`, `bounce:0.16` and `keyframes:[0,-288]`.
  - `options.element` was the VisualElement, with `.current` = `DIV.absolute` (the track).
  - `record.animation.options === record.options` was `true`.
  - The handle reported `time 0, speed 1, state "running", duration 0.55` (seconds).
  - `options.motionValue.animation === record.animation` was `false`: the MotionValue holds the async wrapper, not the JSAnimation.
  - [library-flora-motion-inspector.mjs I1](https://flora.so/)
- **Changing the spring through the hook [executed].** In the hook I ran `Object.assign(options, {duration:1500, bounce:0.5}); record.animation.initAnimation()`. The result was `calculatedDuration 1500`, overshoot 46.93 px and settle 1482 ms. The next slide, after another React re-render, was overridden again (46.91 px, 1482 ms). — [I2, I3](https://flora.so/)
- **Controlling the live handle [executed].**
  - `pause()` froze the animation: state `paused`, `time` held at 0.112–0.119 s across 300 ms.
  - The value caught up by one frame after the pause (about 10 px), then stayed still.
  - `time = 0.3` put the value at -1152.19, against a target of -1152.
  - `time = 0.05; speed = 0.25; play()` finished in 2000 ms of wall time, which matches (0.55 − 0.05) / 0.25 = 2.0 s.
  - [I4](https://flora.so/)
- **Revert [executed].** Removing the hook (restoring the previous descriptor) gave `present:false` and no new records. The next autoplay ran at the original spring: overshoot 2.22 px, settle 532 ms. — [I5](https://flora.so/)
- **What fires during page load [executed].** With `addInitScript` (document start), 11 records fired in the first ~8 s, starting at about 1.7–2.0 s: 5 `filter` and 5 `y` on `.twist-letter-track`, and 1 `x` on the carousel. The draggable buttons' `translate3d(...) rotate(...)` motion produced no records, so it is not Motion. — [Run 2](https://flora.so/)

### Inferences
- How the two paths compare on robustness:
  - **Inspector hook**
    - Works for vanilla `animate()`, React, Vue and anything else that uses motion-dom 13.3.0 or later.
    - Needs no React internals.
    - Gives animation → VisualElement → DOM node through `options.element.current`.
    - Catches inline-transition, variant and `transitionOverride` cases that the `getDefaultTransition` patch misses, because it edits the final merged options.
    - Risks: it is undocumented. `initAnimation` is an internal method name (unmangled on flora today). It only sees animations started after install. Spring rewrites only apply to JS animations; WAAPI-accelerated `NativeAnimation` has already handed its keyframes and easing to `element.animate`, so only `time`, `speed` and pause apply [source; NativeAnimation not executed].
    - Chain and restore any existing hook (Motion's editor tooling may own it). My installer does this with property descriptors.
  - **Fiber path**
    - Works on Motion 11 through 14 (source-checked).
    - Can read params for a selected element before anything animates, which the hook cannot.
    - Sticky by construction.
    - React only. It depends on the React expando names and Motion's `VisualElement` method names.
- Recommended flow for Vellum Snapshot:
  1. On selection, use the fiber lookup to identify the element and read its params, then show them.
  2. On edit, install both the instance `getDefaultTransition` patch and a hook filter for `options.element === ve` (the hook covers inline and variant transitions).
  3. Preview with the animationState replay.
  4. Revert by deleting the patch and restoring the hook descriptor.

### Gaps
- I did not test the hook with layout animations (`kind:'layout-animation-start'`, which carries `node`), with NativeAnimation (WAAPI), or on a non-React Motion site.

## Q5. Which React DevTools overrides exist in production builds, and what production-safe tricks remain?

### Takeaway
In production, React hands DevTools only `{bundleType:0, version, rendererPackageName, currentDispatcherRef, reconcilerVersion}`. `overrideProps`, `overrideHookState`, `scheduleUpdate` and `setSuspenseHandler` exist only in the development build. It also hands even that over only if `__REACT_DEVTOOLS_GLOBAL_HOOK__` existed when React loaded. **[source]** What remains in production is reading fibers and calling a `useState` hook's own `queue.dispatch`. That worked on flora **[executed]**, but it relies on guessing which hook is which.

### Cited Findings
- **Production build [source].** react-dom 19.3.1 production builds `internals = { bundleType: 0, version: "19.3.1", rendererPackageName: "react-dom", currentDispatcherRef: ReactSharedInternals, reconcilerVersion: "19.3.1" }`. It calls `hook.inject(internals)` only if `typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ !== "undefined"` and the hook is enabled and `supportsFiber`. That check happens when the module is evaluated. — [react-dom-client.production.js ~L18557–18576](https://unpkg.com/react-dom@19.3.1/cjs/react-dom-client.production.js)
- **Build comparison [source].** Occurrence counts in react-dom 19.3.1:

  | Method | development | production / profiling |
  |---|---|---|
  | `overrideHookState` | 4 | 0 |
  | `overrideProps` | 4 | 0 |
  | `scheduleUpdate` | 4 | 0 |
  | `setSuspenseHandler` | 4 | 0 |

  — [react-dom-client.development.js](https://unpkg.com/react-dom@19.3.1/cjs/react-dom-client.development.js), [production](https://unpkg.com/react-dom@19.3.1/cjs/react-dom-client.production.js)
- **`dispatchSetState` [source].** It is present in production (`dispatchSetStateInternal(fiber, queue, action, lane)`). A hook's `queue.dispatch` is that function bound to the fiber and queue. — [react-dom-client.production.js L5663](https://unpkg.com/react-dom@19.3.1/cjs/react-dom-client.production.js)
- **`queue.dispatch` on flora [executed].** From `.journal-carousel`'s fiber I walked to the nearest function component (anonymous, 37 hooks). The hook whose `memoizedState` equalled the current index was #32, and `queue.dispatch(i => i+1)` advanced the carousel with a normal re-render. — [library-flora-motion-fiber.mjs D2](https://flora.so/)

### Inferences
- Bippy-style DevTools hooking needs a `document_start` MAIN-world content script, registered in the manifest or with `chrome.scripting.registerContentScripts`. The on-demand activeTab injection always runs after React has loaded, so on flora the hook was absent.
- Even with the hook installed, production gives only commit notifications, not override APIs.
- Risks of `queue.dispatch`:
  - The hook is chosen by heuristic (value match or position). Dispatching the wrong queue corrupts app state.
  - It needs a real fiber still in the committed tree.
  - It cannot be reverted except by dispatching the old value.
- Prefer the Motion-level replay (Q3) for previews, and keep `dispatch` for driving the site's own state machine.
- Class components expose `stateNode.forceUpdate()`, which is public React API [documented, not executed].

### Gaps
- I did not test React Compiler-memoised components or concurrent transitions, where a dispatch may be deferred.

## Q6. Hands-on: measured effect on the flora.so carousel (before, override, after revert)

### Takeaway
The override takes visible effect and survives React re-renders. Overshoot rises from about 2.2 px to about 47 px, and settle time from about 540 ms to about 1490 ms. Reverting restores the original numbers exactly, with no reload. **[executed: three full runs, consistent to within ±0.1 px and ±15 ms]**

### Cited Findings
- Measurements per phase. The track's translateX was sampled every requestAnimationFrame (about 60 Hz, 16.7 ms per frame). Each step is 288 px. Source: [library-flora-motion-fiber.mjs](https://flora.so/) and [library-flora-motion-inspector.mjs](https://flora.so/).

  | Phase | Trigger | Options at start | Overshoot | Peak | First reach | Settle (±0.5 px) |
  |---|---|---|---|---|---|---|
  | A baseline | autoplay | 550 ms / bounce 0.16 | 2.21–2.22 px | 375–388 ms | 319–327 ms | 536–544 ms |
  | B props mutation | autoplay | 550 / 0.16 (lost) | 2.21 px | 388 ms | 321 ms | 538 ms |
  | C override | autoplay (re-render) | 1500 / 0.5 | 46.89–46.95 px | 429–444 ms | 306–317 ms | 1477–1489 ms |
  | D override | keyboard ArrowRight | 1500 / 0.5 | 46.85–46.95 px | 436–443 ms | 305–311 ms | 1478–1489 ms |
  | D2 override | `useState` dispatch | 1500 / 0.5 | 46.91 px | 440 ms | 306 ms | 1490 ms |
  | E override | animationState replay | 1500 / 0.5 | 46.85–46.95 px | 441–452 ms | 302–313 ms | 1477–1493 ms |
  | F reverted | autoplay | 550 / 0.16 | 2.21–2.22 px | 375–388 ms | 320–325 ms | 537–542 ms |
  | H reverted | keyboard | 550 / 0.16 | 2.21 px | 374–375 ms | 324–325 ms | 541–542 ms |
  | I2/I3 inspector override | autoplay | 1500 / 0.5 | 46.91–46.93 px | — | — | 1481–1482 ms |
  | I5 inspector removed | autoplay | (no record) | 2.22 px | — | — | 532 ms |

- The baseline matches the brief's "springs to -1440 overshooting ~2 px".

### Inferences
- With Motion's duration-based spring, `duration` is close to the measured settle time: 550 ms vs about 540 ms, and 1500 ms vs about 1485 ms.
- The first crossing of the target happens at about 310 ms regardless of `duration`. A UI that labels the parameter "duration" should also show settle time.

### Gaps
- Headless Chromium only. I did not test Chrome, Edge or Dia with the real extension. `executeScript({world:'MAIN', func})` with this self-contained `installVellumMotion` is expected to behave the same [speculation].
- I did not measure 2x displays or throttled CPU.

## Q7. Other libraries: is a runtime handle reachable from the DOM or `window` in production, what can change live, and how do you revert?

### Takeaway
**GSAP** is the easiest. `window.gsap` is installed even from ESM bundles. `gsap.getTweensOf(el)`, `tween.vars`/`duration()`/`timeScale()`/`invalidate()` and `gsap.globalTimeline.timeScale()` all work and revert cleanly. **[executed on gsap.com]**

**Swiper** attaches its instance as `el.swiper`, and `params.speed` changes the next slide and reverts. **[executed on swiperjs.com]**

- **anime.js v4** exposes its engine on `window.AnimeJS[i].engine` **[source]**.
- **lottie-web** sets globals only in non-CommonJS builds **[source]**.
- Embla, Keen, Splide, react-spring, Rive and Theatre attach nothing to the DOM or `window` in production, apart from Theatre's bundle marker. Reaching them needs app references, such as React fiber hooks **[source / speculation]**.

### Cited Findings
- **GSAP (source).** `gsap-core.js` registers `_globals.gsap = gsap`, pushes `window.gsapVersions` and calls `_install(_installScope || _win.GreenSockGlobals || !_win.gsap && _win || {})`. So `window.gsap` is set unless `GreenSockGlobals` or an existing `window.gsap` intervenes. npm latest is 3.15.1 (2026-11-04), and `GSDevTools.js` ships in the npm package. — [gsap 3.15.1 gsap-core.js ~L1326–1332](https://unpkg.com/gsap@3.15.1/gsap-core.js), [npm: gsap](https://registry.npmjs.org/gsap)
- **GSAP (executed on gsap.com).**
  - `window.gsap.version` is `3.15.0`. `ScrollTrigger`, `ScrollSmoother`, `CustomEase` and `MotionPathPlugin` are on `window`.
  - 273 DOM nodes carry an `_gsap` cache whose keys are `id, target, harness, get, set`. It has no back-reference to tweens, so `window.gsap` is required.
  - `globalTimeline.getChildren(true,true,true)` returned 273 children, 8 of them active. `gsap.getTweensOf(el)` contained the selected tween.
  - Editing a site tween worked: `duration(4.1→12.3)`, `vars.ease='elastic.out(1, 0.3)'` + `invalidate()`, then an exact restore of `duration(4.1)` with `ease` back to `undefined`.
  - `globalTimeline.timeScale(0.5)` stretched a fresh 0.5 s tween from 486–492 ms to 1000–1016 ms. Restoring `timeScale(1)` brought it back to 500–516 ms.
  - [gsap.com](https://gsap.com/), [library-gsap-swiper.mjs](https://gsap.com/)
- **GSAP (inconclusive).** Measuring a site tween's own `timeScale(0.25)` through `totalTime()` gave erratic rates (−3.03, 3.26 and −1.26 tween-s per wall-s), most likely because a parent timeline or ScrollTrigger drives that tween. Per-tween speed changes on parented or scrubbed tweens are not reliable; the global timescale is. — [gsap.com](https://gsap.com/)
- **Swiper (source).** `swiper-core.mjs` does `el.swiper = swiper` on init (L4109) and sets `.swiper = null` on destroy. npm latest is 14.4.0 (2026-10-30). — [swiper 14.4.0 shared/swiper-core.mjs](https://unpkg.com/swiper@14.4.0/shared/swiper-core.mjs)
- **Swiper (executed on swiperjs.com).** `document.querySelector('.swiper').swiper` returned `params.speed:300`, effect `slide`. `slideNext()` set the wrapper's `transition-duration` to `300ms`. After `params.speed = 1500` it was `1500ms`, and after restoring 300 it was `300ms` again (timing `ease`). — [swiperjs.com demo](https://swiperjs.com/demos/020-navigation/core.html)
- **anime.js 4.5.0 (source).** `core/globals.js` does `if (!win.AnimeJS) win.AnimeJS = []; win.AnimeJS.push({version:'4.5.0', engine:null})`, and `engine.js` sets `globalVersions.engine = engine`. The engine has a `speed` getter/setter (global playback rate) and an internal `_head` list of active tickables. — [anime.js globals.js](https://unpkg.com/animejs@4.5.0/dist/modules/core/globals.js), [engine.js](https://unpkg.com/animejs@4.5.0/dist/modules/engine/engine.js)
- **lottie-web 5.13.0 (source).** The UMD wrapper sets `global.lottie` only in the non-CommonJS branch, and `window.bodymovin = lottie` only when neither CommonJS nor AMD is detected. The API has `getRegisteredAnimations`, `setSpeed`, `goToAndStop` and `playSegments`. Bundled apps therefore usually have no global. — [lottie.js](https://unpkg.com/lottie-web@5.13.0/build/player/lottie.js)
- **dotLottie-web 0.83.2 (source).** The instance API includes `setSpeed`, `setFrame`, `setSegment`, `setLoop`, `freeze` and `unfreeze`. I did not establish a DOM attachment. — [dotlottie-web index.js](https://unpkg.com/@lottiefiles/dotlottie-web@0.83.2/dist/index.js)
- **Embla 8.6.0 (source).** It makes no `window` assignment. The API exposes `internalEngine()`, and the engine's `scrollBody.useDuration(n)` / `useFriction(n)` and `reInit(options)` change scroll physics. — [embla-carousel.esm.js](https://unpkg.com/embla-carousel@8.6.0/esm/embla-carousel.esm.js)
- **Keen-slider 6.8.6 and Splide 4.1.4 (source).** A grep found no `window` or DOM-expando assignment in either build. — [keen-slider.es.js](https://unpkg.com/keen-slider@6.8.6/keen-slider.es.js), [splide.cjs.js](https://unpkg.com/@splidejs/splide@4.1.4/dist/js/splide.cjs.js)
- **Theatre.js 0.7.2 (source).** `@theatre/core` registers `window.__TheatreJS_CoreBundle` so Studio can connect, and the bundle also references `__TheatreJS_StudioBundle`. — [@theatre/core dist/index.js](https://unpkg.com/@theatre/core@0.7.2/dist/index.js)
- **Rive and react-spring (source).** `@rive-app/canvas` 2.55.1's only `window` assignment is `window.miniaudio` (it has a `stateMachineInputs` API). `@react-spring/core` 10.1.2 has no globals. — [rive.js](https://unpkg.com/@rive-app/canvas@2.55.1/rive.js), [react-spring core](https://unpkg.com/@react-spring/core@10.1.2/dist/react-spring_core.modern.mjs)

### Inferences
- How to revert per library:
  - **GSAP:** snapshot `duration()`, `vars.ease` and `timeScale()`, then restore them and call `invalidate()`. Or set `globalTimeline.timeScale(1)`.
  - **Swiper:** snapshot `params.speed` and assign it back.
  - **anime.js:** `engine.speed = previous`.
- For React-wrapped libraries (react-spring `SpringRef`/`Controller`, `useEmblaCarousel`'s API, `useRive`), the instance probably lives in a `useState`/`useRef` hook on the owner fiber and can be found with the same fiber walk as Motion [speculation].
- Vellum should detect handles in this order:
  1. `window.gsap`
  2. `window.AnimeJS`
  3. `el.swiper`
  4. the Motion fiber / `__MOTION_INSPECT__`
  5. `window.lottie` / `window.bodymovin`
  6. React fiber hook scan for known instance shapes.

### Gaps
- Not executed: anime.js v4, Lottie and dotLottie, Embla, Keen, Splide, react-spring, Theatre and Rive (no time to find public production sites that ship them).
- I did not confirm on a live page whether the `dotlottie-wc` / `lottie-player` elements expose instances, or how `GSDevTools.create()` behaves when injected.
- flora's DialKit store, a module-level singleton with `panels`/`presets` and optional localStorage persistence under `dialkit:<panelId>`, is a site-specific tuning channel. It is not on `window`, and I did not find a way to reach it from outside the module.
