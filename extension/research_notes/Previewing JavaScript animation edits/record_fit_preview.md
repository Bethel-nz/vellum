# Record, fit, edit, preview, send: library-agnostic edits to script-driven motion (flora.so carousel as test case)

Scope: how Vellum Snapshot can record motion that a library drives from JavaScript, fit a spring or easing curve
to it, let the person change the parameters in the existing DialKit panel, preview the edited motion on the live
element without touching the page's JavaScript, and send the coding agent enough to change the real source.
State as of 2026-11-25.

Evidence labels used throughout:
- **[Verified]**: run by me in headless Chromium 158.0.8127.36 (Playwright 1.63.0, Node 22.23.5), against
  https://flora.so/ or a local page. Proof scripts and data are in `scripts/fit-*.mjs` / `scripts/fit-*.json`
  next to this file. Each script header says what it proves and how to run it.
- **[Source]**: read from published package source (npm tarballs downloaded into an empty folder and read, never
  run): motion-dom 14.14.0 (published 2026-11-13, the latest), motion-dom 13.5.1 and 12.23.12 for comparison,
  dialkit 2.0.2 (the version in `extension/package.json`), and flora's own production chunk.
- **[Documented]**: specs, MDN, vendor docs.
- Inferences and speculation are kept in the Inferences sections and say so.

