# Vellum Agent Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is a draft plan for review; do not implement until the design is approved.

**Goal:** Show real browser work in a native inline Agent Screen that floats when scrolled away, backed by Vellum's bundled agent-browser tools and exact browser-target binding.

**Architecture:** Extend the existing wrapper, bridge, browser blocks and GPUIX viewer. One host runtime owns each note's session and command queue; a separate shared stream controller owns frames. The append-only log retains browser actions, while a presentation projection replaces generic browser tool rows with Agent Screen.

**Tech Stack:** Bun/TypeScript, React 19, GPUIX 0.11, Vellum's native components/motion, MCP/ACP adapters, Chrome extension MV3, pinned native agent-browser CLI.

**Spec:** [2026-10-27-agent-screen-design.md](2026-10-27-agent-screen-design.md).

## Global constraints

- Planning only until design approval. No paid agent turns, installs, app builds or feature code during this planning pass.
- Keep native GPUIX; reuse existing components, Central Icons and theme. The supplied DOM component is a visual reference.
- Start inline, auto-float only when the card has scrolled above view during active browser work, return inline on visibility, respect explicit minimization.
- One logical browser session per note; runtime generation distinguishes restarts. One owning note per verified external browser target. No frames in the event log.
- Bind toolbar tabs by verified browser-instance/target identity, never URL or last-focused-window guessing.
- Vellum owns the binary path, session, launch configuration and connection mode. Browser argv is not a shell script.
- Never terminate user-owned Chrome during disconnect. Keep managed and attached lifecycles distinct.
- Use scratch `VELLUM_HOME` and `VELLUM_CLAUDE_HOME` for checks. Run focused Bun tests only for meaningful runtime/reducer boundaries. Use scoped Biome, not `tsc`. Do not run plain `bun test` across clones.
- Keep changes local until explicit publication approval. Keep `clones/`, `.gitignore` and root Markdown out of commits. Save planning documents under `docs/plans/`, outside the excluded Superpowers directory.

## Review focus

1. Two identical URLs in different Chrome windows/profiles must never select the wrong toolbar tab — Tasks 1/5.
2. OpenCode/Codex nested code runners with both browser and non-browser children must retain unrelated results and failures — Tasks 4/6.
3. Scroll/drag/expand/minimize must not duplicate streams, steal focus or shift virtual-list positions — Tasks 7/8.
4. A stale generation, reused port, lost tab or detached external browser must never silently reconnect to another target — Tasks 3/5/7.
5. Stop/take-control/disconnect during an in-flight command, including another note claiming the same target, must leave no concurrent writers, orphaned process or stuck key — Tasks 3/9.

## Shared contracts

Create `core/browser-types.ts` for these new contracts; leave the capture format independent. Extend existing types compatibly rather than breaking old logs.

```ts
type BrowserKey = { noteId: string; session: string; generation: string }
type BrowserPhase = 'idle' | 'starting' | 'ready' | 'working' |
  'waiting-user' | 'disconnected' | 'closed' | 'error'
type BrowserPlacement = 'inline' | 'floating' | 'expanded' | 'minimized'
type ToolbarTarget = {
  key: string; installationId: string; toolbarId: string;
  tabId: number; windowId: number; targetId?: string;
  url: string; title: string; receivedAt: number
}
type BrowserBinding =
  | { mode: 'managed'; owned: true }
  | { mode: 'toolbar'; owned: false; targetKey: string; targetId: string }
type BrowserCommandInput = { args: string[]; title?: string }
type BrowserCommandResult = {
  key: BrowserKey; actionId: string; exitCode: number;
  stdout: string; stderr: string; data?: unknown; artifacts: BrowserArtifact[]
}
type BrowserArtifact = {
  id: string; path: string; mime: string;
  kind: 'screenshot' | 'video' | 'download' | 'pdf' | 'trace' | 'har' | 'other'
}
```

`BrowserSession` gains optional `generation`, `phase`, `mode`, `targetId` and `lastActionId`. Persist only non-secret identifiers; the live registry owns endpoints and credentials. Keep the old `streamPort` field readable for migration, but do not reconnect from it without current validation.

Host-authoritative `BrowserEvent` is a discriminated union: `session` (key, phase, binding summary, sanitized error), `action-start` (key, actionId, toolCallId?, title, safe argument summary), `action-end` (key, actionId, exitCode, durationMs, redacted result, artifacts), and `artifact` (key, actionId, artifact). Every event includes `at` and optional host-generated `runId`. Omit sensitive argv values from the new browser journal and display summaries. Existing raw ACP/MCP persistence is unchanged and may retain actual tool inputs/results; do not claim transcript-wide redaction. Keep endpoint credentials out of the new event model.

