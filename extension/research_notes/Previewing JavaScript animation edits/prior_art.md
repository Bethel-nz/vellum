# Prior art: tools that inspect, slow down or edit JavaScript-driven animations in the browser (state as of 2026-11-25)

Scope: a survey of existing tools, the technique each uses, whether it works on production sites, licensing that would block reuse in Vellum Snapshot, and UX patterns worth borrowing. Where cheap, claims were checked by reading source code on GitHub or published npm tarballs (noted as "verified in source"). Anything older than 2024 is flagged **[possibly stale]**.

---

## 1. Motion's own tooling (Motion Studio, AI Kit / VS Code extension, Motion DevTools, debug hooks)

### Takeaway
Motion's official editor, Motion Studio (announced September 2026), works **only in development**. It needs a bundler plugin and a local companion server, and production builds leave it out. But the hook it relies on, `globalThis.__MOTION_INSPECT__`, **ships unguarded in Motion's production bundles from 13.3.0 (2026-09-14) onward**. If a page script installs that hook before Motion starts animating, it receives the live handle of every animation as it starts, and the handle can be paused, seeked (`.time`) and sped up or slowed down (`.speed`). This is the closest thing anywhere to a supported runtime hook for Motion. It is also undocumented and internal, and sites still on Motion 12.x and earlier don't have it.

