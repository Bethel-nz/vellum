# Patching a page's running JavaScript through CDP (and the network layer) to preview an animation change, then reverting it

Scope: what a Manifest V3 extension with the `debugger` permission (Vellum Snapshot) can do through the Chrome DevTools Protocol and the network layer to change JS-driven motion live, how reliable and reversible each technique is, and what it costs. Test bed: the journal carousel on https://flora.so/ (Next.js/Turbopack, Vercel). Motion moves it on the JS thread with `{type:"spring", duration:0.55, bounce:0.16}`.

Evidence labels used throughout:
- **[Executed]**: verified by running the named script on 2026-11-25 with Playwright's Chromium **158.0.8127.36**. `Browser.getVersion` reported `jsVersion 15.8.62.31` (V8) and `protocolVersion 1.3`. The scripts are in `scripts/` next to this file.
- **[Documented]**: taken from a cited primary document.
- **[Inference]**: my reasoning from the above. It has not been verified.

The measurement harness is [debugger-common.mjs](scripts/debugger-common.mjs). A MutationObserver on the track's inline `style` records each Motion render (one sample per frame). A "step" runs from the first write to the last write, plus one frame. Overshoot is the largest excursion past the final value. Every run used a 1440×900 viewport and scrolled to y=500, so the card is in view and autoplay runs.

---

## Q0. Hands-on summary: what changed the flora carousel, by how much, and did it revert?

### Takeaway
On Chromium 158 these all changed the live carousel spring and reverted cleanly with no reload, with numbers matching spring theory:
- a side-effecting conditional breakpoint
- a per-instance method override found with `Runtime.queryObjects`
- swapping Motion's module-scope generator table through `[[Scopes]]`
- Motion's own `__MOTION_INSPECT__` hook installed late

**`Debugger.setScriptSource` (LiveEdit) no longer exists.** Every call fails with `setScriptSource functionality no longer available`.

Reload-based Fetch rewriting works only with a cache-bypassing reload. Unless the fulfilled response is marked `no-store`, the patch stays in the same tab after "revert".

### Cited Findings
- **[Executed] Baseline:** each autoplay step moves the track 288 px every 5 s in **563–567 ms**, overshoots **2.20–2.22 px**, and peaks at ~347 ms after 32–34 frames. Seen on every baseline run. — [debugger-live-patch-flora.mjs](scripts/debugger-live-patch-flora.mjs)
  - The DOM has changed since the earlier observation (‑1152 → ‑1440 px). The track is now `div.absolute` inside `.journal-carousel .t-panel-slide`, with `transform: translateX(-m*288px)` and articles re-based on each step. The step size, timing and overshoot are the same.
- **[Executed] Results table** (one row per measured step; "reverted" rows are the next step after the revert):

| Technique (live unless noted) | Change applied | Measured step | Revert | Step after revert |
|---|---|---|---|---|
| Conditional breakpoint in Motion's spring generator, condition mutates options, returns `false` | bounce 0.16 → 0.5 | 541–551 ms, **46.84–46.95 px**, peak 121–132 ms, **0 `Debugger.paused` events** | `Debugger.removeBreakpoint` | 565–566 ms, 2.21–2.22 px |
| Same breakpoint via a real MV3 extension (`chrome.debugger.sendCommand`) | bounce 0.16 → 0.5 | 537–551 ms, 46.91–46.94 px | `chrome.debugger.detach` | 565–568 ms, 2.21 px |
| `Debugger.setScriptSource` (dryRun / plain / `allowTopFrameEditing`) | duration ×3 | **refused**: no change, 565 ms / 2.22 px | n/a | n/a |
| `Runtime.queryObjects` → carousel VisualElement → own-property `getDefaultTransition` override | duration 1.1 s, bounce 0.5 | **1116 ms, 46.88 px**, 67 frames | `delete ve.getDefaultTransition` | 566 ms, 2.22 px |
| `[[Scopes]]` of the spring function → generator table `nx` → swap `nx.spring` for a wrapper | duration ×3 | **1668 ms**, 2.22 px, 100 frames | put the original function back | 566 ms, 2.22 px |
| `globalThis.__MOTION_INSPECT__` defined late via `Runtime.evaluate` → `options.bounce=.3; animation.initAnimation()` | bounce 0.16 → 0.3 | 565 ms, **13.19 px**, peak 232 ms | `delete globalThis.__MOTION_INSPECT__` | 565 ms, 2.22 px |
| *(reload)* same hook via `Page.enable` + `Page.addScriptToEvaluateOnNewDocument` | bounce → 0.3 | 565 ms, 13.23 px | `removeScriptToEvaluateOnNewDocument` + reload | original |
| *(reload)* `setBreakpointByUrl`, then reload | bounce → 0.5 | 548 ms, 46.94 px (re-bound to the new scriptId) | detach the CDP client (no reload) | 2.21–2.22 px (bounce reverted) |
| *(reload)* `Fetch` Response-stage rewrite of the Motion chunk, plain reload | duration ×3 | **no interception**, 565 ms | n/a | n/a |
| *(reload)* `Fetch` rewrite with `Page.reload({ignoreCache:true})` | duration ×3 | **1664 ms**, 2.22 px | `Fetch.disable` + plain reload | **still 1665 ms (patched)** |