## Task 1 — Prove the installed CLI and CDP identity contract

**Files:** Create `docs/agent-browser-compatibility.md`; create a disposable `spikes/agent-browser-compat.ts` only if needed. Inspect existing `scripts/check-browser.ts` first.

**Interfaces:** Produces the pinned version/capability table and an exact, verified target-selection sequence for Task 5.

- [ ] Read the pinned binary's help for stream, tab, connect, record, profiler, network, React and WebMCP commands. Start from the observed 0.39.1; record differences from website docs.
- [ ] In a dedicated scratch session, verify stream `frame`, `status`, `url`, `command`, `result`, `error` and tab messages, ACK behavior, and whether the frame callback is accepted synchronously by GPUIX `setImage`.
- [ ] In a disposable Chrome profile with two windows and repeated URLs, prove extension `getTargets()` identity matches the approved CDP endpoint's target list. Verify `tab <targetId>` plus strict pinning and behavior when the tab disappears. Do not enable remote debugging on the user's real profile for this probe.
- [ ] Verify how Snapshot capture attachment interacts with an agent-browser CDP session and whether external `close` only detaches. No endpoint/attachment guess may ship as “supported.”
- [ ] Record a capability gate: if exact existing-toolbar binding cannot be proven, mark that mode unavailable and resolve it before claiming the whole feature complete. Managed-browser work can proceed independently.

## Task 2 — Bundle and resolve the actual CLI

**Files:** Modify `core/browser.ts`, `scripts/build-app.ts`; create `scripts/agent-browser-runtime.ts` and `assets/agent-browser/manifest.json`; update `packager.json` only if helper inclusion needs it.

**Interfaces:** `browserExecutable(): string`; `prepareAgentBrowser(target: {platform: string; arch: string}): Promise<{path: string; version: string; sha256: string}>`.

- [ ] Pin a verified official binary and checksum per supported packaging target. Record attribution/license with the shipped dependency. Do not copy an unchecked PATH executable into a release.
- [ ] Resolve compiled builds to the bundled helper and development to an explicit override or the verified developer binary. Share that resolver with launch and cleanup.
- [ ] Package the real binary alongside `helpers/browser`; mark executable before signing. Do not add a Node dependency if the native binary is sufficient.
- [ ] Add clear setup results for missing Chrome and optional ffmpeg. `--help`/`--version` must work from an app path containing spaces with a restricted PATH.
- [ ] Verify resolver/checksum behavior with a stub executable. Defer the actual packaging build to the final release smoke check, not each task.

## Task 3 — One runtime and command queue per note

**Files:** Extend `core/browser.ts`; create `core/browser-runtime.ts`, `core/browser-types.ts`; modify `scripts/browser.ts`, `core/bridge.ts`, `core/agent.ts` and browser cleanup call sites in `App.tsx`.

**Interfaces:**

```ts
browserCommand(noteId: string, input: BrowserCommandInput,
  context: { signal: AbortSignal; toolCallId?: string; runId?: string }): Promise<BrowserCommandResult>
browserSession(noteId: string, input: {
  action: 'status' | 'connect' | 'disconnect' | 'targets';
  mode?: 'managed' | 'toolbar'; targetKey?: string
}): Promise<BrowserSession | ToolbarTarget[]>
subscribeBrowserEvents(listener: (event: BrowserEvent) => void): () => void
stopBrowserSession(noteId: string): Promise<void>
```

- [ ] Keep registry state outside React: connection ownership, generation, command queue, subprocess, stream endpoint and artifacts. Reserve external targets globally by verified endpoint identity plus target ID, not merely by per-note session name. Managed sessions use `vellum-<noteId>` and a Vellum-owned namespace/configuration.
- [ ] Spawn argv arrays with the resolved binary; inject Vellum-owned options and remove conflicting inherited agent-browser ownership variables. Never parse a command string or inherit unreviewed project plugin/launch settings.
- [ ] Normalize default screenshot/download/recording/trace paths into this note's artifact area. Track explicit output paths too; validate real paths before loading files into the app. Return machine output separately from human summaries.
- [ ] Make `scripts/browser.ts` call the authenticated note-scoped `/browser/execute` bridge route and preserve exit/stdout/stderr. Native tools call the same runtime directly. Both paths emit one action record.
- [ ] On error, emit action-end and release the queue. On cancellation, interrupt/terminate the CLI and reconcile daemon work before declaring it idle. Implement bounded cleanup; externally attached browsers are detached, not killed.
- [ ] Add focused runtime tests for argv with spaces/quotes, option conflicts, simultaneous calls, cancellation, generation rollover, failed startup and owned-versus-external cleanup. These boundaries justify tests; no layout tests here.