Versions in play: the extension's own UI depends on `motion` 13.4.0 and `dialkit` 2.0.2
(`extension/package.json`). Flora's bundle contains Motion spring code that matches the 13.x/14.x code structure
(see Q1). Motion major versions: 12.0.0 published 2025-01-20, 13.0.0 2026-08-05, 14.0.0 2026-10-02, 14.14.0
2026-11-13 ([npm registry](https://registry.npmjs.org/motion), [npm registry](https://registry.npmjs.org/motion-dom)).

Script index (all in `scripts/`):

| Script | Proves | Data |
| --- | --- | --- |
| `fit-motion-spring.mjs` | Standalone port of Motion's spring maths and its `linear()` generation; run it for a self-test | none |
| `fit-core.mjs` | Segment detection, spring fit, cubic-bezier fit, BIC model choice (library, imported by the others) | none |
| `fit-flora-sample.mjs` | Recording flora's track and fitting recovers {duration .55, bounce .16}; the port matches Motion's own writes; the selected slide is not the motion owner | `fit-flora-samples.json`, `fit-flora-fits.json` |
| `fit-flora-preview.mjs` | WAAPI preview overrides Motion on the live element, intercepts the next move, slow motion, scrub, ghost, hand-back, full restore; page motion unaffected afterwards | `fit-flora-preview.json` |
| `fit-local-models.mjs` | Fitter picks bezier for CSS transitions and power3.out, spring for a WAAPI `linear()` spring | `fit-local-models.json` |
| `fit-local-cascade.mjs` | Where a WAAPI preview sits against inline, `!important`, CSS transitions, other WAAPI animations, `commitStyles`, `composite: 'add'` | `fit-local-cascade.json` |

## Q1. Motion's spring maths today: {duration, bounce} and visualDuration to {stiffness, damping, mass}, rest thresholds, the analytical solution, and `linear()` generation

### Takeaway
Motion resolves `{duration, bounce}` with Newton's method on a "0.1% envelope" condition. Damping ratio
ζ = 1 − bounce (or 1/(1+bounce) for negative bounce), mass 1, and stiffness = ω0². This has a closed-form inverse,
so a fitted (ω0, ζ) converts exactly back to `{duration, bounce}`. Since 13.x, duration springs start from rest
and end exactly at `duration` with a sub-pixel snap. That snap is a usable fingerprint, and flora's recording
shows it. For WAAPI, Motion turns any spring into a 0..100 generator, steps its duration in 50 ms increments and
samples a `linear()` string every 10 ms. `fit-motion-spring.mjs` reproduces all of this. Against flora's own
per-frame writes, its curve shows no meaningful time drift: −0.32% to +0.34% across four runs.

### Cited Findings
- **[Source]** Defaults in motion-dom 14.14.0: stiffness 100, damping 10, mass 1, duration 800 ms, bounce 0.3,
  visualDuration 0.3 s. Rest thresholds: restSpeed 2 and restDelta 0.5, or 0.01 and 0.005 when |delta| < 5
  ("granular scale"). Durations are clamped to 0.01–10 s and the damping ratio has a floor of 0.05
  ([spring.mjs](https://unpkg.com/motion-dom@14.14.0/dist/es/animation/generators/spring.mjs)).
- **[Source]** `bounceToDampingRatio = bounce < 0 ? 1/max(1+bounce, .05) : max(1−bounce, .05)`. The code comment
  says it "Maps bounce to a damping ratio as SwiftUI does: 0 is critically damped, and it approaches undamped
  towards 1 and infinitely overdamped towards -1"
  ([spring.mjs](https://unpkg.com/motion-dom@14.14.0/dist/es/animation/generators/spring.mjs)).
- **[Source]** `findSpring({duration, bounce})` runs 12 Newton iterations from 5/duration. For an underdamped spring
  it solves `0.001 − (ζω0/ωd)·e^(−ζω0·T) = 0`, with ωd = ω0·√(1−ζ²). For ζ ≥ 1 it solves `e^(−ω0T)(ω0T+1) = 0.001`
  and scales ω0 for overdamped springs with `overdampedFreqScale`. It returns `stiffness = ω0²` and
  `damping = 2ζ√stiffness`. "Assumes zero initial velocity and the default mass"
  ([spring.mjs](https://unpkg.com/motion-dom@14.14.0/dist/es/animation/generators/spring.mjs)).
- **[Source]** `visualDuration` skips `findSpring`: `ω0 = 2π/(visualDuration·1.2) · overdampedFreqScale(ζ, 2π/1.2)`.
  Any physics option (stiffness/damping/mass) overrides the time options: "stiffness/damping/mass overrides
  duration/bounce" ([spring.mjs](https://unpkg.com/motion-dom@14.14.0/dist/es/animation/generators/spring.mjs)).
  The docs agree that "Time options will be overridden if any physics options are set", that `visualDuration` is
  in seconds and overrides `duration`, and that a `duration` spring "starts from rest and ignores velocity"
  ([Motion spring docs](https://motion.dev/docs/spring)).
- **[Source]** Analytical solution, with t in ms, Δ = target − origin and s.velocity = −v0/1000:
  - underdamped: `x(t) = target − e^(−ζω0t)·(A·sin ωd t + Δ·cos ωd t)`, where `A = (s.velocity + ζω0Δ)/ωd`
  - critically damped: `target − e^(−ω0t)(Δ + (s.velocity + ω0Δ)t)`
  - overdamped: a slow and a fast exponential
  Velocity is the analytical derivative
  ([spring.mjs](https://unpkg.com/motion-dom@14.14.0/dist/es/animation/generators/spring.mjs)).
- **[Source]** End condition: a duration spring (`isResolvedFromDuration`) is done when `t >= duration`, and the
  value then snaps to the target. Other springs are done when |velocity| ≤ restSpeed and |target − x| ≤ restDelta.
  A duration spring "must end exactly at its duration ... so it starts from rest", while "Every other spring,
  visualDuration included ... inherits velocity"
  ([spring.mjs](https://unpkg.com/motion-dom@14.14.0/dist/es/animation/generators/spring.mjs)).
- **[Source]** Version differences:
  - 13.5.1 has the same negative-bounce mapping and the same `isTimeDefined ? 0 : velocity` rule
    ([13.5.1 spring.mjs](https://unpkg.com/motion-dom@13.5.1/dist/es/animation/generators/spring.mjs)).
  - 12.23.12 clamps `dampingRatio = clamp(0.05, 1, 1 − bounce)`, so there is no overdamped bounce. Its duration
    springs keep inherited velocity, but still end at `t >= duration`
    ([12.23.12 find.mjs](https://unpkg.com/motion-dom@12.23.12/dist/es/animation/generators/spring/find.mjs),
    [12.23.12 index.mjs](https://unpkg.com/motion-dom@12.23.12/dist/es/animation/generators/spring/index.mjs)).
- **[Documented, conflicts with source]** The fetched Motion docs page lists different defaults: bounce 0.25,
  restSpeed 0.1 and restDelta 0.01 ([Motion spring docs](https://motion.dev/docs/spring)). The 14.14.0 source uses
  bounce 0.3 and the 2 / 0.5 thresholds (granular 0.01 / 0.005)
  ([spring.mjs](https://unpkg.com/motion-dom@14.14.0/dist/es/animation/generators/spring.mjs)). Treat the source
  as authoritative.
- **[Source]** WAAPI/CSS generation:
  - `createGeneratorEasing` runs the spring over 0..100, rescaling velocity to that range. Its duration comes from
    `calcGeneratorDuration`, which steps 50 ms at a time until `done`, up to 20 s
    ([create-generator-easing.mjs](https://unpkg.com/motion-dom@14.14.0/dist/es/animation/generators/utils/create-generator-easing.mjs),
    [calc-duration.mjs](https://unpkg.com/motion-dom@14.14.0/dist/es/animation/generators/utils/calc-duration.mjs)).
  - `mapEasingToNativeEasing` turns a JS easing function into `generateLinearEasing(easing, duration)`: one point
    every 10 ms by default, each rounded to 4 decimals. The fallback is `"ease-out"` where `linear()` is not
    supported ([map-easing.mjs](https://unpkg.com/motion-dom@14.14.0/dist/es/animation/waapi/easing/map-easing.mjs),
    [linear.mjs](https://unpkg.com/motion-dom@14.14.0/dist/es/animation/waapi/utils/linear.mjs)).
  - `spring.toString()` returns `"<duration>ms linear(...)"` at a coarser 30 ms resolution
    ([spring.mjs](https://unpkg.com/motion-dom@14.14.0/dist/es/animation/generators/spring.mjs)). The CSS docs show
    `transition: transform ${spring(0.5, 0.2)}` producing `800ms linear(...)` and warn that "The generated duration
    can be longer than the one provided" ([Motion CSS docs](https://motion.dev/docs/css)).
- **[Source]** Motion 14 adds `TransformAnimation`, which can run transform groups as WAAPI animations with
  traced `linear()` easings. It "stay[s] on the main thread" when, for example, `onUpdate` or `transformTemplate`
  is present or `linear()` is unsupported
  ([TransformAnimation.mjs](https://unpkg.com/motion-dom@14.14.0/dist/es/animation/waapi/transforms/TransformAnimation.mjs)).
  Flora's track is still driven on the JS thread: its inline `transform` changes every frame and
  `card.getAnimations({subtree:true}).length` is 0 in every moving frame **[Verified]** (`fit-flora-fits.json` →
  `animationsWhileMoving`; `fit-flora-preview.json` → `recording.cardAnimations`).
- **[Source]** Flora's production chunk (`/_next/static/immutable/chunks/43t38g6et1zz8.js`, read only) contains the
  13.x/14.x spring code: the same negative-bounce `i0=e=>e<0?1/Math.max(1+e,.05):Math.max(1-e,.05)`, the
  `done = t >= duration` branch and the memoised `{A, sinC, cosC}` coefficients. It also bundles DialKit, which has
  its own spring conversion (`2*Math.PI/(1.2*t)` with bounce clamped to [0.05, 1]).
- **[Verified]** `node scripts/fit-motion-spring.mjs` gives these resolutions:
  - `findSpring(550 ms, .16)`: stiffness 252.742, damping 26.708 (ζ 0.84, ω0 15.898 rad/s); the closed-form
    inverse returns exactly 0.55 / 0.16, with visualDuration 0.3294.
  - The edited `findSpring(1000 ms, .4)`: stiffness 121.737, damping 13.240 (ζ 0.6), visualDuration 0.4746.
  - visualDuration 0.55 with bounce 0.16 gives a different spring: stiffness 90.63, damping 15.99. Duration and
    visualDuration are not interchangeable.
  - Predicted flora overshoot is −2.22 px on a 288 px move, and the value at 549 ms is −576.287, after which it
    snaps to −576. Observed: a peak 2.22 px past the target (−866.219 on the −576 → −864 move), and last
    pre-snap frames of −576.322 and −864.322 that snap to −576 and −864 (`fit-flora-samples.json`).
  - As WAAPI: flora's spring is 550 ms with a 427-character `linear()`; the edited spring is 1000 ms with
    793 characters.
- **[Verified]** Port check against Motion itself on flora (`fit-flora-sample.mjs` → `fit-flora-fits.json` →
  `portCheck`). I inverted the port's curve at each of Motion's 18 monotonic per-frame style writes per move to
  recover Motion's elapsed time. In the saved run, its offset from the frame time stays within a 1.7–4.3 ms band,
  with drift slopes of −0.32% and −0.22%. Earlier runs gave −0.14% / −0.19% and −0.05% / +0.34%. A scratch run
  showed a ±0.4 ms band repeating every three frames, which is the 100 µs-rounded frame timestamps alternating
  16.6 and 16.7 ms.
  - The wider band comes from Motion's own clock. Motion reads `performance.now()` when its frame runs, and in the
    saved run's move 1 its consecutive writes stepped −29.2, −16.4 and then −18.3 px. Step sizes that rise again
    mean a late or early frame on the page side.
  - Motion's first write in each move is already 11–12 ms into the animation, and its last write lands 550 ms after
    its first.
- **[Documented]** Settling time for an underdamped second-order system: Ts = −ln(tol·√(1−ζ²))/(ζωn), or about
  3.9/(ζωn) for 2% ([Wikipedia: Settling time](https://en.wikipedia.org/wiki/Settling_time)). Percent overshoot is
  PO = 100·exp(−ζπ/√(1−ζ²)), with inverse ζ = −ln(PO/100)/√(π² + ln²(PO/100))
  ([Wikipedia: Overshoot](https://en.wikipedia.org/wiki/Overshoot_(signal))).

### Inferences
- Motion's `duration` is a settling time with tolerance 0.001 and an extra 1/ζ factor:
  T = −ln(0.001·√(1−ζ²)/ζ)/(ζω0). That is why `physicsToTime()` in `fit-motion-spring.mjs` can invert it in
  closed form for ζ < 1, and by bisection for ζ ≥ 1.
- Two quick consistency checks for any fit:
  - Overshoot from ζ: bounce .16 → ζ .84 → 0.77% of 288 px = 2.2 px, which matches the observed 2.22 px.
  - The end snap: Motion duration springs snap within one frame after t0 + duration. In the saved run the snaps
    came 559.6 and 560.1 ms after the fitted t0, each with a last step of 0.322 px (`fit-flora-fits.json` →
    `snap`). Scratch runs gave 557.8–559.7 ms over four more moves. A spring that ends on rest thresholds instead
    settles when it is within 0.5 px of the target and slower than 2 px/s.
- When converting a fit, keep the form the source uses (`duration`, `visualDuration` or physics). The three are not
  equivalent: they differ in end condition and in how they treat inherited velocity.
- For previews, 10 ms `linear()` sampling is good to about 0.4–0.8 px on these curves (see Q4 errors). Motion's
  30 ms `toString()` resolution is coarser. Inferred: on flora's spring, the interpolation error is
  h²/8·|x''| ≈ 8 px at 30 ms (not run).

### Gaps
- I did not execute Motion itself (by constraint). The port is checked against Motion's writes on flora, which use
  only the underdamped from-rest path. The overdamped, critical, `visualDuration` and inherited-velocity paths are
  ported line by line but were not checked against Motion running in a browser.
- I found no release note naming the version where duration springs switched to from-rest and negative bounce. I
  only compared 12.23.12 with 13.5.1 and 14.14.0.
- Flora's exact Motion version string is not in its bundle: my search for `version="x.y.z"` found nothing.

## Q2. Fitting: finding the move in 60 Hz samples with jitter and holds, fitting a spring and a cubic-bezier, choosing between them, goodness of fit; does flora give back 0.55 / 0.16?

### Takeaway
Use a stillness-based segmenter, then two least-squares fits on a window around each move with free start time
t0:
- the segmenter's stillness threshold is max(0.05 px, 1e-4 × range), and a hold must last ≥ 90 ms so an
  overshoot's turnaround doesn't split the move;
- a damped oscillator, from rest or with initial velocity, using Huber loss;
- a cubic-bezier with its duration.

Pick by BIC and report RMSE, max error and R². On flora, 16 fits came from two saved recordings: the saved
sampler run in six sampling variants, plus four moves in the preview run. They recovered duration 0.542–0.555 s
and bounce 0.155–0.163, against the truth of 0.55 / 0.16.
- Spring RMSE was 0.16–0.31 px on clean moves, and up to 1.06 px on a move with a page-side clock glitch.
- The spring beat the best bezier on BIC every time, by ΔBIC 28–147. The one exception was a 30 Hz case at 2.3,
  which counts as a tie and is broken toward spring by the overshoot.

Real CSS bezier transitions and a JS power3.out were classified as bezier, with parameters recovered.

### Cited Findings
- **[Verified]** Segmenter and fitters are in `scripts/fit-core.mjs`:
  - `detectSegments` splits a channel into moves. It uses a hold of ≥ 90 ms and a per-step threshold of
    max(0.05, 1e-4 × range); a coarser 1e-3 × range threshold ended flora's moves early in the slow tail.
  - `fillHolds` lets a change-only stream (MutationObserver writes) be segmented.
  - `fitSpring`:
    - fits t0, log ω0, log ζ and optionally v0;
    - from and to come from the holds;
    - Nelder–Mead starts from 45 points, then polishes;
    - Huber loss (k = 1 px) keeps one late frame from pulling the fit.
  - `fitBezier` fits t0, the duration and 4 points, with x clamped to (0, 1) by a sigmoid.
  - `fitSegment` fits both. It keeps the velocity-free spring unless adding v0 lowers BIC by more than 6, and
    picks the family by ΔBIC (|ΔBIC| < 6 counts as a tie, broken by whether the samples show an overshoot
    extremum).
- **[Verified]** Flora, 2026-11-25 (`fit-flora-fits.json`, React props read back as
  `{"type":"spring","duration":0.55,"bounce":0.16}`). Pairs are duration/bounce for each of the two moves:

  | Sampling variant | Duration / bounce (move 1; move 2) | Spring RMSE / max (px) | Best bezier RMSE / max (px) | ΔBIC (bezier − spring) |
  | --- | --- | --- | --- | --- |
  | rAF frame time, 60 Hz | 0.5477 / 0.1583; 0.5534 / 0.1618 | 0.73 / 4.86; 0.22 / 0.70 | 0.96 / 2.79; 0.84 / 2.19 | 40; 146 |
  | performance.now() in rAF | 0.5495 / 0.1596; 0.5534 / 0.1616 | 1.06 / 5.36; 0.22 / 0.63 | 1.24 / 5.07; 0.83 / 2.19 | 28; 143 |
  | style writes only (MutationObserver) | 0.5476 / 0.1582; 0.5535 / 0.1618 | 0.84 / 4.75; 0.27 / 0.81 | 1.13 / 3.99; 0.98 / 2.19 | 32; 105 |
  | 30 Hz | 0.5420 / 0.1551; 0.5553 / 0.1625 | 0.89 / 4.32; 0.16 / 0.48 | 0.77 / 2.08; 0.52 / 1.15 | 2.3; 69 |
  | 12 Hz (what `sample()` records in 60 s) | 0.5528 / 0.1594; 0.5520 / 0.1600 (fitted v0 nonzero) | 0.02 / 0.07; 0.02 / 0.07 | 0.41 / 1.36; 0.41 / 1.36 | 75; 78 |
  | 60 Hz + 0–2 ms timestamp jitter | 0.5472 / 0.1571; 0.5539 / 0.1630 | 0.62 / 3.23; 0.61 / 2.09 | 0.93 / 2.19; 0.91 / 2.78 | 53; 51 |

  Move 1 of the saved run contains the page-side clock glitch described in Q1. It shows in the writes-only stream
  too, so it is in Motion's own values, not the sampler's. An earlier recording without such a frame gave 60 Hz
  fits of 0.5486 / 0.1592 and 0.5494 / 0.1595, with RMSE 0.25 / 0.27 px and ΔBIC 136 / 126 (overwritten run,
  same scripts).

  The `fit-flora-preview.mjs` run fitted four more moves: 0.5500 / 0.1604, 0.5531 / 0.1617, then
  0.5506 / 0.1604 and 0.5513 / 0.1608 after all the preview tests. Their RMSE was 0.22–0.25 px, max error
  0.69–0.87 px, ΔBIC 136–147, physics stiffness 250.5–252.9 and damping 26.5–26.7 (truth 252.7 / 26.7),
  overshoot 0.78–0.80% and 2% settle at 257 ms.
- **[Verified]** Where the residual comes from:
  - The rAF timestamps are rounded to 0.1 ms, giving the 16.6/16.7 ms alternation, which is up to 0.6 px at peak
    speed.
  - Motion's own clock is `performance.now()` when its frame runs, not the rAF timestamp. One logged frame in a
    scratch run stepped 26.7 px and then 12.9 px, which pushed max error to 4.6 px before the Huber loss went in.
    The saved run's move 1 has the same kind of frame (max error 4.86 px, with the parameters still within 0.5%).
  - An earlier scratch run on the 12 Hz variant picked cubic-bezier with ΔBIC −24.8 on one move. With about 12
    points, the six-parameter bezier can overfit. The spring parameters were still right (0.5534 / 0.1647).
- **[Verified]** Model choice on motion of known origin (`fit-local-models.mjs` → `fit-local-models.json`):

  | Truth | Choice (ΔBIC) | Recovered |
  | --- | --- | --- |
  | CSS transition `cubic-bezier(0.2, 0.8, 0.2, 1)` 600 ms | cubic-bezier (−533) | `cubic-bezier(0.201, 0.797, 0.203, 0.998)` 593 ms, RMSE 0.004 px |
  | CSS `ease-in-out` 400 ms | cubic-bezier (−848) | `cubic-bezier(0.42, 0.001, 0.58, 1)` 400 ms |
  | WAAPI with Motion's `linear()` for {duration 1.0, bounce .4} | spring (+444) | duration 1.0005, bounce 0.3998, RMSE 0.089 px |
  | JS rAF power3.out 700 ms | cubic-bezier (−736) | `cubic-bezier(0.333, 0.977, 0.667, 0.999)` 684 ms |

  The third row is also a round-trip check: the preview easing string plays back as the spring it came from.
- **[Verified]** Run time in Node: the spring fit takes about 100 ms per move and the bezier fit about 1.07 s,
  because a bisection inverse runs inside the multi-start optimiser.
- **[Verified]** The holds and the first frame:
  - Each move's first visible frame has already moved 4 px (−288 → −291.99), because Motion starts its clock
    11–12 ms before its first write.
  - The fitted t0 lands 6.6–7.1 ms after the last still frame's timestamp in the saved run
    (`fit-flora-fits.json` → `snap`), and up to 8.8 ms in scratch runs.
  - With the hold value as `from`, t0 is well determined.

### Inferences
- Record every frame while a channel changes and keep holds sparse; don't decimate evenly. The current `sample()`
  uses `interval = max(16, duration/720)` (`extension/src/extract.ts:238`), which falls to 12 Hz at 60 s and makes
  model choice less reliable. Change-only rows plus hold markers keep the 720-row budget: `fillHolds` showed that
  writes-only streams fit as well as full frames.
- Use the rAF timestamp argument, or a MutationObserver on `style` paired with `document.timeline.currentTime`,
  rather than `performance.now()` after reads. The fits were equivalent here, but the timestamp is the frame's.
- Distrust the model choice when a move has fewer than about 20 samples. Report the parameters of both models with
  a "low sample count" flag.
- Treat a one-frame step of more than about 60% of the move, with no motion either side, as a jump (FLIP,
  recycling), not as motion. Flora's slides do exactly this (see Q3), and `detectSegments` sets `jump` for
  segments of two steps or fewer.
- Move the fit off the content script's main thread, into a Worker or the service worker. Or fit the spring first
  (about 0.1 s) and run the bezier only if the spring fit is poor.

### Gaps
- I did not test GSAP, react-spring, Framer, or CSS-variable-driven motion on live sites; a sibling research
  note covers library detection. I did not fit multi-keyframe sequences, retargeted (interrupted) springs,
  `inertia`/decay, or 2D paths. The current fitter is 1D per channel.
- I found no public spring-fitting tool to compare against. The tool the Chrome docs mention (Jake Archibald and
  Adam Argyle's) converts easing functions to `linear()`; it does not fit samples
  ([Chrome docs](https://developer.chrome.com/docs/css-ui/css-linear-easing-function)).

## Q3. Preview on the live element without patching page JS: does WAAPI override Motion's per-frame inline transform, how do you compose and hand back, and what about children and related elements?

### Takeaway
Yes. In Chromium, `element.animate(keyframes, { easing: linear(...), fill: 'forwards' })` on `transform` overrides
the inline transform that Motion keeps writing every frame. Motion keeps running underneath, and cancel() reveals
its current value at once. The preview has four modes, all verified on flora:
- **Intercept:** start the edited move in a MutationObserver callback at the page's own move start. It replaces
  Motion's motion from the same frame, with zero jump on cancel when both end on the same target.
- **Replay in place:** play P − Δ → P, ending where the page already is.
- **Mid-move hand-back:** a `composite: 'add'` offset that decays to 0 hands back with no jump.
- **Not `!important` inline:** it is no preview layer, because Motion's next write drops the priority.

Children inherit the owner's transform. The element a person selects is often not the one that moves.

### Cited Findings
- **[Documented]** CSS Cascade 5 orders origins from highest: Transition, Important UA, Important user, Important
  author, Animation, Normal author, and so on. Style-attribute declarations beat style-rule declarations of the
  same importance ([CSS Cascade 5 §6.1](https://www.w3.org/TR/css-cascade-5/#cascade-origin),
  [§ Element-Attached Styles](https://www.w3.org/TR/css-cascade-5/#style-attr)). So an animation, in the Animation
  origin, beats a normal inline style and loses to an `!important` one.
- **[Documented]** Web Animations: "animations are appended to a global animation list in the order in which they
  are created". Seeking sets the hold time when paused. The playback rate is "a scaling factor from the rate of
  change" of the timeline ([Web Animations 1](https://www.w3.org/TR/web-animations-1/)). `composite: 'add'`
  appends the effect to the underlying value, while `replace` overrides it
  ([MDN KeyframeEffect.composite](https://developer.mozilla.org/en-US/docs/Web/API/KeyframeEffect/composite)).
  It is Baseline widely available since September 2022 (same page). `commitStyles()` "writes the computed values
  of the animation's current styles into its target element's style attribute"
  ([MDN commitStyles](https://developer.mozilla.org/en-US/docs/Web/API/Animation/commitStyles)).
- **[Documented]** `linear()` shipped in Chrome 113, Firefox 112 and Safari 17.2
  ([Chrome docs](https://developer.chrome.com/docs/css-ui/css-linear-easing-function)) and is "Baseline: Widely
  available ... since December 2023" ([MDN linear()](https://developer.mozilla.org/en-US/docs/Web/CSS/easing-function/linear)).
  Chrome, Edge and Dia (Chromium) all qualify.
- **[Documented]** Content scripts "live in an isolated world" and "share access to the page's DOM". Their
  JavaScript variables "are not visible to the host page"
  ([Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)).
  `extension/src/background.ts:46` injects `content.js` with `chrome.scripting.executeScript` and no `world`, so it
  runs in the isolated world. `element.animate()` works there because it acts on the shared DOM. Reading React
  fiber props (`__reactFiber$…`) needs the MAIN world.
- **[Verified]** Flora (`fit-flora-preview.mjs` → `fit-flora-preview.json`, section `intercept`):
  - A MutationObserver on the track's `style` resolved at the page's move start (from −864). The preview
    `translateX(-864px) → translateX(-1152px)` (duration 1000 ms, the edited `linear()`, `fill: 'forwards'`)
    started inside that callback's microtask continuation.
  - In that same frame, computed transform read −864 while the inline style read −867.99, which was Motion's
    first write (`sameFrameOverride: true`).
  - Over 79 frames, the computed value followed the edited curve within 0.33 px. Motion's inline value differed
    underneath in 53 frames, overshooting only 2.2 px, while the preview overshot 27.18 px (bounce .4, ζ .6:
    9.5% of 288).
  - After cancel, the jump in the same task was 0 px, and computed equalled inline in every following frame.
- **[Verified]** `!important` (section `important`): setting the same value inline with `!important` held until
  Motion's next write. After that write, `getPropertyPriority('transform')` was `''`. Motion assigns inline style
  per frame, which replaces the priority, so an inline-style preview gets clobbered every frame.
- **[Verified]** Hand-back mid-move (section `handback`):
  - A preview held at the pre-move value was cancelled 150 ms into Motion's next move. The plain `cancel()` jumped
    255.7 px in one frame.
  - Cancelling instead with `el.animate([{transform: translateX(shown − page)}, {transform: translateX(0)}],
    {composite: 'add', duration: 300, easing: 'ease-in-out'})` gave a 0 px jump. The largest per-frame step was
    24.8 px, against the page's own peak of about 30 px per frame, and the motion converged exactly to Motion's
    inline value.
  - The first frame equalled inline + offset (`addFirstEqualsInlinePlusOffset: true`).
- **[Verified]** Local cascade (`fit-local-cascade.mjs` → `fit-local-cascade.json`, Chromium 158):
  - (a) The preview beats inline style: computed 500 against inline 20, and cancel restores 20.
  - (b) `!important` inline beats the preview: computed 30.
  - (c) The preview beats a running CSS transition on transform: computed 500 while a `CSSTransition` runs.
    Chromium composites them in one stack with script animations on top, even though Cascade 5 lists a
    Transition origin first.
  - (d) The preview beats a page WAAPI animation created before it (500), but a page animation re-created after
    the preview wins (100). The composite order is creation order.
  - (e) The page animation's `commitStyles()` writes its own value (`translateX(100px)`), not the preview's.
  - (f) `composite: 'add'` over inline `translateX(40px)` + `translateX(7px)` gives `matrix(1,0,0,1,47,0)`.
- **[Verified]** Restoring is complete (sections `replay.restored`, `leftovers`, `afterFits`):
  - After all tests, the track has 0 animations, no ghost nodes and no `!important`.
  - There were no page errors or console errors.
  - The next two Motion moves fitted 0.5506 / 0.1604 and 0.5513 / 0.1608. The page's motion was untouched, and no
    reload was needed.
- **[Verified]** Children and related elements on flora:
  - The track (`div.absolute`, width 0, `motion.div` with `animate={{x: 0}}`, `initial={false}`) holds six
    `ARTICLE.absolute top-0` slides. The slides have their own `left`, `z-index` and `aria-hidden`, and no
    transform.
  - During two moves, the card's MutationObserver saw only `aria-hidden` ×4 and `style` ×4 changes on the slides
    (z-index and `left` rewrites), with 0 WAAPI or CSS animations (`recording.relatedChanges`).
  - A slide's box x minus the track's translateX was constant at 596, then 884, then 1172 px. It stepped +288 px
    16.7 ms before each track move began (moves at 4316.5 and 9316.3 ms; steps at 4299.8 and 9299.6 ms). React
    recycles the slides and rewrites their `left` (`fit-flora-fits.json` → `owner`).
  - An earlier 12 s scratch run, whose window had no recycle, showed the slide's x = track x + 596 exactly over
    all 721 frames. That data was not kept; the saved run shows the same within each move.
  - In every moving frame, `getAnimations({subtree: true})` on the card returned 0 (`fit-flora-fits.json` →
    `animationsWhileMoving`).

### Inferences
- **Motion owner.** The slide a person clicks has no transform: it moves because an ancestor's does, and its own
  channel shows a jump plus a spring. Before fitting and previewing, walk up from the selection. Pick the nearest
  ancestor whose own transform delta equals the selection's box delta during the move, and fit and preview that
  element (on flora, the track).
- **Preview recipe** (speculative design, built from the verified pieces):
  - Keyframes are `[current matrix, current matrix with the edited translation]` in the owner's own transform
    units, with `fill: 'forwards'` and the edited spring as `linear()` from `springToWaapi()`.
  - Use `composite: 'replace'` for the preview itself and `composite: 'add'` only for the hand-back.
  - Store the animation in `sampledReplay`-like state and cancel on Escape, Discard or blur.
  - Compose other transform functions such as scale and rotate by keeping the owner's current matrix and
    changing only the animated channel.
- **Start from the element's current position.** With the page idle, replay in place: P − Δ → P, where Δ is the
  recorded move. With "Preview on next trigger", start from the hold value at the page's move start. The end then
  matches the page's own target, so cancel is seamless.
- **Re-assert when the page creates animations.** If the page creates WAAPI or CSS animations after the preview
  starts (Motion 14 `TransformAnimation` rebuilds, for example), the page wins (local test d). Watch
  `document.getAnimations()` per frame while previewing, and re-create the preview at the same `currentTime` when
  a newer animation targets the same property.
- **Inline `!important` on the page** beats any preview (local test b). The only reversible override then is the
  extension setting its own inline `!important` value, which works only if the page doesn't write that property
  per frame. Otherwise, report that the preview is blocked.
- **Related elements that share a transition object** (dots, captions, parallax layers) need their own fitted
  channel. Offer "apply to all with the same fitted transition": same parameters within tolerance, started in the
  same frame. Flora has none; its related changes are discrete attribute flips.

### Gaps
- I did not test Safari or Firefox. The extension targets only Chromium browsers (Chrome, Edge, Dia).
- I did not test from a real extension isolated world, only from the main world via Playwright. The isolated-world
  behaviour of `element.animate()` is inferred from the shared DOM; it was not run.
- I did not test pages that animate with CSS variables (`--x`), `translate` or `scale` (individual transform
  properties), SVG attributes or canvas. The preview must target the property the page actually writes.
- I found no spec text explaining why Chromium lets script animations beat CSS transitions despite the Cascade 5
  origin list, because the spec sections were truncated in fetches. The behaviour is verified; the rationale is
  not sourced.

## Q4. Slow motion, scrubbing, and original-versus-edited comparison inside the existing DialKit panel

### Takeaway
`playbackRate` and pause-plus-`currentTime` on the preview animations give exact slow motion and scrubbing. A
temporary inert clone (ghost) playing the original fitted curve beside the edited one, both on one start time,
worked on flora and cleaned up fully. The existing panel already has most of the controls: Replay/Record actions,
speed, frames, progress and recording seconds. DialKit 2.0.2 already ships a spring control with Time
(visualDuration/bounce) and Physics modes. The main gaps are wiring the fit into a `type: 'spring'` dial, and the
Time/duration mismatch.

### Cited Findings
- **[Verified]** Flora, section `replay` of `fit-flora-preview.json`:
  - After a move settled at P = −1440, two animations started on one `startTime`, both at `playbackRate` 0.25:
    the real track played the edited spring (−1152 → −1440), and a clone played the original fitted spring
    0.55 / 0.16. The clone was `cloneNode(true)` with `inert`, `aria-hidden`, opacity .35 and pointer-events none,
    inserted after the track.
  - Over 700 ms of wall time, 179 ms of animation time advanced (0.256×).
  - Computed values matched the analytical curves within 0.40 px (edited) and 0.81 px (ghost). That error is the
    10 ms `linear()` interpolation.
  - Pausing both and seeking to 0, 100, 200, 300, 450, 600, 800 and 1000 ms matched within 0.10 px. At 300 ms the
    edited track was at −1460.7 (overshooting) while the ghost was at −1440.2 (settled), and Motion's inline value
    stayed at −1440 throughout.
  - Cancel plus `ghost.remove()` restored computed = inline = P exactly, with no `[data-vellum-ghost]` left, no
    animations and no page errors.
- **[Source]** The existing panel (`extension/src/ui/Dials.tsx`):
  - `animation.playback` has `playing` and `speed` [.1–3].
  - `animation.timing` has `easing` built by `easing()` as DialKit `{type: 'easing', duration, ease: [4]}`, plus
    `delay` and `iterations`.
  - `animation.frames.progress` is the scrub; `animation.recording.seconds` runs 1–60.
  - There are `restart` (Replay) and `record` actions.
  - Edits reach `onTiming`, `onSpeed`, `onSeek` and `onReplay` in `extension/src/content.ts:329`,
    `content.ts:457–458` and `content.ts:390`.
  - Sampled recordings already replay as keyframes with `easing: 'linear'`, `fill: 'forwards'`
    (`content.ts:106–135`), and `onSeek` scrubs them through `previewSampledFrame`.
- **[Source]** DialKit 2.0.2:
  - Its controls include "Spring | `motion: { type: "spring", visualDuration: 0.3, bounce: 0.2 }`" and "Easing".
    "Spring and easing controls share an editor with **Easing**, **Time**, and **Physics** modes"
    ([DialKit README](https://unpkg.com/dialkit@2.0.2/README.md)).
  - `SpringConfig = {type: 'spring'; stiffness?; damping?; mass?; visualDuration?; bounce?}` has no `duration`
    field ([index.d.ts](https://unpkg.com/dialkit@2.0.2/dist/index.d.ts)).
  - DialKit's built-in Copy produces "Update the … configuration for "…" with these values: ```json …```"
    ([copy-instruction.js](https://unpkg.com/dialkit@2.0.2/dist/copy-instruction.js)).

### Inferences
- **Panel design** (speculative; these are suggestions):
  - When the fit picks a spring, replace the `timing.easing` control with a `type: 'spring'` control. Seed it with
    `{visualDuration, bounce}` from `physicsToTime()` (flora: 0.329 / 0.16), and keep the fitted physics for
    Physics mode.
  - Show the source form alongside it: "duration 0.55 s" when the read-back or the snap fingerprint says the
    source uses `duration`.
  - On send, convert the edited physics back to the source's form. DialKit's Time mode is `visualDuration`, so
    sending its numbers to a `duration`-based source would change the motion.
- **Comparison choices:**
  - Default to a ghost **outline** drawn in Vellum's own overlay, following the original fitted curve
    (`trackedTargets`/`updateGeometry` already draw outlines per frame). It never touches the page DOM.
  - Offer the cloned **ghost** only when the person asks to "show original". The clone inserts a node into a
    React-owned parent. It caused no errors on flora, but React reconciling that parent mid-preview could misplace
    it (speculative).
  - Use an A/B toggle (original fitted curve versus edited, same keyframes) as the keyboard path.
- **Controls:**
  - Map `speed` to `playbackRate` for both the preview and the ghost, and `frames.progress` to `currentTime`, with
    pause, for both.
  - Replay re-runs in place (P − Δ → P).
  - Add "Preview on next trigger" (the intercept mode) for periodic or autoplay motion like flora's.
  - Every pointer path needs a keyboard path (AGENTS.md); Space and the arrow keys on the focused dial suit play
    and scrub.
- **Panel motion follows the Vellum motion contract.** The page preview is the person's explicit request, and
  under reduced motion it should still play on demand, with scrubbing as the alternative channel (speculative
  reading of AGENTS.md "keep one-shot confirmation in another channel").

### Gaps
- I did not render DialKit's spring editor in the extension, or check how it lays out in the panel width.
- There is no ghost test on a page whose parent React re-renders its children list during the preview.

## Q5. What to send to the coding agent, and how it fits `core/capture.ts`

### Takeaway
Send a compact motion record per edited element:
- the owner selector and the component;
- the detected library and the evidence for it;
- the read-back transition, when available;
- the fitted model with its quality;
- the edited model;
- a short curve summary;
- the suggested code change in the source's own form.

Most of it fits today's schema: `CaptureAnimation.timing` is `Record<string, unknown>`, the note gets "Apply these
changes …" lines from `motionChanges`, and `samples` stays as is. Additive typed fields (`fit`, `edit`, `library`,
`readBack`) make it robust.

### Cited Findings
- **[Source]** Today's schema and flow:
  - `CaptureAnimation` has `origin: 'extracted' | 'sampled'`, `kind: 'css-animation' | 'css-transition' | 'waapi'
    | 'js'`, `name?`, `trigger?`, `keyframes?`, `timing?: Record<string, unknown>`,
    `samples?: Array<Record<string, number>>`, `gesture?` and `frames?` (`core/capture.ts:33–44`).
  - `sample()` emits `{origin: 'sampled', kind: 'js', name: 'Sampled motion (inferred)', samples, timing:
    {duration}}` (`extension/src/extract.ts:267`).
  - `makeCapture` folds `previews` and `motionChanges` into the note as "Apply these changes to the owning source
    styles or animation (use the captured viewport as context):\n- property: before → after"
    (`extension/src/content.ts:639–642`).
  - `react: {component, source}` comes from react-grab's `getElementContext` (`extension/src/extract.ts`, in
    `extract()`).
- **[Documented]** GSAP: CustomEase is a plugin registered with `gsap.registerPlugin(CustomEase)`. It is created
  from SVG path data (`CustomEase.create("hop", "M0,0 C…")`) or from a four-number cubic-bezier string
  (`CustomEase.create("easeName", ".17,.67,.83,.67")`) ([GSAP CustomEase](https://gsap.com/docs/v3/Eases/CustomEase)).
  Webflow made GSAP, including its formerly paid plugins, free
  ([Webflow blog](https://webflow.com/blog/gsap-becomes-free)). Core eases include the power1–power4 families with
  .in/.out/.inOut ([GSAP Eases](https://gsap.com/docs/v3/Eases)).
- **[Documented]** For CSS without `linear()` support, "the browser will ignore your animation". Motion suggests a
  fallback transition declared first ([Motion CSS docs](https://motion.dev/docs/css)).
- **[Verified]** power3.out is exactly `cubic-bezier(1/3, 1, 2/3, 1)`: the fitter recovered
  `cubic-bezier(0.333, 0.977, 0.667, 0.999)` with an RMSE of 0.001 px (`fit-local-models.json`). So a GSAP
  powerN/cubic ease can be sent as a four-number CustomEase or the named ease.

### Inferences
Proposed additive types for `core/capture.ts` (speculative design; existing fields unchanged):

```ts
export type CaptureMotionModel =
  | { type: 'spring'; duration: number; bounce: number; visualDuration: number; stiffness: number; damping: number; mass: number; velocity?: number }
  | { type: 'cubic-bezier'; duration: number; points: [number, number, number, number] }
  | { type: 'linear'; duration: number; easing: string } // a sampled curve with no good model

export type CaptureMotionFit = {
  owner: string                    // selector of the element whose own property moves (may differ from the selection)
  channel: string                  // 'transform.translateX' | 'opacity' | 'width' | …
  unit: string                     // 'px' | 'deg' | ''
  segments: Array<{
    t: number; from: number; to: number            // ms since recording start, values in `unit`
    model: CaptureMotionModel; alternative?: CaptureMotionModel
    quality: { rmse: number; maxError: number; r2: number; n: number; deltaBIC: number }
    overshoot?: number; settleMs?: number          // in `unit`, 2 % settle
  }>
  repeats?: { periodMs: number; agree: boolean }   // same curve every N ms (flora: 5000)
}

// on CaptureAnimation (all optional):
fit?: CaptureMotionFit
edit?: { model: CaptureMotionModel; css: { duration: number; easing: string }; previewed: boolean }
library?: { name: 'motion' | 'gsap' | 'css' | 'waapi' | 'unknown'; version?: string; evidence: string[] }
readBack?: { transition?: unknown; animate?: unknown; component?: string } // from React props, MAIN world, untrusted page data
```

If the schema can't change yet, put the same objects under `timing.fit`, `timing.edit` and `timing.library`.
`timing` is already `Record<string, unknown>`. Add one `motionChanges` entry,
`'animation-transition': { before: 'spring duration 0.55 bounce 0.16', after: 'spring duration 1 bounce 0.4' }`,
so the existing note line carries the change in plain words.

Flora example (values from `fit-flora-preview.json`; samples trimmed):

```json
{
  "origin": "sampled", "kind": "js", "trigger": "idle", "name": "Sampled motion (inferred)",
  "timing": { "duration": 10600 },
  "fit": {
    "owner": "div.absolute (child of .t-panel-slide in .journal-carousel)", "channel": "transform.translateX", "unit": "px",
    "segments": [{ "t": 4316, "from": -288, "to": -576,
      "model": { "type": "spring", "duration": 0.55, "bounce": 0.16, "visualDuration": 0.329, "stiffness": 252.9, "damping": 26.7, "mass": 1, "velocity": 0 },
      "alternative": { "type": "cubic-bezier", "duration": 0.42, "points": [0.32, 0.763, 0.289, 1.072] },
      "quality": { "rmse": 0.25, "maxError": 0.80, "r2": 0.99998, "n": 50, "deltaBIC": 136 },
      "overshoot": 2.2, "settleMs": 257 }],
    "repeats": { "periodMs": 5000, "agree": true }
  },
  "library": { "name": "motion", "evidence": ["motion.div React props with transition", "inline transform written every frame, no WAAPI/CSS animations", "sub-pixel snap to target 550 ms after start (duration spring)"] },
  "readBack": { "component": "motion.div", "transition": { "type": "spring", "duration": 0.55, "bounce": 0.16 }, "animate": { "x": 0 } },
  "edit": { "model": { "type": "spring", "duration": 1, "bounce": 0.4, "visualDuration": 0.475, "stiffness": 121.7, "damping": 13.24, "mass": 1 },
            "css": { "duration": 1000, "easing": "linear(0, 0.0059, 0.0227, …)" }, "previewed": true }
}
```

Suggested prompt line, placed in the note through `motionChanges`: "Carousel track (motion.div, `animate={{ x: 0 }}`)
moves with `transition={{ type: "spring", duration: 0.55, bounce: 0.16 }}`. The value was read from props and
matches the recording (fit 0.55 / 0.16, RMSE 0.25 px). Change it to
`{ type: "spring", duration: 1, bounce: 0.4 }`. Previewed in the browser: 27 px overshoot on a 288 px move,
settles in about 0.6 s."

Code change shapes by library, all in the source's own form:
- **Motion (React):**
  `transition={{ type: "spring", duration: 0.55, bounce: 0.16 }}` → `{ type: "spring", duration: 1, bounce: 0.4 }`.
  - If the source uses `visualDuration`, send `visualDuration: 0.475, bounce: 0.4` (same physics).
  - If it uses physics, send `stiffness: 121.7, damping: 13.24, mass: 1`.
  - Tell the agent which form it is, because the forms end and treat velocity differently (Q1).
  - For a bezier fit, send `transition={{ duration: 0.42, ease: [0.32, 0.763, 0.289, 1.072] }}`.
- **CSS:** `transition: transform 1000ms linear(…)`, generated as Motion does (10 ms points). Or
  `cubic-bezier(x1, y1, x2, y2)` for a bezier fit, with a plain fallback transition declared first.
- **WAAPI:** `el.animate(kf, { duration: 1000, easing: "linear(…)" })`.
- **GSAP:**
  - A bezier fit becomes `ease: CustomEase.create("edited", "x1,y1,x2,y2")`, with `duration` in seconds.
  - A spring becomes `CustomEase.create("edited", "<SVG path through the edited curve>")`. Inferred: GSAP has no
    spring in core, and `elastic.out(a, p)` is a different family.
  - A power3.out-like fit becomes the named ease.
- **Others (speculative mappings, verify before use):**
  - react-spring `config: { tension: stiffness, friction: damping, mass }`.
  - SwiftUI `.spring(duration:, bounce:)` shares Motion's bounce-to-damping mapping per Motion's code comment.
    Whether SwiftUI's `duration` means Motion's `duration` or `visualDuration` is unverified.

### Gaps
- I did not test whether coding agents apply these shapes correctly. Production sites like flora have no source
  file paths: react-grab's `source` was not available there, and I did not check this in this run.
- The library-detection evidence beyond Motion (GSAP `_gsap` caches and the like) is not verified here; a sibling
  note covers it.
- The react-spring and SwiftUI parameter equivalences are not sourced.

## Q6. Hands-on: the end-to-end loop on flora.so, run by execution

### Takeaway
The whole loop ran on the production site. It recorded two or more slides every frame and fitted
0.542–0.555 s / bounce 0.155–0.163 (truth 0.55 / 0.16). The edited spring (1.0 s, bounce .4) previewed as a WAAPI
`linear()` animation that overrode Motion from the first frame, played in slow motion, scrubbed, compared against
a ghost and handed back with no jump. The page then carried on with its own unchanged Motion spring, without a
reload.

### Cited Findings
- **[Verified]** Commands, run from `scripts/` (network to flora.so; Playwright resolves from the global
  node_modules):
  - `node fit-flora-sample.mjs fit-flora-samples.json fit-flora-fits.json` takes about 20 s and refits offline
    with `… reuse`.
  - `node fit-flora-preview.mjs fit-flora-preview.json` takes about 60 s.
  - `node fit-local-models.mjs`, `node fit-local-cascade.mjs > fit-local-cascade.json` and
    `node fit-motion-spring.mjs` need no network.
- **[Verified]** Observed page behaviour on 2026-11-25:
  - The track moves −288 px every 5000 ms (−288 → −576 → −864 …), with each move taking 550 ms.
  - It overshoots 2.22 px and snaps 0.32 px to the target at the end.
  - There are no WAAPI or CSS animations on the card.
  - The React props on the `motion.div` are `{transition: {type: "spring", duration: 0.55, bounce: 0.16},
    animate: {x: 0}, initial: false}`.
  - The task brief described a 3 s hold at −1152 → −1440. I saw a 4.45 s hold between moves, and positions depend
    on when sampling starts. The preview-run scrub replayed exactly −1152 → −1440.
- **[Verified]** Results summary:

  | Check | Result | File / section |
  | --- | --- | --- |
  | Fit vs ground truth | 16 fits: duration 0.542–0.555, bounce 0.155–0.163; spring preferred on BIC in all (ΔBIC 2.3–147) | `fit-flora-fits.json` → `fits`; `fit-flora-preview.json` → `fits`, `afterFits` |
  | Port vs Motion writes | time drift −0.32% / −0.22%, band 1.7–4.3 ms | `fit-flora-fits.json` → `portCheck` |
  | Duration-spring fingerprint | snap 559.6 / 560.1 ms after fitted t0, last step 0.322 px | `fit-flora-fits.json` → `snap` |
  | Motion owner | slide box x − track translateX constant within each move; steps +288 px one frame before each move | `fit-flora-fits.json` → `owner` |
  | Preview overrides Motion | same frame; 0.33 px from edited curve over 79 frames; Motion differs underneath in 53 | `intercept.checks` |
  | Cancel at same target | 0 px jump; computed = inline afterwards | `intercept.checks` |
  | `!important` as preview | priority dropped by Motion's next write | `important` |
  | Slow motion 0.25× | 179 ms advanced per 700 ms; error 0.40 px (edited), 0.81 px (ghost) | `replay.checks` |
  | Scrub (paused, 8 seeks) | within 0.10 px of both curves | `replay.scrub` |
  | Ghost + restore | exact restore, ghost removed, 0 animations | `replay.restored` |
  | Mid-move hand-back | cancel jumps 255.7 px; `composite: 'add'` blend 0 px, max 24.8 px/frame, converges | `handback.checks` |
  | Page unaffected after | next moves fit 0.5506 / 0.1604 and 0.5513 / 0.1608; no page errors | `afterFits`, `pageErrors` |

### Inferences
- The same loop works for any library that writes inline styles from the JS thread: record, find the owner, fit,
  then preview with WAAPI on the owner's written property. Libraries that animate through WAAPI or CSS
  transitions are covered by the same preview layer, as long as the preview is re-asserted when the page creates
  animations later (Q3).
- What Snapshot needs to change (speculative work list; none of it was done):
  - `sample()`: record every frame during change, use rAF timestamps, keep holds sparse, and sample several
    channels.
  - Add an owner search.
  - Run `fit-core` in a worker and store `fit` on the sampled animation.
  - Add a spring dial seeded from the fit.
  - Add preview modes (in place / next trigger), with speed and scrub wired to the preview animations.
  - Add a ghost outline.
  - Add `edit` plus a `motionChanges` entry on send.
  - Read back React props from the MAIN world when available, marked as untrusted page data.

### Gaps
- All runs were headless Chromium 158 at 1440×900 and 60 Hz. I did not test high-refresh displays (120 Hz rAF),
  background-tab throttling, or the real extension in Chrome, Edge or Dia.
