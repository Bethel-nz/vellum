# Vellum interface contract

How every surface in this repo must look, move, and behave. The document is the
interface: a markdown note you talk to, with agents, terminals, diffs, and captures
inline. Import tokens, never hardcode. Verify by execution, not by eye alone.

## Tokens (single source of truth: `ui/theme.ts`)

- Two opaque materials, no glass/blur: dark pane `#141414` on `rootTint #0a0a0a`,
  hairline `border #ffffff09`; light white pane on `#ececef`, hairline `#00000014`.
- Radii: `shellInset 4, radiusBase 10, radiusXl 14, windowRadius 18`. Nested corners
  share a centre via `concentric(parent, inset)` — never literal radii.
- Shadows: exactly one per surface via `elevation(m, level)` — popover `4/12 @45%`,
  card `8/20 @60%`, sheet `18/48`. Never raw `boxShadow`, never `withAlpha` by hand.
- Type: size + weight + leading only, no tracking. `body 14/22, user 14.5/23,
  meta 11.5/16, title 15/22, titleLg 17/23, label 12.5/16, caption 10.5/14,
  badge 10.5/12, mono 12/18`. Hierarchy must read title > body > meta. Draft and
  prose are always the darkest text; `textFaint` is decorative-only (separators,
  tracks, inactive dots) — functional text is `textMuted` or brighter (~2.3:1 fails).
- Colour roles: `accent` is agent/skill identity only, never focus, never links.
  `blue` is links/permission/selection. Semantic colours carry meaning
  (`success/warning/danger`, context Ring/Bar amber ≥70%, red ≥90%).
  Light `accent #693acf` stays separate from `blue #1447e6`.
- Reading column capped at 720 (`readingWidthFor`); prose never pays for chrome.

## Motion (`MOTION-CONTRACT.md` is authoritative; runner `components/spring.tsx`)

- Legal props only: `width,height,opacity,top,right,bottom,left,borderRadius`.
  No transforms, scale, rotate, blur, keyframes, gradients.
- Tokens only: `ease.{enter,exit,standard,inOut,material,spring}`,
  `duration.{instant .12, fast .16, exit .18, standard .24, considered .48}`,
  `stagger.item .035` capped at 4, entrances only. `leave()` uses `ease.exit`.
  All transitions via `tween()/enter()/leave()/wash()` (100 ms press/hover).
- The spring runner fades a shadow with its surface's opacity, so shadowed surfaces may
  fade; under reduced motion they close atomically. Menus, popovers, approvals and toasts
  unmount whole (MOTION-CONTRACT.md §6).
- Reduced motion: `tween()` collapses to duration 0 and layout must still be correct;
  keep one-shot confirmation in another channel, never remove feedback.
- Frequency governs motion: 100+/day paths (menus, palette, tag popup, keyboard
  toggles) enter ≤160 ms and close instantly; never animate keyboard-initiated
  actions. Occasional surfaces (sheets, panes) up to `considered`. One deliberate
  motion per surface. Interruptible always: retarget springs, no `isAnimating`
  guards, no `pointer-events:none` holds, transitions not keyframes.
- Streaming: first paint ≤200 ms from first delta; one row per block, the same
  streaming and finished, growing at natural ends; never animate streaming text; streaming pins the surface open and never steals
  composer focus.

## Hit-testing (six shipped bugs came from violating these)

- Position on a plain wrapper; animate the relative child. Motion wrapper
  `pointerEvents:'none'`, real surface `'auto'`. Outside dismissal via a plain
  `PopoverBackdrop` in the popup layer — never rely on a `motion.div` click.
- In-flight clicks are swallowed next to entrances: rows use `onMouseDown`
  (see `Menu.tsx:184,208,230`, TagPopup pattern). Click proxies must be plain.
- `closedByOutsidePress(key)` 250 ms guard stops trigger re-open.

## Icons (single family + named exceptions)

- Lucide 24-grid, stroke 1.75, round caps/joins (`ui/icons.ts`). All customs drawn
  at 1.75/round — no second weight. Sizes locked: xs 11, sm 12, md 14, lg 16,
  xl 18. `FileIcon` 14. Status dots 6, account dots 7.