### Cited Findings
**Motion Studio (timeline editor and agent)**
- Announced in "Introducing Motion Studio". The page's structured data dates it 2026-09-22. It is described as a "visual, agentic animation editor": a timeline with draggable and resizable tracks, keyframe add and remove, a transition panel with easing and spring controls, live preview "on your actual site" with play, pause and scrub, element selection to draft new animations, and an "Ultramotion" natural-language editing agent that "cannot yet create new animations". — [Motion magazine](https://motion.dev/magazine/introducing-motion-studio)
- Pricing: installing, inspecting animations and editing the local preview are free. Agentic edits and "apply to source" are paid. — [Motion magazine](https://motion.dev/magazine/introducing-motion-studio)
- Writing to code: by default, Apply copies a prompt for your coding agent. Cursor, Claude and Codex users can connect their agent so it writes the change itself. — [Motion magazine](https://motion.dev/magazine/introducing-motion-studio)
- Setup is **development-only**:
  - Vite uses the `motionStudio()` plugin. Next.js uses a `withMotionStudio` wrapper. Webpack uses a dev-only pre-loader. A companion server (`npx motion-studio serve`, port 5200) is required for Next.js, Nuxt, Astro and Webpack. The docs state "Production builds exclude Studio."
  - It needs Motion 13.3.0 or later and Node 22.13 or later.
  - It "discovers animation code that runs in the browser and previews edits live".
  - Apply "rejects stale edits if the source changed after the preview was made".
  - "Values set as code expressions appear read-only."
  - It can "preview and edit what users who request reduced motion see".
  - Supported APIs: `animate()`, `<motion.*>`, `useAnimate()`, `v-motion`, in the React, JS, Vue, Three.js and vgpu flavours.
  
  — [Motion Studio docs](https://motion.dev/docs/studio)
- Planned support listed in the announcement: CSS and WAAPI animations (planned), scroll animations and motion values (future). — [Motion magazine](https://motion.dev/magazine/introducing-motion-studio)

**Motion AI Kit / "Motion Studio" VS Code extension and MCP App (Motion+)**
- The transition editor ("Edit CSS and Motion transition using visual controls") is part of the paid **Motion+ MCP server**. It comes in two forms:
  - An **MCP App**, which an agent opens, or which you open with `/motion open the transition editor`. You click Apply and the agent implements the change.
  - A **VS Code / Open VSX extension**, where you highlight a Motion or CSS transition and "Every change updates your code instantly via AST-powered edits". The edits "preserve most formatting and respect overrides like `transition-delay`".
  
  Transitions can be saved to the cloud and shared through a Motion+ profile. In Cursor, MCP Apps are hidden behind the latest "thinking" section. — [Motion docs: studio visual controls](https://motion.dev/docs/studio-visual-controls)
- This is a source-level tool. It edits the transition literal in the editor and never touches a running production page. — [Motion docs: studio visual controls](https://motion.dev/docs/studio-visual-controls)

**Motion DevTools Chrome extension (Motion One era)** **[possibly stale]**
- "Inspect, edit and export animations made with CSS and Motion One". You press record and interact with the page, and the detected animations are plotted on a timeline. It offers scrub and replay, add, move and remove keyframes, and value and easing editing. It exports to CSS transitions, CSS animations or Motion One code. Version 2.0.0, **last updated 2023-06-08**, about 4,000 users. It does not mention framer-motion / React Motion. — [Chrome Web Store](https://chromewebstore.google.com/detail/motion-devtools/mnbliiaiiflhmnndmoidhddombbmgcdk)
- It began as an alpha in March 2022 and was Chrome-only. — [GitHub discussion](https://github.com/motiondivision/motionone/discussions/56)

**Debug hooks in the Motion library (verified in source and in npm tarballs)**
- `MotionGlobalConfig` currently has these fields: `skipAnimations`, `instantAnimations`, `useManualTiming`, `WillChange` and `mix`. It is a plain module-scoped object (`= {}`), not a `window` global. — [motion-utils/src/global-config.ts](https://github.com/motiondivision/motion/blob/main/packages/motion-utils/src/global-config.ts)
- Changelog history:
  - `MotionGlobalConfig.skipAnimations` was added "to globally disable animations when testing".
  - `instantAnimationState.current` later moved to `MotionGlobalConfig.instantAnimations`.
  - `MotionConfig` gained a `skipAnimations` option.
  - `useAnimate` now respects `skipAnimations`.
  
  — [Motion CHANGELOG](https://github.com/motiondivision/motion/blob/main/CHANGELOG.md)
- `MotionConfig skipAnimations` makes values set immediately instead of animating, which helps testing and visual-regression checks. `reducedMotion` takes "always", "never" or "user". — [Motion docs: MotionConfig](https://motion.dev/docs/react-motion-config)
- How Motion keeps time:
  - Motion's `time.now()` returns `frameData.timestamp` while a frame is processing or when `MotionGlobalConfig.useManualTiming` is set, and otherwise returns `performance.now()`. — [motion-dom/src/frameloop/sync-time.ts](https://github.com/motiondivision/motion/blob/main/packages/motion-dom/src/frameloop/sync-time.ts)
  - The frame loop **captures `requestAnimationFrame` when the module is evaluated**: `createRenderBatcher(typeof requestAnimationFrame !== "undefined" ? requestAnimationFrame : noop, …)`. — [motion-dom/src/frameloop/frame.ts](https://github.com/motiondivision/motion/blob/main/packages/motion-dom/src/frameloop/frame.ts)
- **`globalThis.__MOTION_INSPECT__`**:
  - `notifyAnimationStart(animation, options, transition)` and `notifyLayoutAnimationStart(animation, node)` call `globalThis.__MOTION_INSPECT__` if it is defined, inside a try/catch.
  - Each record contains `kind` (`"animation-start"` or `"layout-animation-start"`), the **live animation handle**, the animation's internal options merged with the transition ("timing fields in internal milliseconds, name/keyframes/element/motionValue still attached"), `timestamp`, `frameTimestamp` and `frameIsProcessing`.
  - The code comment reads: "Notify an optional inspector without adding a public Motion API… All interpretation belongs to the consumer."
  
  — [motion-dom/src/animation/utils/notify-inspector.ts](https://github.com/motiondivision/motion/blob/main/packages/motion-dom/src/animation/utils/notify-inspector.ts)
- Motion's own Playwright test shows the hook being used for control. It installs `window.__MOTION_INSPECT__` with `page.addInitScript` (before page scripts run), then calls `animation.pause(); animation.time = 5`, and `animation.time = 2; animation.speed = 2`, on a `<motion>` component's `x` transform and `opacity` animations. Both JS-driven transforms and WAAPI-backed opacity respond. — [tests/react/inspect-playback.spec.ts](https://github.com/motiondivision/motion/blob/main/tests/react/inspect-playback.spec.ts)
- Unit tests confirm that JSAnimation, NativeAnimation (WAAPI) and NativeAnimationWrapper each report once, with resolved options such as `keyframes`, `duration`, `element` and `name`. — [inspect.test.ts](https://github.com/motiondivision/motion/blob/main/packages/motion-dom/src/animation/__tests__/inspect.test.ts)
- **Production presence (verified in npm tarballs):**
  - The minified production bundle `dist/motion-dom.js` contains `globalThis.__MOTION_INSPECT__` in motion-dom 13.3.0, 13.4.5, 13.5.1, 14.0.0 and 14.14.0.
  - It is absent in 12.23.0 and 13.2.0.
  - The 13.3.0 changelog entry reads "Hooks for Motion Editor" (released 2026-09-14). The 13.4.7 entry (2026-09-30) reads "Reduced size of Motion Studio introspection call".
  - Latest versions are `motion`, `framer-motion` and `motion-dom` 14.14.0 (2026-11-13). framer-motion pins `motion-dom` exactly from 14.0.0.
  
  — [npm motion-dom](https://www.npmjs.com/package/motion-dom); [npm framer-motion](https://www.npmjs.com/package/framer-motion); [Motion CHANGELOG](https://github.com/motiondivision/motion/blob/main/CHANGELOG.md)
- The changelog header states: "Undocumented APIs should be considered internal and may change without warning." — [Motion CHANGELOG](https://github.com/motiondivision/motion/blob/main/CHANGELOG.md)
- Production bundles also expose the Framer "optimised appear" handoff globals: `window.MotionHandoffAnimation`, `window.MotionCancelOptimisedAnimation`, `window.MotionHasOptimisedAnimation` and `window.MotionCheckAppearSync`. These were verified by grepping motion-dom 14.14.0 `dist/motion-dom.js`. — [npm motion-dom](https://www.npmjs.com/package/motion-dom)

### Inferences
- Snapshot could register `__MOTION_INSPECT__` from a MAIN-world content script at `document_start`.
  - On sites running Motion 13.3.0 or later, it would get a handle per running animation. That gives pause, scrub and slow-motion (`.speed`, `.time`) without clock takeover. The records also carry the transition, e.g. `{type:"spring", duration:550, bounce:0.16}` in internal ms, which can be read and shown in DialKit.
  - The hook only fires on animation *start*, so it must be installed before the first animation. It gives no way to retarget a running spring's parameters. A new spring would have to be previewed by stopping the handle and starting a replacement (for example with the page's own Motion via `animation`/`motionValue` references in the options). Other researchers should test this.
- Because the hook is internal ("without adding a public Motion API"), the recommendation should treat it as a best-effort fast path with version detection and a fallback. It is not a contract.
- The flora.so carousel's Motion version decides whether the hook exists there. Pre-13.3 sites (likely most of the web in late 2026, since 13.3 is about ten weeks old) need clock takeover, fiber reading or CDP instead.
- Motion's own product choice is that editing happens in dev mode with source write-back. Motion has not shipped a "tweak any production site" tool. That leaves the production-inspection niche open for Snapshot, but Motion Studio is the direct competitor for local-dev users.

### Gaps
- I did not confirm whether `globalThis.__MOTION_INSPECT__` is meant to be stable, or whether Motion Studio's companion uses it exclusively. No docs page mentions it.
- I could not read the `motion-vscode` repository or confirm whether the extension source is public. The only link found was a GitHub mirror proxy.
- I did not find how the 2023 Motion DevTools extension hooked Motion One. Its listing does not say.

---

## 2. Library-specific tooling: GSAP GSDevTools, Theatre.js Studio, anime.js, react-spring, Lottie/Rive

### Takeaway
Each animation library that has a global timeline or engine also has an official in-page controller. GSAP has GSDevTools and `globalTimeline`, anime.js has `engine`, and react-spring has `Globals`. These controllers work because the library owns the clock. They only work on production pages if the library object can be reached from page script. GSAP is unusually reachable because it installs `window.gsap` and `window.gsapVersions`. Theatre.js Studio only controls animations authored in Theatre, and its AGPL licence blocks embedding it.

### Cited Findings
**GSAP / GSDevTools**
- GSDevTools gives "a visual UI for interacting with and debugging GSAP animations":
  - Scrubber, play/pause, `timeScale` control, loop, in/out markers and an animation menu. Tweens or timelines with an `id` appear in the menu.
  - A minimal mode below 600 px.
  - `globalSync`, `hideGlobalTimeline`, and `persist`, which remembers in/out points, selection, timeScale and loop across refreshes.
  - Keyboard shortcuts: Space toggles play/pause, Up/Down change timeScale, L toggles loop, I/O set the in/out points, H hides the panel.
  
  — [GSAP docs: GSDevTools](https://gsap.com/docs/v3/Plugins/GSDevTools/)
- Limits: by default it controls the global timeline. It does not work with ScrollTrigger-driven animations. The global timeline is capped at 1000 s, and only one instance listens for keyboard shortcuts. It "depends on some unique capabilities baked into the GSAP architecture". — [GSAP docs: GSDevTools](https://gsap.com/docs/v3/Plugins/GSDevTools/)
- GSAP 3.15.1 internals (verified in source):
  - On ticker `wake()`, GSAP pushes its version to `window.gsapVersions`.
  - It installs its globals onto `window` if `window.gsap` is not already set (`_install(… !_win.gsap && _win …)`).
  - It captures `requestAnimationFrame` at wake time.
  - It captures `Date.now` as `_getTime` when the module is evaluated.
  
  — [unpkg gsap/dist/gsap.js](https://unpkg.com/gsap/dist/gsap.js)
- Licence: GSAP is now free for commercial use (Webflow, April 2025), including the formerly paid plugins. But the Standard "No Charge" license lists as a **Prohibited Use** "tools that allow users to build visual animations without code that encourages, induces, or materially assists in creating a solution that competes with Webflow's visual animation building capabilities". — [GSAP Standard License](https://gsap.com/community/standard-license/); [Webflow blog](https://webflow.com/blog/gsap-becomes-free)
- The npm `gsap` 3.15.1 licence field reads "Standard 'no charge' license: https://gsap.com/standard-license". — [npm gsap](https://www.npmjs.com/package/gsap)

**Theatre.js** **[public repo possibly stale]**
- `@theatre/core` is Apache-2.0 and `@theatre/studio` is **AGPL-3.0**. Only core ships in your final bundle. Theatre.js "1.0 is coming". Development has "temporarily" moved to a private repo. No releases appear on the public GitHub page. — [GitHub theatre-js/theatre](https://github.com/theatre-js/theatre)
- Studio edits values that were declared through Theatre's own sheet and object API ("animating any other JS variable", THREE.js objects). The README does not describe controlling animations authored outside Theatre. — [GitHub theatre-js/theatre](https://github.com/theatre-js/theatre)

**anime.js v4**
- `engine` exposes the parameters `timeUnit`, `speed`, `fps`, `precision` and `pauseOnDocumentHidden`, and the methods `update()`, `pause()` and `resume()`. It is imported as an ES module (`import { engine } from 'animejs'`). Each timer, animation and timeline also has its own `playbackRate`. — [anime.js docs: engine](https://animejs.com/documentation/engine)

**react-spring**
- Tests skip animations with `Globals.assign({ skipAnimation: true })`. — [react-spring testing guide](https://react-spring.dev/guides/testing)
- The mock-raf pattern injects time with `Globals.assign({ now, performanceNow, requestAnimationFrame, cancelAnimationFrame, frameLoop: new FrameLoop() })`. — [npm @react-spring/mock-raf](https://npmjs.com/package/@react-spring/mock-raf)
- `@react-spring/rafz` exposes `raf.frameLoop = 'demand' | 'always'` and `raf.use(...)`. — [npm @react-spring/rafz](https://www.npmjs.com/package/@react-spring/rafz)
- I found no official react-spring devtools or inspector.

**Lottie / Rive**
- I found no official LottieFiles extension for inspecting Lottie on live websites. LottieFiles ships a VS Code previewer. — [LottieFiles VS Code plugin](https://lottiefiles.com/plugins/visual-studio-code)
- Third-party extensions claim to detect or extract Lottie or Rive on any page, e.g. InspectKit ("Rive, Lottie, animated SVG, CSS animation, or CSS transition"). These claims are from marketing copy and are unverified. — [Chrome Web Store: InspectKit](https://chromewebstore.google.com/detail/jbifmaklbkedmlhfmdebfnjbggijjkcm)
- I found no official Rive inspector.

### Inferences
- In production, `window.gsapVersions` is a reliable GSAP detector. react-grab uses it (see §5).
  - When `window.gsap` is reachable, `gsap.globalTimeline.timeScale(x)` gives slow motion and `.pause()`/`.seek()` give scrubbing, with no clock patching.
  - Because GSAP captures `Date.now` at module load and rAF at wake, a clock takeover installed after GSAP loads may miss it.
- GSDevTools' UX is a proven template for keyboard-first, persisted slow-motion control: timeScale via arrows, in/out loop markers, and persistence.
- Licensing:
  - **Do not bundle GSAP or GSDevTools code into Snapshot.** Snapshot lets users tweak animation timing visually, so it plausibly falls under the "visual animation building without code" Prohibited Use. Driving a page's *own* GSAP instance at runtime does not redistribute GSAP. That is an inference, not legal advice.
  - Theatre Studio (AGPL) cannot be embedded in a closed-source extension.

### Gaps
- Whether anime.js v4 exposes `engine` on `window` in UMD/CDN builds. The docs only show the ES import.
- The current maintenance status and last public release date of Theatre.js. The page showed no releases.
- Whether Lottie or Rive runtimes register any page-global registry that an extension could enumerate. Not researched in depth.

---

## 3. Browser devtools: Chrome/Edge Animations panel, Firefox, Safari, CDP

### Takeaway
Every browser's built-in animation tooling covers **CSS animations, CSS transitions and WAAPI only**. Chrome's docs say outright that "requestAnimationFrame animations are not yet supported." Chrome's controls (speed, pause, replay, scrub, drag duration and delay) work through the Animations panel and the experimental CDP `Animation` domain. These would slow Motion's WAAPI-accelerated values, but not its JS-driven springs. The only browser-level way to touch JS time is CDP `Emulation.setVirtualTimePolicy`, which is experimental and meant for headless and deterministic rendering.

### Cited Findings
- **Chrome Animations panel:**
  - Captures: CSS animations, CSS transitions, Web Animations, View Transitions. "requestAnimationFrame animations are not yet supported."
  - Controls: speed buttons, pause/resume, replay, and scrubbing by dragging the playhead.
  - Editing: drag the outer circles for duration, the inner circles for keyframe offsets, and the bar for delay. Edits are written as inline styles. Keyframe and Bezier editing aren't in this panel. The Easing Editor lives in Elements > Styles.
  - Scroll-driven animations are shown, measured in pixels.
  
  — [Chrome DevTools docs](https://developer.chrome.com/docs/devtools/css/animations)
- Edge documents the same rAF gap ("requestAnimationFrame animations are currently not supported"). — [Microsoft Edge DevTools docs](https://learn.microsoft.com/en-us/microsoft-edge/devtools/inspect-styles/animations)
- The **CDP `Animation` domain** is marked `experimental` and has these commands:
  - `setPlaybackRate`: "Playback rate for animations on page".
  - `seekAnimations`.
  - `setPaused`.
  - `setTiming`: sets an animation's duration and delay.
  
  — [devtools-protocol Animation.pdl](https://github.com/ChromeDevTools/devtools-protocol/blob/master/pdl/domains/Animation.pdl)
- CDP `Emulation` defines `experimental type VirtualTimePolicy` with the values `advance`, `pause` and `pauseIfNetworkFetchesPending`. These are used by `setVirtualTimePolicy`. — [devtools-protocol Emulation.pdl](https://github.com/ChromeDevTools/devtools-protocol/blob/master/pdl/domains/Emulation.pdl)
- **Firefox Animation inspector:**
  - Captures: CSS transitions, CSS @keyframes animations and WAAPI animations, including those on `::before` and `::after`. It does not mention rAF.
  - Controls: play/pause, restart, playback-rate dropdown and scrubber.
  - Display: bar shape reflects the easing. Each property row shows its keyframes. A lightning-bolt icon marks compositor-run animations, with a tooltip explaining why a property is not optimised.
  - Editing: the Rules view has a cubic-Bézier editor with presets.
  
  — [Firefox source docs](https://firefox-source-docs.mozilla.org/devtools-user/page_inspector/how_to/work_with_animations/index.html)
- **Safari Web Inspector:** the Graphics tab can "Preview animation keyframes and their classes from HTML5 canvas, JavaScript animations, CSS animations, and CSS transitions". — [Apple developer docs](https://developer.apple.com/documentation/safari-developer-tools/web-inspector.md)
- The Graphics tab design came from a 2019 WebKit proposal covering canvases, Web Animations, CSS Animations and CSS Transitions. **[possibly stale]** — [WebKit bug 205434](https://bugs.webkit.org/show_bug.cgi?id=205434)

### Inferences
- In Snapshot's current CSS/WAAPI control path, `document.getAnimations()` plus `playbackRate`/`currentTime` reach the same objects as DevTools. The page-level API is equivalent, so the Animations panel offers no extra reach.
- Motion runs some values (often opacity, filter and clip-path, and some transforms) as WAAPI, and those values *will* show in DevTools and in `getAnimations()`. The flora-style JS springs on `x` will not. A survey of a page should therefore split "WAAPI-backed Motion" from "JS-driven Motion".
- Using `chrome.debugger` from an MV3 extension to reach `Emulation.setVirtualTimePolicy` is the only browser-sanctioned virtual clock. It is experimental and aimed at headless use. Another researcher is covering CDP.

### Gaps
- The Chrome docs page does not list the speed button values. The 100/25/10% figures in the brief were not re-verified this session.
- I found no public Chrome or Chromium design doc or bug from 2024–2026 about adding rAF/JS animation inspection to DevTools. The docs still say "not yet supported".
- The Safari doc mentions "JavaScript animations" in the Graphics tab. I couldn't confirm what that covers (probably canvas recordings, not rAF-driven DOM tweens).

---

## 4. Clock-takeover tools: slow-motion extensions and libraries, timecut/timesnap/timeweb, Playwright clock, Replay.io

### Takeaway
Clock takeover is a mature, proven technique in deterministic capture (timeweb/timecut) and testing (Playwright clock). In those tools it is **installed before any page script runs** (init script or navigation hook). Consumer "speed hack" extensions do the same with page-world injection.

The common failure mode is order. Motion captures `requestAnimationFrame` at module evaluation, and GSAP captures `Date.now` at load and rAF at wake. A patch applied after the library loads is silently bypassed. The two "freeze" features in agent-annotation tools (§5) are installed late, so they miss Motion for exactly this reason.

### Cited Findings
- **timeweb**
  - Overrides `performance.now()`, `Date.now()`, `new Date()`, `Date()`, `requestAnimationFrame`/`cancelAnimationFrame`, `setTimeout`/`setInterval`/clears, CSS transitions and animations, SVG `<animate>`, videos, `element.animate()` and `new CustomEvent().timeStamp`.
  - It detects CSS and WAAPI animations through `transitionstart`/`animationrun` listeners, `document.getAnimations` and an overwritten `Element.prototype.animate`, then "pauses the animations and seeks when needed".
  - Limitations: iframes, `event.timeStamp`, audio analysers.
  - Licence: BSD-3-Clause.
  
  — [GitHub tungs/timeweb](https://github.com/tungs/timeweb)
- **timesnap and timecut**
  - They use timeweb and puppeteer to "overwrite its time-handling functions, and record snapshots at virtual times".
  - timeweb's `goTo` moves forward only, and rAF is called once per `goTo`.
  - Older timecut docs warned that pages where changes occur through CSS rules "will likely not render as intended". Release activity is mostly 2019–2021. **[possibly stale]**
  
  — [GitHub tungs/timecut](https://github.com/tungs/timecut); [GitHub tungs/timesnap](https://github.com/tungs/timesnap); [jsDelivr timeweb 0.3.2 README](https://cdn.jsdelivr.net/npm/timeweb@0.3.2/README.md)
- **overcrank** patches rAF, setTimeout, Date and performance.now with a virtual clock, injected through `page.addInitScript()` before navigation. — [GitHub upspawn/overcrank](https://github.com/upspawn/overcrank) (search-result description, not opened)
- **Playwright `page.clock`**
  - Overrides `Date`, `Temporal.Now`, `setTimeout`/`clearTimeout`, `setInterval`/`clearInterval`, `requestAnimationFrame`/`cancelAnimationFrame`, `requestIdleCallback`/`cancelIdleCallback`, `performance` and `Event.timeStamp`.
  - API: `install`, `pauseAt`, `fastForward`, `runFor`, `resume`, `setFixedTime`, `setSystemTime`.
  - `install` must come first, and the examples install before `page.goto()`. The docs say nothing about CSS or WAAPI.
  
  — [Playwright docs: Clock](https://playwright.dev/docs/clock)
- **Consumer extensions**
  - SpeedMaster Pro hooks `requestAnimationFrame` and time sources (`performance.now`/`Date.now`), `setTimeout`/`setInterval`, CSS/WAAPI and nested iframes. It offers 0.1×–100×, and notes that "some players and websites may limit maximum speed". — [Chrome Web Store: SpeedMaster Pro](https://chromewebstore.google.com/detail/speedmaster-pro-video-and/maadicleibigkikflpiodhjjmmlapmld)
  - "Speedy Extension" has per-function toggles. — [Chrome Web Store: Speedy](https://chromewebstore.google.com/detail/speedy-extention/iebokgnalajjenlfkfefiaknboepikip)
  - "HTML5 Universal Speed Hack" hooks "JavaScript time functions". — [Chrome Web Store](https://chromewebstore.google.com/detail/html5-universal-speed-hac/eckionmoiajpjncecfebdmmbcboblkja?hl=en-US)
  
  These claims come from listings only and are unverified.
- **"Slowmo"** is a JS library that slows CSS animations (through WAAPI playbackRate), videos, rAF, `performance.now()`, `Date.now()` and timers together in a single call. — [reactlibs.dev article](https://reactlibs.dev/articles/time-bender-slowmo) (secondary source; repo not checked)
- **Replay.io** is active in 2026 as a "time-travel debugger" (record once, inspect deterministically). It is now positioned around an MCP server that lets coding agents "time-travel through the recording", plus Replay QA (Product Hunt, 2026-07-20) and a CI Agent. It records with its own browser and is a debugging tool, not an animation editor. — [Replay docs](https://docs.replay.io/getting-started/what-is-replay-io); [Product Hunt: Replay QA](https://www.producthunt.com/products/replay-4/launches/replay-for-test-suites)
- **Library-side evidence that installation order matters:**
  - Motion captures `requestAnimationFrame` when the module is evaluated. — [motion-dom frame.ts](https://github.com/motiondivision/motion/blob/main/packages/motion-dom/src/frameloop/frame.ts)
  - GSAP captures `Date.now` at module evaluation and rAF on ticker wake. — [unpkg gsap.js](https://unpkg.com/gsap/dist/gsap.js)

### Inferences
- Snapshot's clock takeover must be a MAIN-world `document_start` content script, the same timing as Playwright's `addInitScript`.
  - It must patch `Window.prototype`-level rAF and `performance.now` before bundles evaluate.
  - Enabling it on an already-loaded page needs a reload ("Reload with slow-motion"). That is the UX cost the consumer extensions also pay.
- Motion's `time.now()` takes `frameData.timestamp` from the rAF callback argument during frames. A takeover therefore has to rewrite the *rAF timestamp argument* as well as `performance.now`, or springs will disagree with timers.
- Proven failure modes to design for:
  - Late installation, which leaves the library bypassing the patch.
  - Scaling the clock unevenly, so animations desynchronise from network and timers.
  - Max-speed caps.
  - Iframes.
  - `event.timeStamp` not being covered (timeweb).

### Gaps
- No source confirmed how SpeedMaster Pro and similar extensions behave specifically on Motion or GSAP sites. No user reports were found.
- I did not open the overcrank or Slowmo repositories to confirm their implementation or licences.

---

## 5. "Point at the page and tell the agent" tools: react-grab, Agentation, Cursor Design Mode, Onlook, Stagewise and others

### Takeaway
No surveyed agent-annotation tool edits or previews script-driven animation timing. The most they do is **freeze** the page so you can annotate a state:
- Agentation patches rAF, timers, CSS and WAAPI.
- react-grab detects and holds self-scheduling rAF loops, with GSAP-specific detection, and buffers React state updates.
- Cursor annotates over a frozen screenshot.

React context is gathered from fibers. Cursor sends "fiber-tree props", react-grab uses bippy, and both work through the React DevTools hook, which exists in production builds but loses names and source locations. Context reaches agents as clipboard markdown, MCP or a local HTTP endpoint.

### Cited Findings
**Agentation (benjitaylor/agentation)**
- An agent-agnostic visual feedback toolbar. It is a React component (`npm install agentation -D`; React 18+, desktop only). It copies markdown with selectors, positions and context, or syncs through `npx -y agentation-mcp server` and `<Agentation endpoint="http://localhost:4747" />`. — [GitHub agentation](https://github.com/benjitaylor/agentation)
- The README says "Animation pause" pauses "supported CSS animations, Web Animations, and videos". An older npm listing claimed "Freeze all animations (CSS, JS, videos)". — [GitHub agentation](https://github.com/benjitaylor/agentation); [npm agentation 3.0.2](https://www.npmjs.com/package/agentation/v/3.0.2)
- Implementation (verified in source):
  - It "Monkey-patches setTimeout, setInterval, and requestAnimationFrame so that callbacks are silently skipped while frozen". rAF and timeout callbacks are queued and replayed on unfreeze.
  - It injects `animation-play-state: paused !important; transition: none !important` CSS and pauses only *running* `document.getAnimations()` entries ("pausing finished animations would restart them on play()").
  - It pauses videos.
  - "Patches are installed when the toolbar mounts, never on import." State lives on `window.__agentation_freeze` so it survives HMR.
  
  — [freeze-animations.ts](https://github.com/benjitaylor/agentation/blob/main/package/src/utils/freeze-animations.ts)
- Licence: **PolyForm Shield 1.0.0**. npm latest is 3.1.2 (2026-09-22). — [GitHub agentation](https://github.com/benjitaylor/agentation); [npm agentation](https://www.npmjs.com/package/agentation)

**react-grab (aidenybai/react-grab)**
- Freezes rAF loops (verified in source):
  - It wraps `window.requestAnimationFrame` at module import and treats a callback as an "animation loop" once it re-schedules itself `ANIMATION_FRAME_LOOP_MIN_SELF_SCHEDULES` times. Those callbacks are held under fake negative IDs while frozen and replayed on unfreeze.
  - GSAP gets a "stack-based fallback": it checks for `"gsapVersions" in window` and `_tick` in `new Error().stack`.
  - The stated targets are "Three.js, GSAP, and hand-written requestAnimationFrame loops".
  - Its own UI calls the native rAF from `Window.prototype` to bypass the wrapper.
  
  — [freeze-animation-frame-loops.ts](https://github.com/aidenybai/react-grab/blob/main/packages/react-grab/src/utils/freeze-animation-frame-loops.ts); [native-raf.ts](https://github.com/aidenybai/react-grab/blob/main/packages/react-grab/src/utils/native-raf.ts)
- Other freeze layers:
  - Global and per-element CSS freeze, WAAPI pause and SVG pause. — [freeze-animations.ts](https://github.com/aidenybai/react-grab/blob/main/packages/react-grab/src/utils/freeze-animations.ts)
  - A React update freeze that "patches the internal dispatcher (ReactCurrentDispatcher.H or .current) to intercept and buffer useState/useReducer/useTransition/useSyncExternalStore calls while frozen… inherently fragile and coupled to React internals". It collects fiber roots "preferring bippy's tracked set but falling back to a DOM walk when the app mounted before bippy instrumented the renderers". — [freeze-updates.ts](https://github.com/aidenybai/react-grab/blob/main/packages/react-grab/src/utils/freeze-updates.ts)
- Licence: MIT (© 2025 Aiden Bai). npm `react-grab` latest is 0.2.0. — [LICENSE](https://github.com/aidenybai/react-grab/blob/main/LICENSE); [npm react-grab](https://www.npmjs.com/package/react-grab)

**bippy (the fiber access layer used by react-grab)**
- bippy installs or patches `window.__REACT_DEVTOOLS_GLOBAL_HOOK__`, which must exist before React executes. Otherwise "React will not attach its internals to the hook". — [bippy README on unpkg](https://unpkg.com/bippy@0.6.0/README.md)
- The README warns: "This project may break production apps and cause unexpected behavior." `getSource(fiber)` notes: "Production builds may omit source information". MIT, latest 0.7.3. — [bippy README (latest, unpkg)](https://unpkg.com/bippy/README.md); [npm bippy](https://www.npmjs.com/package/bippy)
- One secondary summary claims bippy's `secure` wrapper "blocks execution in production builds". This is unverified. — [bippy search summary via unpkg mirrors](https://unpkg.com/bippy@0.6.0/README.md)

**Cursor Design Mode / Visual Editor**
- Introduced 2026-06-05. You select elements, draw, or speak.
  - Each picked element adds "xpath, component, attributes, computed styles, and fiber-tree props" plus a screenshot.
  - Drawn annotations "sit over a frozen frame of the viewport".
  - The agent then finds and edits the source, and hot reload shows the result.
  - Nothing is said about editing animation timing or springs, and no live style dials are described.
  
  — [Cursor blog: Design Mode](https://cursor.com/blog/design-mode)
- Secondary sources date the browser Visual Editor to Cursor 2.2 (December 2025) and the Design Mode naming to Cursor 3 (2026-04-02). — [pasqualepillitteri.it](https://pasqualepillitteri.it/en/news/3794/cursor-design-mode-what-it-is-how-it-works-cursor-3) (secondary)

**Onlook**
- The current product is a macOS desktop app that runs the project's own dev server. Each canvas frame is a live view of a page that server serves. The open-source repo is "the earlier, browser-based version" (Next.js + Tailwind). These are local-dev, source-level tools. — [Onlook architecture docs](https://docs.onlook.com/developers/architecture); [GitHub onlook-dev/onlook](https://github.com/onlook-dev/onlook)

**Stagewise**
- Its CLI (`npx stagewise`) "proxies your running web app in dev mode and injects a toolbar with the coding agent on top". — [YC launch](https://www.ycombinator.com/launches/O3M-stagewise-the-frontend-coding-agent-for-production-codebases); [Stagewise docs](https://stagewise.io/docs/test-locally)

**Related open-source project**
- The annotate-dom roadmap calls the timer, rAF and React-state patching approach (Agentation, react-grab) "invasive and fragile". — [annotate-dom issue #18](https://github.com/FreeRikato/annotate-dom/issues/18) (secondary opinion)

### Inferences
- Both freeze implementations patch rAF *after* Motion may already have captured its reference: Agentation at toolbar mount, react-grab at its module import. Motion's frame loop would keep running in both cases unless the tool loaded first. That matches Agentation's README narrowing its claim to "supported CSS animations, Web Animations". react-grab names GSAP and Three.js but not Motion. The same gap is what Snapshot hits on flora.so.
- react-grab's self-scheduling heuristic is a reusable idea (MIT) for telling animation loops apart from one-shot layout rAFs during a global slow-motion. It only works if the wrapper is in place before the library captures rAF.
- Cursor's "fiber-tree props" confirm that the industry already ships fiber props to agents. On a production React site, a `<motion.div>`'s `transition` prop is plain data in `memoizedProps`. Another researcher is testing this.
- Licences: Agentation's PolyForm Shield forbids using it to build a competing product, so its code must not be reused. react-grab and bippy (MIT) can be studied or reused with attribution.
- None of these tools sends *motion* context (spring parameters, recorded trajectories) to the agent. Snapshot would be first there, apart from Motion Studio's prompt-copy on dev builds.

### Gaps
- I did not verify Vercel Toolbar, Builder.io Visual Copilot, LocatorJS, Polypane, VisBug or Framer this session. None was found mentioning animation timing control. LocatorJS and VisBug are known element and CSS tools, unverified here.
- I did not confirm whether react-grab or Cursor read Motion-specific props or show them specially.

---

## 6. Drop-in animation inspectors and tuning panels (script tag / npm / extension)

### Takeaway
2025–2026 drop-ins split into two groups:
- **Timeline inspectors**, which discover animations. timeline-lens walks `gsap.globalTimeline` and polls `document.getAnimations()`. It is read-only, dev-only, and also ships as an extension.
- **Tuning panels**, which own the values. DialKit and tweakit require the app's code to read values from the panel.

None of them discovers Motion/framer-motion JS animations on an arbitrary page. DialKit (MIT) has the richest UX to borrow: spring modes, a timeline dock, versions and compare, and Copy-with-instructions.

### Cited Findings
- **timeline-lens**
  - Walks `gsap.globalTimeline` recursively, using `import('gsap')` and falling back to `window.gsap`.
  - Polls `document.getAnimations()` for CSS keyframes, transitions and `element.animate()`. It catches scroll-driven `view()` timelines and replays snapshots of finished animations as "labeled reconstructions".
  - Scrubbing drives the real instances (`.seek()`/`.progress()` or `.currentTime`).
  - Panels: properties, a "best-effort reconstruction" code panel, copy, hover-to-highlight the target, and JSON export. Shortcuts: Space and Esc.
  - It is **read-only** and recommended as a devDependency with `import.meta.env.DEV` guards.
  - A Chrome Web Store extension exists. It does not mention Motion or rAF. It is small (31 commits, 6 stars), and the README links a LICENSE without naming it.
  
  — [GitHub huudi/timeline-lens](https://github.com/huudi/timeline-lens)
- **gsap-timeline-viewer (reboiedo)** is a "framework-agnostic development tool for visualizing and debugging GSAP timelines". It is a CDN drop-in (`GSAPTimelineViewer.TimelineViewer.create()`) with automatic timeline detection. — [GitHub reboiedo/gsap-timeline-viewer](https://github.com/reboiedo/gsap-timeline-viewer)
- **floscr/Gsap-Timeline-UI** targets TimelineMax. **[possibly stale]** (about 10 years old) — [GitHub floscr/Gsap-Timeline-UI](https://github.com/floscr/Gsap-Timeline-UI)
- **DialKit (joshpuckett/dialkit)**
  - "Live controls for tuning interfaces. Adjust values, compare versions, and edit animation timing in your running app." Supports React, Solid, Svelte, Vue and vanilla JS.
  - Spring config is `{ type: "spring", visualDuration, bounce }`, sharing one editor with Easing, Time and Physics modes. Easing takes duration plus a four-number `ease`.
  - The timeline dock offers scrub, zoom, move and resize clips, and edit values and curves, with `play/pause/replay/seek(seconds)`.
  - "Save version" captures a thumbnail version that can be compared. Copy puts values plus "an instruction for applying them to your config" on the clipboard.
  - Framework roots are hidden in production unless `productionEnabled`.
  - MIT, about 1.4k stars.
  
  — [GitHub joshpuckett/dialkit](https://github.com/joshpuckett/dialkit)
- **tweakit (ryankiley/tweakit, v0.7.4)** has a "Motion" control: an easing curve with duration, or a spring by duration and bounce. It outputs `duration` in ms and a CSS `easing` string, "so one transition works in both modes". It also has a spring editor with physics (stiffness, damping, mass) and time modes, a bare bézier control, and a Plot grapher. — [tweakit docs: motion](https://ryankiley.github.io/tweakit/motion.html)

### Inferences
- "Read-only, with a best-effort code reconstruction and an honest label" (timeline-lens) is a precedent for showing animations Snapshot cannot edit. "Labeled reconstructions" of finished animations is a good pattern for a recorded trajectory.
- tweakit's approach of emitting one CSS `linear()`/duration pair from either a spring or a curve is a way to preview a Motion spring change on a WAAPI clone, *if* the preview is done by substitution rather than by driving Motion.

### Gaps
- I found no drop-in inspector (2025–2026) that hooks framer-motion/Motion at runtime on arbitrary sites, other than Motion Studio's own dev plugin.
- The "inspector overlays popular on X" could not be enumerated from primary sources. The search surfaced only the GitHub projects above.

---

## 7. Technique matrix: dev-only vs production, openness, maturity, licence blockers

### Takeaway
The production-capable techniques found are:
1. Library hooks that the page exposes: Motion ≥13.3 `__MOTION_INSPECT__`, GSAP `window.gsap`, WAAPI `getAnimations()`.
2. Early clock takeover: init-script and extension speed hacks.
3. Fiber reading through the DevTools hook: react-grab/bippy and Cursor.

Everything that edits *springs* live (Motion Studio, the Motion+ VS Code extension, DialKit, Theatre) is dev-only and source-level. Licence blockers for reuse are GSAP (Prohibited Uses clause), Theatre Studio (AGPL-3.0) and Agentation (PolyForm Shield).

### Cited Findings
| Tool | Technique | Prod sites? | Open/licence | Maturity / date | Source |
|---|---|---|---|---|---|
| Motion Studio | Bundler plugin + companion server; discovers animations in browser; AST/agent write-back | No ("Production builds exclude Studio") | Proprietary; free inspect, paid apply (Motion+) | New, Sept 2026 | [docs](https://motion.dev/docs/studio) |
| Motion+ transition editor (VS Code / MCP App) | Source-level AST edits of transition literals | N/A (editor) | Paid Motion+ | 2026, VS Code editor alpha | [docs](https://motion.dev/docs/studio-visual-controls) |
| `__MOTION_INSPECT__` hook | Library hook on animation start, live handles with `.time/.speed/.pause()` | **Yes**, Motion ≥13.3.0 (verified in minified prod bundle) | MIT (Motion); undocumented internal | Sept 2026+ | [source](https://github.com/motiondivision/motion/blob/main/packages/motion-dom/src/animation/utils/notify-inspector.ts) |
| Motion DevTools (ext) | Records CSS + Motion One animations on timeline | Claimed any page, Motion One only | Proprietary | 2023 **[stale]** | [CWS](https://chromewebstore.google.com/detail/motion-devtools/mnbliiaiiflhmnndmoidhddombbmgcdk) |
| GSDevTools | GSAP `globalTimeline` control | Only if loaded in page | GSAP Standard licence (Prohibited Uses) | Mature | [docs](https://gsap.com/docs/v3/Plugins/GSDevTools/) |
| Theatre.js Studio | Own sheet/object model | Dev (core-only ships) | Studio AGPL-3.0 | Public repo dormant, private dev | [GitHub](https://github.com/theatre-js/theatre) |
| Chrome/Edge/Firefox animation tools | Native CSS/WAAPI introspection; CDP `Animation` | Yes, but CSS/WAAPI only | Built-in | Mature | [Chrome](https://developer.chrome.com/docs/devtools/css/animations), [Firefox](https://firefox-source-docs.mozilla.org/devtools-user/page_inspector/how_to/work_with_animations/index.html) |
| timeweb / timesnap / timecut | Clock override injected before page scripts | Yes (headless capture) | BSD-3-Clause (timeweb) | 2019–21 **[stale]** | [timeweb](https://github.com/tungs/timeweb) |
| Playwright clock | Init-time fake timers incl. rAF, performance | Yes (automation only) | Playwright | Mature | [docs](https://playwright.dev/docs/clock) |
| SpeedMaster Pro etc. | Page-world rAF/time/timer/WAAPI scaling | Yes (claimed) | Closed | Unknown | [CWS](https://chromewebstore.google.com/detail/speedmaster-pro-video-and/maadicleibigkikflpiodhjjmmlapmld) |
| Replay.io | Recording browser, deterministic replay, MCP for agents | Recorded sessions | Commercial | Active 2026 | [docs](https://docs.replay.io/getting-started/what-is-replay-io) |
| Agentation | Late rAF/timer patch + CSS + WAAPI pause; selectors; MCP/HTTP | Dev install (React component) | **PolyForm Shield 1.0.0** | v3.1.2, Sept 2026 | [GitHub](https://github.com/benjitaylor/agentation) |
| react-grab | rAF loop detection/hold, GSAP stack check, React dispatcher freeze, bippy fibers | Install in app; fibers work via DevTools hook | MIT | v0.2.0 | [GitHub](https://github.com/aidenybai/react-grab) |
| Cursor Design Mode | Screenshot freeze + fiber props + xpath + computed styles → agent | Cursor's browser, running app | Proprietary | June 2026 | [blog](https://cursor.com/blog/design-mode) |
| Onlook / Stagewise | Run/proxy the dev server, inject editor/toolbar | No (dev) | Onlook OSS (older web version); Stagewise | 2025–26 | [Onlook](https://docs.onlook.com/developers/architecture), [Stagewise](https://www.ycombinator.com/launches/O3M-stagewise-the-frontend-coding-agent-for-production-codebases) |
| timeline-lens | `gsap.globalTimeline` walk + `getAnimations()` poll; read-only | Dev-guarded (ext exists) | LICENSE unnamed | Small, 2025–26 | [GitHub](https://github.com/huudi/timeline-lens) |
| DialKit | App reads values from panel; timeline dock | Hidden in prod by default | MIT | ~1.4k stars, 2026 | [GitHub](https://github.com/joshpuckett/dialkit) |

### Inferences
- The only proven way to *edit a spring and see it on the real page* is a source change in development (Motion Studio, Motion+, DialKit). On production pages, prior art stops at pause, slow, scrub (WAAPI, GSAP, clock takeover, and now Motion's inspect hook) and read (fibers).
- That makes "edit a script-driven spring on a production page" new territory. Snapshot's honest default should be: preview by substitution where possible, otherwise record, annotate and hand off to the agent with the parameters read.

### Gaps
- Exact licences of timesnap, timecut and timeline-lens were not read.
- Usage numbers for SpeedMaster Pro and similar extensions were not checked.

---

## 8. UX patterns worth borrowing (spring editor, slow motion, ghost/compare, revert, "can't edit")

### Takeaway
The proven patterns:
- Springs offered as **duration + bounce**, with physics as an alternate mode.
- Slow motion as a **global timeScale on arrow keys**, with persisted in/out loops.
- **Versions/compare** rather than live ghosts.
- **Draft then apply**, where apply rejects stale source.
- Values that can't be edited shown **read-only in place**, with a reason: Motion Studio shows code-expression values read-only, and timeline-lens labels its reconstructions.

### Cited Findings
- **Spring editor**
  - DialKit uses `{type:"spring", visualDuration, bounce}` alongside Easing, Time and Physics modes. — [DialKit](https://github.com/joshpuckett/dialkit)
  - tweakit's single "Motion" control switches between curve+duration and spring duration+bounce, and has a physics mode (stiffness, damping, mass). — [tweakit](https://ryankiley.github.io/tweakit/motion.html)
  - Motion Studio puts easing and spring in a transition panel inside the timeline. — [Motion magazine](https://motion.dev/magazine/introducing-motion-studio)
  - Motion now accepts negative `bounce` (0 to −1) for overdamped springs (13.5.0), so a bounce dial should allow values below zero. — [Motion CHANGELOG](https://github.com/motiondivision/motion/blob/main/CHANGELOG.md)
- **Slow motion and scrub**
  - GSDevTools: timeScale on Up/Down, Space play/pause, I/O in/out, L loop, H hide, and `persist` across reloads. — [GSDevTools](https://gsap.com/docs/v3/Plugins/GSDevTools/)
  - Chrome: speed buttons per animation group, and a playhead that keeps playing if it was playing and stops otherwise. — [Chrome docs](https://developer.chrome.com/docs/devtools/css/animations)
  - Firefox: a playback-rate dropdown, easing-shaped bars, and a compositor badge with a "why not optimised" tooltip. — [Firefox docs](https://firefox-source-docs.mozilla.org/devtools-user/page_inspector/how_to/work_with_animations/index.html)
- **Compare / ghost**
  - DialKit "Save version" makes thumbnail versions that can be renamed, deleted and compared. — [DialKit](https://github.com/joshpuckett/dialkit)
  - None of the surveyed tools shows a live onion-skin ghost of old vs new motion. Not found.
- **Revert / apply**
  - Motion Studio edits a "local working draft" and applies to source on demand. Apply "rejects stale edits if the source changed after the preview was made". Without an agent, Apply copies a prompt to the clipboard. — [Motion Studio docs](https://motion.dev/docs/studio); [Motion magazine](https://motion.dev/magazine/introducing-motion-studio)
  - Agentation and react-grab freezes queue callbacks and replay them on unfreeze, which is a clean revert of the freeze state. — [Agentation freeze](https://github.com/benjitaylor/agentation/blob/main/package/src/utils/freeze-animations.ts); [react-grab freeze](https://github.com/aidenybai/react-grab/blob/main/packages/react-grab/src/utils/freeze-animation-frame-loops.ts)
- **Explaining what can't be edited**
  - Motion Studio: "Values set as code expressions appear read-only". — [Motion Studio docs](https://motion.dev/docs/studio)
  - timeline-lens: finished animations appear as "labeled reconstructions", and the code panel is a "best-effort reconstruction". — [timeline-lens](https://github.com/huudi/timeline-lens)
  - GSDevTools documents outright that ScrollTrigger-driven animations can't be scrubbed. — [GSDevTools](https://gsap.com/docs/v3/Plugins/GSDevTools/)
  - Chrome documents outright "requestAnimationFrame animations are not yet supported". — [Chrome docs](https://developer.chrome.com/docs/devtools/css/animations)
- **Handing off to agents**
  - Motion Studio copies a prompt or connects to Cursor, Claude or Codex. — [Motion magazine](https://motion.dev/magazine/introducing-motion-studio)
  - DialKit's Copy puts values plus an apply instruction on the clipboard. — [DialKit](https://github.com/joshpuckett/dialkit)
  - Agentation uses markdown or MCP. — [Agentation](https://github.com/benjitaylor/agentation)
  - Cursor sends element identity, fiber props and a screenshot. — [Cursor blog](https://cursor.com/blog/design-mode)
  - Replay sends recordings through MCP. — [Replay docs](https://docs.replay.io/getting-started/what-is-replay-io)
- **Reduced motion** — Motion Studio can preview and edit the reduced-motion variant. — [Motion Studio docs](https://motion.dev/docs/studio)

### Inferences
- For Snapshot's DialKit panel:
  - Show detected script-driven animations in the same list as CSS and WAAPI, with an in-place state chip: "Editable", "Slow-mo only", "Read-only: set by code" or "Needs reload to control". Give the reason and one next step, e.g. "Reload with timing control". This matches Motion Studio's read-only convention and the repo's "error in place: what + recovery" rule.
  - Borrow GSDevTools' arrow-key timeScale and persisted in/out loop for keyboard-first slow motion.
  - Borrow Motion Studio's "draft → apply with staleness check" for the agent hand-off.
  - Borrow DialKit's versions/compare instead of inventing a ghost overlay.
- The hand-off payload should mirror Motion Studio's prompt: the element, current transition (as read), proposed transition, and recording. That makes Snapshot interoperable with the agents Motion already targets.

### Gaps
- I did not find screenshots or detailed descriptions of how Motion Studio's spring panel is laid out (curve preview, units). The docs give no detail.
- I did not find any tool that shows an animated "before vs after" ghost on the live page for JS-driven motion.
