# Vellum Snapshot

Chrome/Edge Manifest V3 capture extension. Scaffolded with Vite+ `vite:application` using the vanilla TypeScript template. The selection engine uses the installed public `react-grab/primitives` package; no files are imported from `clones/`.

## Run

From `extension/`:

- `bun install` installs the locked dependencies.
- `bun run build` creates `extension/dist/`, the folder to load unpacked in `chrome://extensions`.
- `bun run dev` serves the capture popup for local UI work. Chrome APIs require the loaded extension.

The build runs Vite+ once for popup and service worker, then once for the classic injected content script. Both use Vite+ configurations. It performs no TypeScript build/typecheck.

The fixed extension ID is `bckocnpligjignaclimdoelhpobpjehh`. The public manifest key establishes its ID; no signing private key is retained. The app's allowed extension Origin must match.

## Interface

The launcher and injected toolbar share copied Arc Button, Textarea, Checkbox and SegmentedControl
components, with Arc motion tokens and Vellum's desktop material/Geist faces. Source attribution
and the retained MIT license are in `src/arc/`. The native library itself is unchanged.
The existing authenticated health response supplies the desktop theme. Local font buffers and
constructed shadow stylesheets keep the panel independent of page styling. The scoped design
review and verification boundaries are in `DESIGN-REVIEW.md`.

The browser action opens a compact toolbar centered 16px from the top. Pick an element
and leave its individual comment in an anchored composer. Saving leaves a numbered
teardrop at the click position and returns to picking. Numbers and unique refs remain
stable; the element name and reference appear inside the comment. There is no separate
floating tooltip. The default outline is 4px with 8px corners; fitting the element's
corner radii is optional. Settings expand DialKit below the comment in the same surface
using Arc's real-height spring and inner fade. The top stays in place while expanding;
controls scroll within available viewport space. There is no page blur or dimming.
Style edits, animation playback/timing, recording, screenshots, original-style comparison,
and sequential submission to the local queue remain available. Unsent annotations remain
available on failure. Authored style and timing changes accompany each element's comment.
There is no note picker, connection toast or hint paragraph in the injected interface.
The editor mounts inside the closed shadow root with the retained MIT license and theme.
The desktop pen beside the folder opens persisted annotations for the current note.

## Implemented

- Connect automatically to the desktop bridge on port 47470, checking nearby fallback ports only if needed. The service worker obtains its credentials through an endpoint restricted to the fixed extension Origin; there is no setup screen, pasted link or manual token. Credentials remain in worker memory and never reach page code.
- Note picker, active-note target and send/queue choice.
- On-demand injection with activeTab; no blanket content script, page host permissions or remote runtime code.
- Public selection primitives, closed shadow overlay, hover/lock, multiple annotations, arrow navigation and a separate comment for each element.
- HTML, computed CSS differences, pseudo styles, matching readable rules, used variables, fonts, layout, asset URL metadata and best-effort React context.
- Extracted CSS/WAAPI animation keyframes/timing, play/pause/rate/seek controls, optional five frame screenshots, pseudo-state forcing and release, two-second interaction sampling labelled inferred.
- Debugger-clipped element/context screenshots plus annotated page screenshot; debugger detaches and animation state restores in finally. Attach conflicts surface as actionable errors.
- Optional event listener source snippets through debugger; captures are multipart with the shared core/capture.ts schema. The extension confirms delivery without tracking agent replies.

## Verification and boundaries

- Focused Biome correctness check passed on all extension source/config/build files; all TypeScript source parsed with Bun's transpiler.
- Installed package 0.2.0 public primitive signatures inspected. Vite+ 1.1.0 native binding is installed and reports its version.
- The production Vite+ build passed and `dist/` is ready to load unpacked. Native bridge/queue/inspector checks and an isolated browser-wrapper smoke passed. A real unpacked Chrome session connected to a scratch bridge, selected a local animated component, extracted CSS/animations, captured debugger screenshots, and delivered the multipart capture successfully. No paid agent turn has been run.
- Cross-origin stylesheet rules and React source context depend on what Chrome exposes; computed styles remain available. Source context may be unavailable from Chrome's isolated content world.
- Up to 12 readable image/font assets are downloaded (1 MB each, short timeout); unavailable assets retain their URLs. Embedded-frame elements are explicitly blocked with a prompt to open the frame as its own page; debugger node lookup does not traverse frames. Closed shadow DOM may not expose selectable elements.
- The debugger's screenshot command is restricted to 8192 px per dimension and capture uploads to 45 MB. Select smaller areas if a very large page or animation exceeds those limits.
- Motion frames are snapshots of extracted animation objects. Arbitrary JS motion is sampled as a table, not falsely reconstructed as easing/keyframes.