## Task 4 — Native tools for all three providers

**Files:** Create `core/browser-tools.ts`; modify `core/bridge.ts`, `core/tools.ts`, `core/prompt.ts`; reuse `scripts/vellum-mcp.ts` transport rather than adding another provider integration.

**Interfaces:** `browserTools` tool definitions and `browserCall(noteId, name, args, context): Promise<McpResult>` using Task 3's context. Add trusted `ToolCall.presentation?: {kind: 'browser'; session: string; generation: string; actionId: string}`.

- [ ] Register `browser` and `browser_session` schemas from the design. Validate nonempty argv and argument types; the optional title changes display only. Keep CLI capability access without authoring hundreds of duplicate typed action schemas.
- [ ] Attach correlation metadata before reporting a running call. Preserve the existing bridge child/parent IDs so calls made inside an execute tool can be recognized without parsing its JavaScript.
- [ ] Return actual text/JSON/image results to the agent. Browser-specific UI suppression must never remove results from model context. Emit typed unsupported-capability/target-gone errors.
- [ ] Update prompt guidance from “use the shell browser command” to native tools first, compatibility wrapper second. Explain managed versus explicitly selected Chrome, fresh snapshots/refs and untrusted website content. Include the current host-generated run ID in browser events so thinking gaps do not end the browser-work epoch.
- [ ] Validate protocol fixtures for Claude, Codex and OpenCode, including dynamic-args loops inside a code runner, malformed arguments and a browser error before the first frame. Do not run a paid turn for fixture validation.

## Task 5 — Snapshot toolbar presence and exact CDP attachment

**Files:** Modify `extension/src/messages.ts`, `content.ts`, `background.ts`, `bridge.ts`; create `core/browser-targets.ts`; modify `core/bridge.ts`, `ui/BrowserSettings.tsx`, `core/browser-runtime.ts`.

**Interfaces:** `recordToolbarPresence(presence, receivedAt): void`, `listToolbarTargets(): ToolbarTarget[]`, `bindToolbarTarget(noteId: string, targetKey: string): Promise<BrowserBinding>`.

- [ ] Add toolbar-open/closed messages and 15-second heartbeats only while visible. Worker derives sender tab/window IDs, installation identity and target mapping. Handle removal, navigation and service-worker restart. Host expires reports after 45 seconds.
- [ ] Add an extension-owner-authenticated `/browser/targets` presence route. Note-scoped agents can list eligible target summaries but cannot forge extension presence or supply arbitrary CDP endpoints through the tool.
- [ ] Show a small target chooser if multiple toolbars are open. “Use this tab” explicitly binds the selected target to the current note. Preserve the selected tab when Chrome focus changes. Reject a second note with `target_in_use`; an explicit “Move here” waits for old command/control ownership to finish, detaches the old session and atomically transfers the target claim.
- [ ] Use the compatibility-proven sequence to attach, select exact CDP target ID and enable strict pinning. Verify ID against the chosen browser endpoint. Never substitute another tab after `tab_gone`, `tab_locked` or a failed reconnect.
- [ ] Coordinate capture ownership using the mechanism proven in Task 1. A capture operation never detaches someone else's debugger session. Show “Chrome not available for control” and managed alternative when needed.
- [ ] Test duplicate URLs, multiple installations/windows, stale presence, closed targets, endpoint mismatch and disconnect without closing user tabs. Test two notes competing for the same target and a transfer while the first note holds manual control; only one owner may issue input. Report shared-cookie behavior for external mode accurately.

## Task 6 — Append-only events, one browser embed, no duplicate cards

**Files:** Modify `core/threads.ts`, `core/tools.ts`, `core/bridge.ts`, `ui/blocks.tsx`; create `core/browser-presentation.ts`; extend existing `core/acp-reduce.test.ts` only for these invariants.

**Interfaces:** `projectBrowserActivity(blocks: Block[]): BrowserActivityProjection`; `BrowserActivityProjection` supplies browser block overrides and a set of trusted browser action/tool IDs to suppress from generic presentation. Original blocks remain unchanged.