Sources: [debugger-live-patch-flora.mjs](scripts/debugger-live-patch-flora.mjs), [debugger-extension-probe-flora.mjs](scripts/debugger-extension-probe-flora.mjs), [debugger-scopes-generator-swap-flora.mjs](scripts/debugger-scopes-generator-swap-flora.mjs), [debugger-reload-rewrite-flora.mjs](scripts/debugger-reload-rewrite-flora.mjs), [debugger-fetch-cache-poisoning-flora.mjs](scripts/debugger-fetch-cache-poisoning-flora.mjs)
- **[Executed]** The breakpoint condition's own `console.debug` logged `"[vellum] spring opts in: 550 0.16"`. Motion's generator receives `duration` in internal milliseconds and `bounce` as authored. — [debugger-live-patch-flora.mjs](scripts/debugger-live-patch-flora.mjs)
- **[Documented]** Motion's JSAnimation hands its own `options` object to the generator factory: `generatorFactory(keyframes$1 === options.keyframes ? options : {...options, keyframes})`. Mutating it inside the generator scope therefore affects only that one animation, not React props. Source: motion-dom 14.14.0 `dist/es/animation/JSAnimation.mjs` (npm tarball, read only). — [motion-dom on npm](https://www.npmjs.com/package/motion-dom)

### Inferences
- The overshoot numbers match an underdamped spring with damping ratio ζ = 1 − bounce:
  - bounce 0.16: overshoot = exp(−πζ/√(1−ζ²)) ≈ 0.77 % of 288 px ≈ 2.2 px
  - bounce 0.3: ≈ 4.6 % ≈ 13.2 px
  - bounce 0.5: ≈ 16.3 % ≈ 46.9 px

  Each patch therefore changed the physics itself, not just the visual output. With `duration`-based springs, Motion ends at exactly `duration` (`isResolvedFromDuration` → `done = t >= duration`), which is why the ×3 and 1.1 s rows land at ~1665 ms and ~1116 ms.
- Every no-reload technique affects only the **next** animation start. The current in-flight step is untouched. For a preview, the extension should trigger or wait for the next step (flora autoplays every 5 s).

### Gaps
- Real Chrome/Edge/Dia UI was not exercised: no headed browser, infobar, or DevTools window. All runs were headless (shell for CDP scripts, new-headless full Chromium for the extension probe).

---

## Q1. Debugger.setScriptSource (V8 LiveEdit): what can it change in 2026, failure modes, revert, and can it patch a minified Motion chunk?

### Takeaway
In November 2026 it can change nothing. Live edit was deprecated in Chrome 142, removed in Chrome 145 (February 2026), and removed from V8 itself. The protocol method is now marked deprecated and "always fails".

On Chromium 158 every variant was refused with the same message: flora chunk, synthetic page, `dryRun`, `allowTopFrameEditing`, `--js-flags=--inspector-live-edit`, and calls through `chrome.debugger`. Vellum should not build on it.