Review fixes: arrow navigation replaces only the final selection and retains other selections/instructions; nonfinite animation timing values are serialized as strings (including Infinity); the entire interaction window observes and deduplicates Animation objects; extraction/seek bounds come from public selection primitives plus top-level scroll. Asset filenames use only the bridge-supported png/jpg/webp/svg/woff/woff2/ttf/otf suffixes.

## 2026-10-25 annotation flow update

Focused Biome checks passed. The local browser preview exercised picking, a live border
edit in DialKit, returning to the comment, saving two independent comments, and sequential
extraction. This preview uses a simulated worker; live debugger screenshots and delivery
to the running desktop bridge were not reverified for this update. No desktop app build
or new automated tests were run.

The local Motion specimen in review/MOTION-SAMPLE.md was recorded through the UI and
serialized using the production upload function to a sample receiver. It yielded two
opacity keyframes with computed spring easing and 122 movement samples. Production
bridge delivery and debugger screenshots were not reverified by this sample.

## 2026-10-27 editor controls and multiline composer

Document pointer events from the closed extension shadow root expose its host rather
than internal controls. The outside-pointer check now treats that host (or the whole
Snapshot surface in a normal DOM mount) as part of the annotation session. Opening
connection settings, element controls and nested DialKit popovers retains the draft;
clicking the surrounding page still dismisses the composer.

Removed the disabled microphone and the check/up icon switch: the save action always
uses a Central Icons checkmark. A single line stays in a compact pill. Multiline comments expand
into a 26px rounded panel: settings at the top left, the textarea between the icon
columns, and the circular arrow at the bottom right. The input has no border, shadow
or focus outline; the surrounding panel supplies its surface. A hidden, inert
textarea measures wrapping at the compact width, avoiding an expand/collapse loop
when the expanded body becomes wider. Text scrolls within 180px. The shared morph
spring animates panel size; reduced motion disables the size/radius transitions.
Width tracking uses the textarea's untransformed client width and schedules resize
work on the next animation frame. This avoids observer feedback from motion transforms.

Copy sits immediately right of the toolbar check in one compact action group.
It uses the same capture assembly as sending, across every selection, including saved
comments, the current draft, style/motion changes and source context. Copying preserves
the selections and queue. The clipboard contains readable annotation sections and
full JSON context; screenshot metadata is retained, while inline image bytes are
excluded. Async clipboard writes start in the click gesture while extraction resolves;
ordinary HTTP pages use the native copy-command fallback when needed. Success has a
brief check/status indication, and failure keeps the annotations available to retry.

Scoped Biome passed the two changed UI files. The production extension build passed
and refreshed dist/ (existing module-directive and chunk-size warnings remain).
A temporary local component fixture checked keyboard interaction in a closed shadow
root and pointer interaction in an open variant: settings and tweak/color popovers
preserved the draft; outside dismissal/reopen retained text; saving cleared the input
and restored the single-line shape. The revised multiline layout keeps the text between the settings and save controls,
with no overlap and a circular action. A real clipboard
round-trip from the UI included both fixture annotations, selectors and context; the
previous empty clipboard was restored. A focused serialization check covered drafts,
tweaks, screenshot metadata, image-byte omission and preservation of the source capture.
Inspected the composer screenshot. Temporary fixtures were removed;
live bridge delivery and a reloaded unpacked extension were not reverified here.
Repeated compact/expanded transitions and explicit line breaks passed a follow-up
browser check with no console errors after fixing a ResizeObserver delivery warning.

Composer children now use position layout correction to counteract the parent size
projection, keeping the controls and text undistorted during growth and clearing.
The textarea hides native scrollbars while retaining normal vertical scrolling.
The element editor, including its navigation and footer, uses the raised surface
color; DialKit inherits that same background.

A local component check sampled icon and button geometry through expansion to 14
lines and clearing back to one line: maximum aspect-ratio error stayed below 0.000003.
The textarea reached its 180px limit, scrolled from 155px back to 0, and reported no
visible scrollbar. The editor background and Central Icons save checkmark were
visually checked; no browser console errors were recorded. Scoped Biome passed.

The element-name navigation header is the editor's drag handle, with grab/grabbing
cursors and pointer capture. Dragging starts only with the primary button outside
the navigation buttons; it keeps the existing threshold and viewport bounds. Pointer
cancellation or capture loss ends the gesture. Dragging the header in a local component
fixture moved the panel from (316, 166) to (501, 211); clicking parent navigation then
incremented its callback without changing the position. No browser errors were recorded.

Drag positioning now lives in a ref and directly reuses the placement routine on
pointer movement. It does not commit React state per move, which previously caused
the comment field and buttons to animate their global positions after the panel moved.
Frame sampling reproduced roughly 78px of relative drift before the change, then 0px
for forward and reverse dragging after it. No browser console errors were recorded.
The existing child scale correction and comment resizing springs remain in place.

## 2026-11-25 Motion springs on production sites