- [ ] Add `vellum/browser-event` records carrying the Task 3 union. Generate a browser block at first action using session plus generation as stable identity; patch only the derived block on subsequent events. Derive the current browser-work epoch from its run ID and note runner/wait state, separately from per-command phase; completion ends only the automatic-floating eligibility. Preserve existing raw event policy while keeping new summaries value-redacted.
- [ ] Keep legacy browser records readable. Old cards start “Last capture,” with no port-driven live reconnection. Do not rewrite old log files or move existing virtual-list rows.
- [ ] Use trusted provenance, not command substrings, for generic-card suppression. Preserve non-browser siblings, thoughts, approvals and failures from mixed code runners. Empty generic groups render no header/count.
- [ ] Put command details and artifacts behind Agent Screen's activity/details control. At first browser startup failure, display a real error/retry state even though no stream exists.
- [ ] Test replay idempotence, duplicate completions, two generations, mixed runner success/failure, generic Bash mentioning “browser,” stale ports and stable timeline row IDs. Verify that browser summaries omit fill values without falsely claiming raw tool inputs were redacted, and that thinking gaps do not flicker the browser-work epoch.

## Task 7 — Shared live stream controller

**Files:** Extend `core/browser-stream.ts`; create `core/browser-view.ts`; refactor `ui/BrowserBlock.tsx` to subscribe rather than own independent sockets.

**Interfaces:** `watchBrowser(key: BrowserKey, subscriber: BrowserViewSubscriber): () => void`; `setBrowserDemand(key, {placement, visible, focused}): void`; `sendBrowserInput(key, input): void` requires the user-control lease from Task 9. `BrowserViewSubscriber` has `frame(BrowserFrame)` and `state(BrowserViewState)` callbacks.

- [ ] Own one stream connection per generation with latest-frame buffering. Preserve capture timestamp, viewport/scale metadata and actual image dimensions separately; setImage does not drive per-frame App React state.
- [ ] Apply ACK pacing from the initial URL. ACK after frame submission succeeds; do not build a queue while the renderer stalls. Bound payload sizes and reject invalid dimensions/frames without a reconnect storm.
- [ ] Route status, URL and relevant tab events to the current session. Runtime events remain authoritative for command history; reconnect telemetry cannot duplicate action records.
- [ ] Compute demand once: inline/floating 4 FPS, expanded 30, unfocused 1, no visual connection while minimized. Preserve last image and reconnect only against the validated registry generation.
- [ ] Extend the existing fake stream check for slow rendering, reconnect, tab/viewport changes, missing metadata, static pages, duplicate subscriptions, last-frame retention and port reuse. Confirm one connection survives inline/float/expanded moves.

## Task 8 — Native inline/floating/expanded Agent Screen

**Files:** Refactor `ui/BrowserBlock.tsx`; create `ui/AgentScreen.tsx`, `ui/AgentScreenHost.tsx`; modify `App.tsx`, `ui/blocks.tsx`; reuse `ui/ImageViewer.tsx` overlay conventions and `components/motion`/`spring`. Extend `components/TabStrip.tsx` only if its existing trailing slot is insufficient.

**Interfaces:** `AgentScreen({session, placement, onExpand, onMinimize, onReturnInline})`; `AgentScreenHost` owns ephemeral placement and drag bounds, reads Task 7 state and receives inline-slot visibility from the note's list.

- [ ] First action renders an inline framed viewport at the existing browser block. Use viewport ratio, `objectFit="contain"`, theme surfaces, Central Icons, a genuine connecting/error/last-capture state and actual page title/origin. No fake cursor or decorative browser URL.
- [ ] Track the inline slot using stable virtual-list item identity and the note's row visibility, including virtualization unmounts. Preserve its height while floated. Auto-float only when the slot is above view and the current browser-work epoch is active, including between actions and while waiting for the person; return when at least half visible. Normal turn completion minimizes an automatically floated view but preserves an explicitly pinned float. Hold a 16px edge hysteresis and debounce visibility decisions by 120ms.
- [ ] Float starts at 340px width, shrinks on narrow windows and stays 16px inside the note content bounds. Header drag captures at window level. Navigation/controls are excluded; direct parent positioning avoids the extension's recent follow-and-settle regression.
- [ ] Manual dragging pins the floating placement. Return-inline clears that pin. Dismiss sets minimized for this generation; subsequent browser actions do not undo it. Top-bar icon restores the prior surface without scrolling the note unexpectedly.
- [ ] Expanded uses the native dismissable layer and fits the full viewport. Escape/collapse returns to the previous placement. Watching never steals keyboard focus or forwards input. Shared frame/controller survives placement changes.
- [ ] On note switch, show only the active note's float/icon; keep background jobs in their own session. Browser and simulator can coexist without either stealing the other's stream or input.
- [ ] Visually check dark/light themes, reduced motion, tiny/tall pages, small window, scroll thresholds, minimized state and dragging. No new unit tests for colors/padding. Verify there is one live surface and no layout shift or child drift.

