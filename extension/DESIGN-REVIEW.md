# Vellum Snapshot interface review

## Scope and coverage

Top selection strip, focus veil, multi-element selection, shared annotation, DialKit settings,
push confirmation, and the desktop current-note annotation shelf. The old bottom toolbar
and persistent vertical capture panel are superseded.

Sources inspected: Paper Snapshot's unpacked picker and rendered top strip; local DialKit
vanilla adapter, theme, keyboard and lifecycle implementations; Vellum's desktop material;
Arc's source components and motion tokens. Paper supplies the flow and bar shape,
DialKit supplies the control editor, and Vellum supplies colors and typography.

| Domain | Evidence | Coverage |
| --- | --- | --- |
| Accessibility | `src/content.ts`, `src/ui/CapturePanel.tsx`, DialKit vanilla controls | Named buttons, keyboard selection/fine-tuning, Enter, Esc, slider keyboard input, removal Undo and reduced-motion paths. VoiceOver not verified. |
| Layout | `src/overlay.css`, `src/ui/panel.css` | 48px strip, top-center placement, bounded settings and annotation popovers; dark/light and 320px rendered checks. |
| Writing | `src/ui/CapturePanel.tsx`, `src/content.ts`, `ui/Capture.tsx` | Pick, Continue, annotation and Push terminology; delivery confirmation only in extension. |
| Typography | `src/ui/appearance.ts`, `src/ui/foundation.css` | Bundled Geist/Geist Mono; selector disclosure; number formatting and plural rules. |
| Colors | `src/ui/foundation.css`, `src/ui/panel.css` | Desktop #141414 dark and #ffffff light surfaces; DialKit editor uses desktop material. |
| UI and motion | Arc Button, MotionConfig, vanilla DialKit animation helpers, overlay styles | Paper bar corners; soft rounded selection edges; short entrances; reduced motion respected by vanilla spring helper and CSS. |

## Findings and corrections

The bottom toolbar was the wrong direction and was replaced. Rapid clicking previously used
stale hover state; selection now hit-tests the click. Overlapping selection holes are merged
so nested selections do not invert the blur. Narrow popovers are centered independently of
the shorter bar to keep the annotation reachable. Annotation and selection borders are soft
and rounded. Floating element labels use the ID or accessible name, choose a free side, and
stay inside the viewport while avoiding the bar and open editor. DialKit's version/copy toolbar is hidden because it does not contribute to capture.

## Verification

- Focused extension Biome checks passed. Native changed files parse with Biome; two existing
  unused-import warnings in app.tsx remain outside this change.
- Isolated unpacked Chrome against a scratch bridge: pick/continue flow, two-element shared
  annotation, actual vanilla DialKit root, keyboard speed adjustment, light/dark theme,
  320px layout, reduced-motion preference, and real screenshot/annotation upload passed.
  Floating labels were checked at viewport edges; computed backdrop blur is 3px and selection
  corners are 8px. The CSS prefix/minification issue that had removed blur was corrected.
- Native existing browser check passed: annotation pen/shelf/inspector, browser connection,
  capture queuing during manual control and fake-agent delivery.
- No new repository tests, native app packaging or tsc were added/run.
- Not verified: VoiceOver, a full 200% zoom walkthrough, or slow-motion DevTools replay.

## Verdict

The inspected flow is functional. Accessibility and motion claims are limited to the source
and browser/native interactions above; this is not a complete screen-reader audit.

## 2026-10-25 direction update

The latest user reference supersedes the earlier blur treatment and shared-comment flow.
No focus veil is rendered. Comments anchor beside independent teardrop pins; element
labels open the side inspector. The toolbar check queues each saved annotation separately.
The local preview covered selection, individual comments, a live style edit, and sequential
extraction with a simulated worker. Production bridge delivery was not reverified.