Selecting an element whose motion comes from Motion (framer-motion / `motion`) on a React site
now reads the real transition and opens Animation with sliders in the source's own form:
`duration`/`bounce`, `visualDuration`/`bounce`, `stiffness`/`damping`/`mass`, or a tween curve.
A one-line note above the dials names the element Motion animates, since clicking into a card
usually selects text well inside it. Edits apply to the site's next move. Replay re-runs the last
move through Motion itself. The change goes to the agent as
`Motion transition on <element>: <before> → <after>`. CSS playback and timing dials stay hidden
when the element has no CSS or Web Animations for them to drive.

`src/page-motion.ts` runs in the page's own world through `chrome.scripting.executeScript({ world:
'MAIN' })`, called by the worker on the content script's behalf. It needs no new permissions and no
debugger. The worker accepts only known fields with finite values in range. The content script runs
these calls one at a time and coalesces slider drags. Results are page data, shown only.
The edit shadows `getDefaultTransition` on Motion's VisualElement instance. React re-renders
leave the instance alone, so the edit holds until `delete` restores the prototype method. Reset,
Discard, Remove, moving to a nearby element, Send, close and "Hold to view original" lift it.
Reopening and Undo put it back, even when React has replaced the selected element.

Limits: React with Motion only (the fiber shape holds from framer-motion 11 to 14). Transitions set
inside `animate` or a variant are shown as not editable yet. Replay needs one move after selection.
A move already under way keeps its spring. It relies on Motion internals that a release could change.
Background research and measurements are in `research_notes/Previewing JavaScript animation edits/`.

Verified with the built extension in Playwright's full Chromium (new headless):
`review/script-motion/motion-e2e.mjs` on flora.so. Baseline 2.22 px overshoot, settling in 532 ms.
Duration 1.5 / bounce 0.5 set from the keyboard gave 46.9 px / ~1466 ms on Replay (starting 120 ms
after the click) and on the next autoplay. Reset, close and Discard each returned 2.2 px / 532 ms, and
reopening restored the edit. The note for the agent read `{ bounce: 0.16, duration: 0.55, type:
"spring" } → { bounce: 0.5, duration: 1.5, type: "spring" }`. `review/script-motion/css-e2e.mjs`
confirms a CSS-animated element keeps its Playback and Timing dials. The test copy adds `<all_urls>` and
opens the shadow root, because automation can't click the toolbar button that grants activeTab.
Not yet run in headful Chrome, Edge or Dia.

### GSAP tweens

With no Motion element found, `page-motion.ts` looks for live GSAP tweens on the selection, its
ancestors and its descendants. It uses `window.gsap.getTweensOf` and picks a running tween first,
then a repeating one. Animation opens a Tween folder with Duration and an Ease menu of GSAP's
named eases, labelled exactly as written. A site's own ease is offered first. An edit sets the
tween's `duration()` and its parsed ease. Start values aren't re-recorded, so a running tween
doesn't jump. While an edit is on, `gsap.to/from/fromTo` are wrapped, so tweens the page creates
later on the same targets (a hover, a click) get it too. Revert restores every tween it touched and
unwraps the methods. Replay restarts the tween, or the top-level timeline it sits in. The note says
when a ScrollTrigger drives it instead. The agent gets
`GSAP tween (x) on div#loop.box: { duration: 1, ease: "power2.inOut" } → { duration: 2, ease: "power2.inOut" }`.
The worker accepts only GSAP's named eases with numeric parameters, or `custom`.

Limits: GSAP removes a one-shot tween once it finishes, so an intro animation that has already
played isn't found. A tween made through a timeline's own `.to()` after the edit, or through a
reference the page saved before the edit, keeps its timing. The parsed ease is the private `_ease`.

Verified with `review/script-motion/gsap-e2e.mjs`, a local page loading GSAP 3.15.1 from jsDelivr.
Duration 1 → 2 doubled the measured loop period (2000 → 4000 ms). Choosing `none` set the ease.
Reset and close restored 1 / `power2.inOut`, and reopening restored the edit. A timeline tween's note
says Replay restarts its timeline. A tween the page created after the edit got the edited duration.
Discard unwrapped the methods. There were no page errors. On gsap.com (GSAP 3.15.0), selecting a
tweened word on the "Get GSAP" button found its timeline tween (duration 1, GSAP's default
`power1.out`).

### Dropdowns inside Snapshot's panel

DialKit closes a dropdown on a document `pointerdown` whose target is outside it. From inside the
shadow root that target is the host, so every option press closed the list before its click, and no
dropdown in the panel could change its value. Iterations was affected too. `Dials.tsx` now stops
presses inside a dropdown at the editor. Keyboard navigation inside an open dropdown still loses
focus after the first arrow key, likely the same retargeting in DialKit's keyboard handling. It is
not fixed here.