## Task 9 — Honest user-control ownership

**Files:** Extend `core/browser-runtime.ts`, `core/browser-view.ts`, `ui/AgentScreen.tsx`, `App.tsx` runner interruption/queue handling.

**Interfaces:** `requestBrowserControl(noteId: string): Promise<void>`, `releaseBrowserControl(noteId: string): Promise<void>`. The first resolves only once no browser action is still executing and queued agent actions cannot start.

- [ ] Reuse the note interruption path, then acquire an exclusive runtime control lease. Show pending state until acknowledged; do not enable clicks merely because `interrupt()` was called.
- [ ] Forward input only under that lease, mapping through the contained image content rect rather than the full frame including letterboxing. Apply verified viewport scale/offset metadata.
- [ ] Track pressed keys/buttons and release on hand-back, blur, disconnect or viewer teardown. Hand-back permits new commands but never automatically repeats an interrupted action.
- [ ] Test take-control during long-running actions, queued commands, lost socket, letterboxing, Escape and close while a button is held. If upstream cancellation cannot be verified, remain pending rather than pretending the agent stopped.

## Task 10 — Feature coverage, artifacts and diagnostics

**Files:** Extend `core/browser-runtime.ts`, `core/browser-tools.ts`, `ui/AgentScreen.tsx`, `ui/BrowserSettings.tsx`; create `docs/browser-tools.md`; update `core/prompt.ts` only for verified behavior.

**Interfaces:** Use Task 3's `BrowserArtifact` classification and the verified CLI capability manifest. No second command engine or plugin protocol implementation in Vellum.