- Brand marks are NON-TINTABLE: `claude`/`mcp` tint via `currentColor`;
  `codex` ships its own ink; `opencode` renders the PNG. Never pass `color` to
  force accent onto them (`brandMarks` guard). Language marks (`ui/langIcons.ts`,
  bundled Simple Icons) keep brand colours on their own white 40px field with
  hairline + `borderRadius 10` — white-only marks need a dark field in both
  materials. File-type glyphs come from the Nerd Font via `fileGlyph`, tinted
  from the `ansi` palette, never `syntax.*`.
- One meaning per glyph; active = colour change, never rotation; icon-only
  buttons carry `title`/`aria-label`; press = `wash()`, running = `Dot`.

## Primitives (picking wrong is the costliest mistake)

- Anchored popover (tag popup, menus, context card): `FloatingLayer` +
  `DismissableLayer` in a `position:relative` wrapper by the trigger; roomier
  side, x-clamped, height capped, internal scroll. Popovers close on Escape,
  outside press, blur. Reopening retargets; streaming pins open.
- Emulated floating window (GPUIX has one window): window-fill overlay,
  `pointerEvents:none` outside the panel, code comment citing the limitation.
  Closes on Escape/close control only; ignores outside + blur.
- Sheet/side panel: edge-docked, full-height, scrim press closes.
- State: `draft` owned by the reducer, copied field→state→field on every
  transition; only explicit send clears it. `STREAM_START` ignores dismiss.
- Composer textarea is transparent and borderless — the note IS the background.
  `⌘↵` sends, `↵` newline, `⇧⇥` cycles modes, `@/#/$/!` invoke. Chips render
  only when unfocused.

## Composition, states, voice

- Layout: flex only (`grid`/`flexWrap` don't exist in this GPUIX version — chunk
  grid rows in JS). Shell inset 4, strip 36, status 28 docked in its own row under
  the note (text ends above it, never under it, no edge fades; it steps back while
  you scroll and returns once the page settles), composer tail 160
  with `paddingBottom: 12`. Resize clamps; long content internal-scrolls, window
  never pushed. One focal point per surface; no card-per-fact, no gradients,
  no glow, no oversized radii/pills/shadows.
- Every control handles idle/hover/pressed/selected/focused/disabled(`.45`)/
  loading(inline, never spinner-as-page)/error(in place: what + recovery)/
  empty(one honest line + single next step). Truncation always has a full-value
  path (`ellipsis-start` keeps the distinguishing tail). Tabular numerals on
  anything that changes; `antialiased` on dark. Images carry own radius +
  inset outline. `Scroll` carries no padding; inner column + 6px thumb gutter.
- Voice: quiet, precise, second person, present tense. Buttons name outcomes
  ("Add 3 hunks to thread"). No exclamation marks, no confetti, no success
  toast for a visible save, no vanity stats.
- Keyboard is primary (`⌘K ⌘N ⇧⌘W ⌘1–9 ⌃⇥/⌃⇧⇥ ⌘↵ ⇧⇥ ⌃N/P ⌘. ⌘,`).
  Every pointer path needs a keyboard path. `role="dialog"` + `aria-label`;
  `DismissableLayer` owns Escape + focus in/restore; focus ring 2px `focusRing`
  offset 1; `aria-expanded` where launchers expand. Reduced-motion, 200% zoom,
  narrow window, light/dark, 1x/2x, keyboard-only are all gates.

## Verify before claiming done

- `bunx tsc --noEmit` — 0 errors. New errors block.
- `bun test ./core` — 121 pass, 1 skip, 0 fail.
- `scripts/check-*.ts` for every touched surface (motion, new-note, tokens,
  approval, width…) — all pass. `check-motion`'s toast step flakes under paused
  clock on baseline too; confirm against stashed baseline before blaming a change.
- Screenshots at matched sizes in both materials for visual work; paused-clock
  frames 0–260 ms for motion work; Before/After/Why table per polish, one row
  per issue, with the rule cited — never a list. Default to flagging; approval
  is earned.