### Cited Findings
- **[Executed]** On flora's Motion chunk, `Debugger.setScriptSource` with `dryRun:true`, with no flags, and with `allowTopFrameEditing:true` all returned: `Protocol error (Debugger.setScriptSource): setScriptSource functionality no longer available`. A later `Debugger.getScriptSource` still returned the original text, and the next step was unchanged (565 ms / 2.22 px). — [debugger-live-patch-flora.mjs](scripts/debugger-live-patch-flora.mjs)
- **[Executed]** Through a real MV3 extension, `chrome.debugger.sendCommand(…'Debugger.setScriptSource'…)` rejected with `{"code":-32000,"message":"setScriptSource functionality no longer available"}`. — [debugger-extension-probe-flora.mjs](scripts/debugger-extension-probe-flora.mjs)
- **[Executed]** On a trivial synthetic classic script (`//# sourceURL=hot.js`), the same error came back, both with default flags and with `--js-flags=--inspector-live-edit`, so the old V8 flag does not bring it back. — [debugger-breakpoint-cost-and-clients.mjs](scripts/debugger-breakpoint-cost-and-clients.mjs)
- **[Executed]** The error string `setScriptSource functionality no longer available` is present in both the Playwright-downloaded `chrome-headless-shell` 158 binary and the sandbox's own build. This is upstream behaviour, not a test-harness artifact. (Checked with `grep -a` on the binaries.)
- **[Documented]** Chrome deprecated "live editing of JavaScript sources" on 2025-10-22. It moved behind `chrome://flags/#devtools-live-edit` in Chrome 142 and was scheduled for complete removal in Chrome 145 (February 2026). The reasons given were "high maintenance cost and low usage", a confusing UX, HMR covering the use case, and unsupported scenarios such as "editing async functions, generators, or top-level ES module code". Local Overrides, Workspaces and Snippets stay. — [Chrome for Developers blog](https://developer.chrome.com/blog/devtools-deprecates-live-editing)
- **[Documented]** V8/Node: "Support for live editing via the inspector has been fully removed. `Debugger.setScriptSource` now always fails with 'setScriptSource functionality no longer available'… previously… behind the `--inspector-live-edit` flag." That flag is listed as removed. The V8 change is chromium-review v8/v8 CL 8238091. — [Node.js: Notable V8 changes from Node.js 26 to 27](https://nodejs.org/en/blog/announcements/notable-v8-changes-from-node-js-26-to-27-alpha)
- **[Documented]** The current protocol definition (devtools-protocol 0.0.1752859, published 2026-11-24) marks `Debugger.setScriptSource` as **deprecated**: "Live edit is no longer supported and this command always fails with a 'no longer available' error."
  - The historic return `status` enum is still listed: `Ok`, `CompileError`, `BlockedByActiveGenerator`, `BlockedByActiveFunction`, `BlockedByTopLevelEsModuleChange`.
  - So is the experimental `allowTopFrameEditing` param: "allowed to change the function on top of the stack as long as the top-most stack frame is the only activation of that function".
  - `scriptParsed.isLiveEdit` is still defined.

  — [devtools-protocol npm package, json/js_protocol.json](https://www.npmjs.com/package/devtools-protocol)

### Inferences
- Historically (Chrome ≤141) LiveEdit refused these cases, per the status enum and the blog:
  - edits to functions with an active generator or async activation
  - functions on the stack (except the top frame with `allowTopFrameEditing`)
  - top-level ES-module changes

  Revert was "set the original source again". Patching flora's spring generator would have qualified, since it is not on the stack between animation starts. None of this matters now.
- `Runtime.queryObjects`/`[[Scopes]]` plus plain property assignment (Q3) is the practical replacement. It can swap any function reachable through an object or a module-closure variable that the code looks up at call time (flora: `nx.spring`, or instance methods such as `getDefaultTransition`). It cannot change code inlined into another function body, which is what LiveEdit could do.

### Gaps
- Whether an already-created closure picked up LiveEdit code, and how context-layout changes behaved, could not be tested. The feature is gone in the only available build, and I did not find a 2026 primary source describing those semantics.
- Whether any Chromium fork (Dia, Arc, Edge) re-enabled LiveEdit is unknown. All of them track upstream V8, so it is very unlikely [Inference].

---

## Q2. Breakpoint injection: can a side-effecting `condition` rewrite spring options without pausing? Cost on hot paths, minified code, column breakpoints

### Takeaway
Yes. This is the most surgical and most reversible live technique.

`Debugger.setBreakpointByUrl` with a `columnNumber` inside the minified spring generator, plus a condition of the form `(mutate(locals), false)`, rewrote `bounce` on the next animation and never paused. Removing it, or simply detaching the client, reverts. The breakpoint is URL-scoped, so it also re-binds after a reload.

The cost is high per hit (~0.14–0.25 ms), which is fine for once-per-animation functions and ruinous for per-frame inner loops.

### Cited Findings
- **[Executed]** The breakpoint was set at the first statement of `function i6(e=.3,t=.3){…}`: `line 0, column 84447`, in the 315,829-char one-line chunk `…/chunks/43t38g6et1zz8.js`.
  - V8 resolved it to `{"lineNumber":0,"columnNumber":84451}`. `Debugger.getPossibleBreakpoints` listed 84451, 84453, 84455 as the first breakable spots.
  - Returned id: `br:1:0:84447:https://flora.so/_next/static/immutable/chunks/43t38g6et1zz8.js`.
  - Condition used: `(e&&"object"==typeof e&&.16===e.bounce&&(console.debug(...),e.bounce=.5),false)`. Result: 46.8–46.9 px overshoot and 0 pauses.

  — [debugger-live-patch-flora.mjs](scripts/debugger-live-patch-flora.mjs)
- **[Executed]** The condition can read the function's parameters (`e`) at a column breakpoint in minified code. Default-parameter initialisers had already run at the first body location. — same script
- **[Executed]** A URL breakpoint survives reload: after `page.reload()` a `Debugger.breakpointResolved` event re-bound it to the new script (`scriptId` 124 → 165, same column), and the first step after reload measured 548 ms / 46.94 px. — [debugger-reload-rewrite-flora.mjs](scripts/debugger-reload-rewrite-flora.mjs)
- **[Executed] Cost on a hot function** (synthetic `hot(o)` called in a loop):

| State | Cost per call |
|---|---|
| No Debugger domain | 0.8 ns |
| `Debugger.enable` only | 0.6 ns |
| Breakpoint, condition `false` | **138,888 ns** |
| Breakpoint, condition mutates two properties | **250,570 ns** |
| After `removeBreakpoint` | 6.2 ns (the function stays de-optimised for a while) |
| After `Debugger.disable` | 6.0 ns |

  — [debugger-breakpoint-cost-and-clients.mjs](scripts/debugger-breakpoint-cost-and-clients.mjs)
- **[Documented]** `setBreakpointByUrl` "will survive page reloads". The `condition` is an "Expression to use as a breakpoint condition. When specified, debugger will only stop on the breakpoint if this expression evaluates to true". The method takes `url`, `urlRegex` or `scriptHash`. — [devtools-protocol js_protocol.json](https://www.npmjs.com/package/devtools-protocol)

### Inferences
- Target functions that run once per animation start: the spring generator `i6`, `animateMotionValue`, `getDefaultTransition`. Never target the generator's `next(t)` (once per frame per animation) or the frameloop. At ~0.14–0.25 ms per hit, 100 hits/frame would cost a 16 ms frame budget by themselves.
- Use `urlRegex` matching the chunk name or, better, `scriptHash` (`scriptParsed.hash`, SHA-256) to pin the exact build. Next.js content-hashes chunk URLs, so a redeploy changes the URL and the breakpoint silently stops binding.
- A condition that throws behaves unpredictably across versions, so guard every access (`e&&typeof e==='object'&&…`). Return `false` explicitly.
- While a breakpoint is active, `Debugger.enable` must stay on and the client attached. That means the "started debugging" infobar stays visible for the whole preview (Q6).

### Gaps
- Behaviour when a condition throws was not tested.
- Cost was measured on a tight synthetic loop only. A per-frame Motion callback under a breakpoint was not profiled on flora.

---

## Q3. Heap discovery: Runtime.queryObjects / getProperties / callFunctionOn to find and mutate Motion instances without React

### Takeaway
It works well and needs no breakpoint and no pause:
1. `queryObjects(Function.prototype)` lists every function (7,047 on flora in ~108 ms).
2. Fingerprinting their source finds Motion's minified classes.
3. `queryObjects(Class.prototype)` lists the live instances (~90 ms each).
4. `callFunctionOn` mutates them.

Two mutation styles changed the carousel and reverted:
- an own-property override of `getDefaultTransition` on the carousel's VisualElement
- swapping `spring` in Motion's generator table, reached through `Runtime.getProperties` → `[[Scopes]]`

Unlike breakpoints, these mutations persist after detach, so revert must be explicit.

### Cited Findings
- **[Executed]** `Runtime.queryObjects({prototypeObjectId: Function.prototype})` returned **7,047 functions in 108 ms**. Filtering with `Function.prototype.toString` fingerprints found:
  - **VisualElement** = minified `class tC{scrapeMotionValuesFromProps…}`: **9 live instances** (queryObjects 91 ms)
  - **MotionValue** = `class td{constructor(e,t={}){this.canTrackVelocity=null…}`: **16 instances** (92 ms)
  - **JSAnimation** = `class nP extends e4{… this.state="idle"…}`: **5 live instances** (89 ms)

  — [debugger-live-patch-flora.mjs](scripts/debugger-live-patch-flora.mjs)
- **[Executed]** The carousel's VisualElement was found by `v.current === document.querySelector(track)`. It read back as `ctor "t4"`, `props.transition {"type":"spring","duration":0.55,"bounce":0.16}`, `animate {"x":-1440}`, `values ["x"]`. That is the authored transition, recovered from the heap without React fibers. — same script
- **[Executed]** Setting an own property `ve.getDefaultTransition = function(){ … {...t, duration:1.1, bounce:.5} }` produced a **1116 ms / 46.88 px** step. `delete` restored 566 ms / 2.22 px. — same script
  - **[Documented]** This works because Motion's `animateTarget` calls `visualElement.getDefaultTransition()` when the target has no own transition, and `VisualElement.getDefaultTransition()` returns `this.props.transition`. Seen in flora's bundle as `l=e.getDefaultTransition()` and in motion-dom `render/VisualElement.mjs` and `animation/interfaces/visual-element-target.mjs`. — [motion-dom on npm](https://www.npmjs.com/package/motion-dom)
- **[Executed]** `Runtime.getProperties(springFn)` exposes the internal property `[[Scopes]]` = `Closure | Global`. The Closure scope of the bundle's merged Motion module held **555 variables**, among them the generator table `nx = {decay, inertia, tween, keyframes, spring}`.
  - Replacing `nx.spring` with a wrapper (`duration×3` when bounce is 0.16, keeping `applyToOptions`) gave **1668 ms**.
  - Restoring the original function gave 566 ms.

  — [debugger-scopes-generator-swap-flora.mjs](scripts/debugger-scopes-generator-swap-flora.mjs)
  - **[Documented]** JSAnimation resolves `options.type` through that table on every `initAnimation()` (`replaceTransitionType`), so a swap affects every later spring on the page. — motion-dom `animation/utils/replace-transition-type.mjs`, `JSAnimation.mjs` ([npm](https://www.npmjs.com/package/motion-dom))
- **[Executed]** A heap mutation made by one CDP client persists after that client detaches (`window.heapPatchedByA` still `true`). — [debugger-breakpoint-cost-and-clients.mjs](scripts/debugger-breakpoint-cost-and-clients.mjs)
- **[Documented]** `Runtime.queryObjects(prototypeObjectId, objectGroup)` "returns objects"; release them with `Runtime.releaseObjectGroup`. `Runtime.evaluate` has `includeCommandLineAPI`, and an experimental `allowUnsafeEvalBlockedByCSP` that "bypasses CSP… Defaults to true". — [devtools-protocol js_protocol.json](https://www.npmjs.com/package/devtools-protocol)

### Inferences
- The instance-override route needs no source rewriting and no Debugger domain (only Runtime). It is per element, so it can preview one carousel without touching others. It is the best live fit for "change this element's transition".
- The generator-table swap is page-wide (every spring). Use it to reproduce "what if the spring itself changed", and filter inside the wrapper by `options.element`/`name`.
- Fingerprints should rely on property names that survive minification (`canTrackVelocity`, `scrapeMotionValuesFromProps`, `getDefaultTransition`, `isResolvedFromDuration`, `keyframes:[0,1],bounce:`), never on minified identifiers (`i6`, `tC`, `nx` change every build).
- Because heap patches outlive detach, Vellum must keep an undo record (original function or property descriptor) and also revert on `chrome.debugger.onDetach` / tab navigation. If the extension is killed, the patch lives until reload. That is acceptable for a preview, but should be stated in the UI.

### Gaps
- `queryObjects` appears to trigger a GC first (≈90 ms per call here). This was not measured on heavy pages.
- GSAP tweens and other libraries were not tested in this pass. Another researcher covers library hooks.

---

## Q4. Locating the right code: scriptParsed + getScriptSource fingerprints, source maps, mapping back to the site's original source

### Takeaway
`Debugger.enable` replays `scriptParsed` for every live script. Fetching and grepping the large ones for Motion fingerprints found the spring generator in ~0.36 s.

Flora ships **no source maps**: no `sourceMappingURL`, and `.map` returns 403. The authored values are still recoverable verbatim from the chunk, because the carousel component lives in the same bundle and passes its parameters through a production-bundled DialKit hook: `springDuration:[.55,…]`, `springBounce:[.16,…]`, `"Journal carousel"`. Those give a coding agent exact grep keys for the real repo.

### Cited Findings
- **[Executed]** After `Debugger.enable`, 26–36 scripts were reported, depending on load timing. Of the large ones, only `43t38g6et1zz8.js` (315,829 chars) contained all of `restDelta`(8) `restSpeed`(10) `visualDuration`(34) `isResolvedFromDuration`(3). Discovery plus fetch took 362–368 ms. — [debugger-live-patch-flora.mjs](scripts/debugger-live-patch-flora.mjs)
- **[Executed]** `scriptParsed.sourceMapURL` was empty for every flora chunk. `GET …/43t38g6et1zz8.js.map` → **HTTP 403**. The chunk is served `cache-control: public,max-age=31536000,immutable` by Vercel. — [debugger-reload-rewrite-flora.mjs](scripts/debugger-reload-rewrite-flora.mjs) and a curl check (see the scratch log)
- **[Executed]** The carousel source in the same chunk (export `JournalCard`) contains:
  - `(0,i.S)("Journal carousel",{playback:{autoplay:!0,interval:[5,1.5,12,.1]},motion:{dragThreshold:[48,8,180,1],springDuration:[.55,.15,1.2,.01],springBounce:[.16,0,.55,.01]},layout:{…}})`
  - and the motion element `n.f.div` with `animate:{x:-m*j+y}`, `transition:b||h?{duration:0}:{type:"spring",duration:f.motion.springDuration,bounce:f.motion.springBounce}`.

  `i.S` is exported from the merged Motion module as `function(e,t,i){return oo(e,t,i).values}`. Its implementation registers a panel in a store (`os.registerPanel`, `useSyncExternalStore`), and the chunk contains 259 `dialkit` CSS-class strings. — scratch extraction from `43t38g6et1zz8.js` (reproduce with `findSpring()` in [debugger-common.mjs](scripts/debugger-common.mjs) and a grep)
- **[Executed]** Flora's Motion version, inferred from a feature diff because no version string is shipped: the bundle has `isTimeDefined`, `delayState`, `manualStartTime` and `__MOTION_INSPECT__`.
  - motion-dom 13.3.0 has the hook but not `isTimeDefined`.
  - 14.0.0 through 14.14.0 (latest, 2026-11-13) have all of them.

  So flora ships **motion-dom ≥ 14.0**. — npm tarballs of motion-dom 13.3.0, 14.0.0, 14.5.0, 14.9.0, 14.12.0, 14.13.0, 14.14.0 ([npm](https://www.npmjs.com/package/motion-dom))
- **[Documented]** motion-dom 14.14.0 maps the minified functions as follows:
  - `i6` = `springGenerator` (`animation/generators/spring.mjs`)
  - `nP` = `JSAnimation`
  - `nF` = `animateTarget`, `tC` = `VisualElement`, `td` = `MotionValue`
  - `e7` = `notifyAnimationStart` (`animation/utils/notify-inspector.mjs`)

  — [motion-dom on npm](https://www.npmjs.com/package/motion-dom)

### Inferences
- Mapping runtime → repo with no source maps: grep the chunk around the live VisualElement's `props.transition` (Q3) for the literal values or the hook label, then hand the agent the strings (`"Journal carousel"`, `springDuration`, `springBounce`). These survive minification because they are string keys. The authored file is not identifiable from the bundle; Turbopack module ids (e.g. 30993) are not paths.
- When a site does publish maps, `scriptParsed.sourceMapURL` plus fetching the map (with `Network.loadNetworkResource`, or a plain fetch from the extension, which needs host permission) would give file:line. Flora does not, so the fingerprint route is the baseline.
- DialKit in production is site-specific. Its store (`os.updateValue`) is a fourth live route on flora, re-rendering with new values. It is not general, and another researcher covers the React/hook path.

### Gaps
- Whether Vercel's 403 means "no map built" or "map blocked" was not determined.
- The authored file path in flora's repo is unknown.

---

## Q5. Reload-based rewriting: Fetch fulfil, addScriptToEvaluateOnNewDocument, declarativeNetRequest; SRI, caching, service workers, chunk hashing; revert

### Takeaway
All three need a reload, and each has a trap:
- **Fetch Response-stage rewrite** works only if the reload bypasses the cache. The immutable chunk is otherwise never paused. The patched body then sticks in the tab's cache after `Fetch.disable`, unless you fulfil with `cache-control: no-store` or revert with a hard reload.
- **`Page.addScriptToEvaluateOnNewDocument`** silently does nothing unless `Page.enable` is on for that session.
- **declarativeNetRequest** cannot modify bodies. It can only redirect to a packaged static file or another URL, which needs host permissions and does not fit per-preview patches.

Flora has no SRI, no service worker and no CSP, so none of those blocked the rewrite there.

### Cited Findings
- **[Executed]** Flora facts: 0 `script[integrity]`/`link[integrity]`; no `navigator.serviceWorker.controller`; no CSP header or meta. The Motion chunk loads as a plain `<script async>` with no `crossorigin`. — [debugger-reload-rewrite-flora.mjs](scripts/debugger-reload-rewrite-flora.mjs)
- **[Executed]** `Fetch.enable({patterns:[{urlPattern:'*', requestStage:'Response'}]})` with a plain reload paused 41 requests, **not including the Motion chunk**. With `Network.setCacheDisabled(true)` it paused 61, chunk included. With `Page.reload({ignoreCache:true})` it paused 55, chunk included. — scratch diagnostic (`08-diag.mjs`), reproduced in [debugger-reload-rewrite-flora.mjs](scripts/debugger-reload-rewrite-flora.mjs) (plain reload: `intercepted []`, step unchanged)
- **[Executed]** `Fetch.getResponseBody` → patch → `Fetch.fulfillRequest` (dropping `content-length`/`content-encoding`) with an `ignoreCache` reload produced a **1664 ms** step (×3). Reload took ~1.0–1.3 s headless with a warm cache. — same script
- **[Executed] Cache persistence of the patched body.** Fulfilling with the original headers (`immutable, max-age=31536000`), then `Fetch.disable`:
  - plain reload → **still patched (1665 ms)**
  - new tab in the same profile → original (564 ms)
  - `Page.reload({ignoreCache:true})` → original

  Fulfilling with `cache-control: no-store` instead made a plain reload revert (564 ms). — [debugger-fetch-cache-poisoning-flora.mjs](scripts/debugger-fetch-cache-poisoning-flora.mjs)
- **[Executed]** `Page.addScriptToEvaluateOnNewDocument` on a CDP session without `Page.enable` did not run after reload (`typeof __MOTION_INSPECT__` → `undefined`). After `Page.enable` it ran (`function`), and the hook saw the first animations. Logged calls:
  - `["animation-start","filter",null,600,"nM"]` (NativeAnimation/WAAPI)
  - `["animation-start","y",null,600,"nP"]`
  - `["animation-start","x",0.16,550,"nP"]` (the carousel spring, JS-driven)

  With the bounce-0.3 hook the step was 565 ms / 13.23 px. `removeScriptToEvaluateOnNewDocument` + reload reverted. — scratch `09-diag2.mjs`; [debugger-reload-rewrite-flora.mjs](scripts/debugger-reload-rewrite-flora.mjs)
- **[Documented]** `fulfillRequest.body`: "If absent, original response body will be used if the request is intercepted at the response stage". `Page.addScriptToEvaluateOnNewDocument` "Evaluates given script in every frame upon creation (before loading frame's scripts)", with experimental `worldName` and `runImmediately` ("runs the script immediately on existing execution contexts"). `Page.reload.ignoreCache`: "as if the user pressed Shift+refresh". — [devtools-protocol browser_protocol.json](https://www.npmjs.com/package/devtools-protocol)
- **[Documented] declarativeNetRequest:**
  - Redirect targets are `extensionPath` ("Path relative to the extension directory"), `url` ("Redirects to JavaScript urls are not allowed"), `regexSubstitution`, and `transform` (scheme limited to http/https/ftp/chrome-extension).
  - "A declarativeNetRequest rule cannot redirect from a public resource request to a resource that is not web accessible".
  - Redirects need host permission for the matched host.
  - Rules apply "only… to requests that reach the network stack. This includes responses from the HTTP cache", not service-worker `onfetch` responses.
  - The API works "without intercepting them and viewing their content", so there is no body modification.

  — [chrome.declarativeNetRequest](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest)

### Inferences
- SRI would break a Fetch body rewrite (the hash would no longer match) unless the `integrity` attribute is also stripped, e.g. by rewriting the HTML document response, which is more invasive. A service worker serving from CacheStorage would bypass both Fetch-at-network and DNR for those requests (Fetch can still intercept the SW's own fetches). Neither applies on flora, but both are common on PWAs.
- Next.js chunk hashing helps: the URL is stable for a deploy, so a URL breakpoint or a Fetch pattern keeps matching across reloads. It changes on redeploy, so the patch needs re-locating by fingerprint, not by URL.
- Recommended reload recipe if one is ever needed:
  1. `Fetch.enable` with a narrow pattern
  2. `Page.reload({ignoreCache:true})`
  3. fulfil with `cache-control: no-store`
  4. revert with `Fetch.disable` + another `ignoreCache` reload

  The live techniques (Q2/Q3) avoid this entirely and keep page state such as scroll, open menus and carousel index.
- DNR could only swap a chunk for a pre-packaged file, which is useless for arbitrary previews. A remote URL serving generated JS would also be remote-hosted code outside the Debugger-API exemption (Q6).

### Gaps
- Exactly which cache layer kept the patched body (Blink memory cache in the renderer vs. disk cache) is inferred from "same tab patched, new tab original", not proven.
- Behaviour with SRI, service workers and CSP was not tested live (flora has none).

---

## Q6. UX and platform costs: infobar, coexistence with DevTools/other clients, Dia/Edge/Arc, Web Store review, MV3 remote-code rule; and the `__MOTION_INSPECT__` alternative

### Takeaway
Every CDP technique carries a Chrome-drawn `"<extension>" started debugging this browser` infobar for as long as the extension stays attached, and live patches (breakpoints) require staying attached.

- **Multiple CDP clients coexist.** Playwright plus the extension, or two sessions, each with their own breakpoints. Detaching removes only that client's breakpoints, which makes detach a free revert for breakpoints but not for heap patches.
- **The same extension cannot attach twice** to one tab.
- **Platforms:** Edge documents `chrome.debugger` support. No Dia- or Arc-specific documentation was found.
- **Policy:** the MV3 policy exempts code run "through" the Debugger API.

Coordinator lead: on Motion ≥ 13.3 (flora is ≥ 14.0) a **late** `globalThis.__MOTION_INSPECT__` defined with `Runtime.evaluate` is picked up on the next animation start and can re-run `initAnimation()` with new options. That is a no-reload alternative to breakpoints and setScriptSource for Motion sites, and it needs only Runtime (or even a MAIN-world script).

### Cited Findings
- **[Executed]** Chromium 158's `en-US.pak` contains the infobar string `"$1" started debugging this browser` and the permission string `Access the page debugger backend`. The browser binary contains these attach errors:
  - `Another debugger is already attached to the * with id: *.`
  - `Cannot attach to this target.`
  - `Cannot access a chrome:// URL`
  - `Cannot access a chrome-extension:// URL of different extension`

  It also contains the switch `silent-debugger-extension-api`. — `grep -a` on `/opt/pw-browsers/chromium-1243/real/chrome-linux64/{chrome,locales/en-US.pak}`
- **[Executed]** A real unpacked MV3 extension (permissions: `["debugger"]` only):
  - attached to flora while Playwright's CDP session was already attached with `Debugger.enable` on (`getTargets` showed `attached:true` beforehand)
  - set the breakpoint patch and saw it work (46.94 px)
  - a second `chrome.debugger.attach` from the same extension failed with `Another debugger is already attached to the tab with id: 1273046793.`
  - `chrome.debugger.detach` reverted (565–568 ms / 2.21 px)

  — [debugger-extension-probe-flora.mjs](scripts/debugger-extension-probe-flora.mjs)
- **[Executed]** Two CDP clients each set a conditional breakpoint on the same line, and both fired (100/100 calls). After client A detached, only B's fired (A stayed at 100, B reached 200). — [debugger-breakpoint-cost-and-clients.mjs](scripts/debugger-breakpoint-cost-and-clients.mjs)
- **[Executed]** `__MOTION_INSPECT__` read lazily: defining it with `Runtime.evaluate` after load changed the next step (bounce 0.3 → 13.19 px), and `delete` reverted (2.22 px). The hook receives the live animation (`r.animation`, constructor `nP` = JSAnimation) and, for JSAnimation, the untouched internal `options` object. — [debugger-live-patch-flora.mjs](scripts/debugger-live-patch-flora.mjs)
- **[Documented]** motion-dom's `notifyAnimationStart(animation, options, transition)` reads `globalThis.__MOTION_INSPECT__` at each call and passes "the live animation handle, the concrete animation's internal options object untouched (timing fields in internal milliseconds…)". The call is wrapped in `try {} catch {}`, and JSAnimation calls it at the end of its constructor, after `initAnimation()` and `play()`. — motion-dom 14.14.0 `animation/utils/notify-inspector.mjs`, `JSAnimation.mjs` ([npm](https://www.npmjs.com/package/motion-dom))
- **[Documented]** `chrome.debugger` gives access to a subset of domains that includes Debugger, Runtime, Fetch, Page, Network, DOM, CSS, Input, Target and others. Further points from the same page:
  - `onDetach` reasons are `target_closed` and `canceled_by_user`, and the event fires "when either the tab is being closed or Chrome DevTools is being invoked for the attached tab".
  - Enterprise `runtime_blocked_hosts` blocks attaching ("This page cannot be scripted due to an ExtensionsSettings policy.") and detaches on navigation to a blocked host.
  - Attaching to an extension background page needs `--silent-debugger-extension-api`.
  - Flat sessions arrived in Chrome 125.

  — [chrome.debugger reference](https://developer.chrome.com/docs/extensions/reference/api/debugger)
- **[Documented] MV3 remote-code policy:**
  - "the full functionality of an extension must be easily discernible from its submitted code"
  - "Execution of logic from a remote source is permissible only when accomplished through a documented API", where the permitted APIs are the Debugger API and the User Scripts API
  - "Note that exemptions apply solely to the specific section of code covered by these APIs."

  — [Chrome Web Store: Additional Requirements for Manifest V3](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements)
- **[Documented]** On the Chromium extensions group, a Chrome DevRel reply about evaluating code through CDP in MV3 said: "we're aware that there are cases where evaluating third-party code is required, such as automated testing tools". I only saw this as a search-result excerpt and did not fetch the thread. — [chromium-extensions: Execution of external logic with CDP in Manifest V3](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/fFKT4HD2_Mw)
- **[Documented]** Microsoft Edge lists `debugger` as a supported API ("Attaches to one or more tabs to instrument network interaction, debug JavaScript…") for MV2/MV3 on Windows, Linux and Mac (not Android). Page updated 2026-08-12. — [Supported APIs for Microsoft Edge extensions](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/api-support)
- **[Documented]** No official Dia (or Arc) extension-API compatibility list was found. Third-party pages only say Chromium extensions "generally" install, with anecdotal gaps (e.g. `tabGroups`). — [superchargebrowser.com comparison (vendor site, low weight)](https://www.superchargebrowser.com/library/dia-browser-vs-chrome-extensions/)

### Inferences
- **Remote code:** Vellum's patch strings (conditions, `callFunctionOn` bodies, hook source) are built in the extension from local data and an agent's numeric parameters, then sent through `chrome.debugger.sendCommand`. That sits inside the documented Debugger-API exemption. Keeping the patch logic as templates in the packaged code, filled with numbers only, keeps "full functionality… discernible" for review. Do not fetch JS from a server and eval it outside CDP.
- **Infobar UX:** a live preview has to stay attached for breakpoint patches. A heap or hook patch can attach, apply, then **detach** (the patch persists, Q3), so the infobar shows only for a moment. Revert then needs a re-attach or a MAIN-world script. Because Vellum already attaches briefly for screenshots, the "attach → mutate → detach" pattern matches today's UX.
- **DevTools conflict:** the docs say opening DevTools fires `onDetach`. My execution shows a second protocol client does not displace the extension. The DevTools front-end itself was not tested, so treat "user opens DevTools mid-preview" as a possible detach, which reverts breakpoint patches but not heap patches. Handle `onDetach` by reverting heap patches with `chrome.scripting` (MAIN world) or a re-attach.
- **Choosing among the live techniques for Motion sites:**
  1. **`__MOTION_INSPECT__`**: needs only `Runtime.evaluate` or a MAIN-world script, no Debugger domain, and can detach right after install. Weaknesses: re-running `initAnimation()` after `play()` relies on internals, and it fires only for animations started after install.
  2. **Instance override**: per-element and stable API surface (`getDefaultTransition`).
  3. **Conditional breakpoint**: works on any library or minified code, auto-reverts on detach, but must stay attached.
  4. **Generator-table swap**: page-wide.
  5. **Fetch rewrite**: needs a reload and has the cache trap.
- **Permissions:** everything here used the existing `debugger` permission. No host permissions or `declarativeNetRequest` are needed for Q2/Q3/Q6 techniques. The Fetch route also needs none (it runs under `debugger`). DNR would need host permissions to redirect.

### Gaps
- No headed Chrome, Dia, Arc or Edge run, so the infobar placement and dismissal (does dismissing fire `canceled_by_user`?) are unverified.
- Not verified in a real browser:
  - whether Dia and Arc expose `chrome.debugger` fully
  - whether Dia shows the infobar
  - whether the DevTools front-end coexists with an extension client on 158

  The repo's existing debugger-based capture working in Dia would be indirect evidence [Inference].
- Two *different* extensions attaching to one tab was not tested. The binary's error string uses a wildcard target type, which suggests the check applies across clients of the same kind, but that is unconfirmed.
- I found no Chrome Web Store reviewer guidance specific to the `debugger` permission (review time, justification text) beyond the MV3 policy and the install warning `Access the page debugger backend`. Whether that warning is paired with "Read and change all your data on all websites" was not verified in a primary doc.