| User-supplied feature documentation | Vellum treatment |
| --- | --- |
| [Streaming](https://agent-browser.dev/streaming) | Shared native viewer and paced frames. |
| [Recording](https://agent-browser.dev/recording) | Real video artifacts; ffmpeg prerequisite; no pretend teaching UI. |
| [WebGPU](https://agent-browser.dev/webgpu) | Explicit launch preset/capability; document per-platform capture limitations. |
| [Debugging](https://agent-browser.dev/debugging) | Console/errors/trace/inspect through argv; concise status and saved traces. |
| [Profiler](https://agent-browser.dev/profiler) | Save profile as artifact; no Vellum trace analyzer. |
| [React](https://agent-browser.dev/react) | Configure hook before navigation; expose inspection commands. |
| [Files](https://agent-browser.dev/files) | Screenshots/PDF/download/upload/clipboard with real paths and original results. |
| [Init scripts](https://agent-browser.dev/init-scripts) | Trusted explicit configuration; distinguish startup scripts from future-document runtime scripts. |
| [Proxy](https://agent-browser.dev/proxy) | Advanced launch configuration, sensitive values kept out of viewer/log summaries. |
| [Security](https://agent-browser.dev/security) | Preserve content boundaries and existing approvals; check incompatible options by mode. |
| [Plugins](https://agent-browser.dev/plugins) | Deliberate trusted configuration; no automatic plugin installation. |
| [Selectors](https://agent-browser.dev/selectors) | Keep upstream locator/ref syntax intact. |
| [Snapshots](https://agent-browser.dev/snapshots) | Return actual accessibility text/refs to the model, not the viewer image alone. |
| [Sessions](https://agent-browser.dev/sessions) | Note-scoped managed session; honest external-tab storage sharing. |
| [Dashboard](https://agent-browser.dev/dashboard) | Use protocol knowledge; don't embed another app or start dashboard automatically. |
| [Diffing](https://agent-browser.dev/diffing) | Structural/visual comparisons and output artifacts remain accessible. |
| [Network](https://agent-browser.dev/network) | Routes/requests/HAR through CLI; HAR stays a potentially sensitive local artifact. |
| [CDP mode](https://agent-browser.dev/cdp-mode) | Explicit verified toolbar-target attachment and strict pinning. |
| [WebMCP](https://agent-browser.dev/webmcp) | Preserve discovery updates and schema retrieval before invoke; website metadata stays untrusted. |
| [Commands](https://agent-browser.dev/commands) | Preserve supported action families; reserve Vellum ownership/process-management options. |
| [Configuration](https://agent-browser.dev/configuration) | Generated deterministic defaults plus deliberate advanced settings. |

- [ ] Publish exact native tool examples for browser navigation, test flows, snapshot/refs, screenshots and diagnostic artifacts. Explain when a stream is only a visual view, not the agent's textual snapshot.
- [ ] Classify outputs using successful structured results and verified files; don't regex arbitrary stdout into local image paths. Handle an unchanged screenshot that returns no new file and downloads saved remotely under external CDP.
- [ ] Apply launch settings before starting a session. Never silently relaunch an external browser to add hooks/extensions/WebGPU. State unsupported feature/mode combinations accurately.
- [ ] Document ownership overrides reserved by Vellum: session/namespace/connection/profile/restore, binary path, stream binding, upstream install/upgrade/dashboard/chat/plugin-management operations. Normal browse/inspect/record commands remain exposed as capability-checked argv.
- [ ] Finish with a concise command-to-artifact matrix and known limitations. No new UI panel for every upstream feature.

## Task 11 — Integration checks and logical delivery

**Files:** Update `scripts/check-browser.ts`; add focused `core/browser-runtime.test.ts`, `core/browser-targets.test.ts`, `core/browser-presentation.test.ts` as required by Tasks 3/5/6; update `docs/browser-tools.md` and `docs/agent-browser-compatibility.md`.

- [ ] Run only the focused runtime/target/presentation tests and existing affected reducer tests: `bun test ./core/browser-runtime.test.ts ./core/browser-targets.test.ts ./core/browser-presentation.test.ts ./core/acp-reduce.test.ts` using temporary Vellum homes.
- [ ] Run `bun scripts/check-browser.ts` with its scratch home/fake stream; update checks to prove inline → auto-float → inline, explicit minimize, expand, one stream, failure display and correct control ownership.
- [ ] Run scoped Biome from the correct root for each package. Never run the root TypeScript build script as a substitute for this check.
- [ ] Perform one real disposable managed-browser flow and one explicitly authorized toolbar-tab flow. Verify saved images match the browser being shown, no generic-card duplicates, no user-tab closure and no leftover owned processes.
- [ ] Verify all three providers first with protocol fixtures. A paid real provider turn remains a separate user-approved check; report fixture verification separately.
- [ ] At packaging time only, run the necessary app/extension builds. Smoke the packaged app with a restricted PATH so the bundled CLI is proven; verify missing Chrome/ffmpeg setup messages, version/checksum and executable/signing paths. No repeated builds during visual iteration.
- [ ] Commit by deliverable: CLI/runtime; native tools and event projection; toolbar/CDP binding; shared stream/viewer; ownership/artifacts and verification. Exclude root Markdown, clones and `.gitignore`; no push or publication implied.

## Acceptance walkthrough

1. A note invokes native `browser` to open a page. One inline Agent Screen appears; the agent receives real results.
2. Snapshot/click calls update its quiet activity. No duplicate generic tool cards appear.
3. Scroll past the card while work runs: a mini frame appears without jumping the document. Scroll back: it docks.
4. Drag, expand, minimize and reopen: frames continue from the same controller and no input is sent while watching.
5. Explicitly bind one of two identical toolbar URLs in different windows. Commands and stream remain on the selected target even when Chrome focus changes. Closing that tab produces an error, not a target switch.
6. Take control during agent activity. Input remains disabled until the agent's browser command has stopped; hand-back releases all held input.
7. Close a managed note: owned session stops. Close an external note: user Chrome and its tabs remain open.
8. Reopen history: old browser work is readable, its last capture is static, and no stale session/port is revived.

## Review and execution handoff

The user confirmed inline first with scroll-triggered floating and delegated the remaining UX judgment. Tool/runtime boundaries, explicit CDP setup, lifecycle, recording scope and packaging defaults remain proposals for design review. Read both documents, settle material compatibility findings, then approve before implementation. No application/extension source was changed while preparing this plan.

## Planning review record

A read-only builder review found two material gaps, now resolved in this draft:
external targets have exclusive cross-note ownership with explicit transfer, and
redaction is scoped to the new browser journal/presentation rather than promising
changes to existing raw provider-event retention. Self-review also separated
turn-wide browser-work eligibility from millisecond CLI action status, avoiding
auto-float flicker between commands. These are proposed implementation defaults,
not claims that the feature has been built or live CDP compatibility proven.
