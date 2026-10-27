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
uses an up arrow. A single line stays in a compact pill. Multiline comments expand
into a 26px rounded panel: settings at the top left, a full-width textarea beneath,
and a separate footer with the circular arrow at the bottom right. A hidden, inert
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
and restored the single-line shape. The revised multiline layout placed the body below
settings and above the footer, with no overlap and a circular action. A real clipboard
round-trip from the UI included both fixture annotations, selectors and context; the
previous empty clipboard was restored. A focused serialization check covered drafts,
tweaks, screenshot metadata, image-byte omission and preservation of the source capture.
Inspected the composer screenshot. Temporary fixtures were removed;
live bridge delivery and a reloaded unpacked extension were not reverified here.
Repeated compact/expanded transitions and explicit line breaks passed a follow-up
browser check with no console errors after fixing a ResizeObserver delivery warning.
