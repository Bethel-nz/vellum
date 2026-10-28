# Vellum Agent Screen — design proposal

Date: 2026-10-27. Status: proposal for review; no feature implementation authorized by this document.

## Intent

Let the person watch browser work without reading a wall of tool calls or constantly switching to Chrome. Vellum remains a native GPUIX document workspace. The browser is a real agent-browser session whose viewport is streamed into a Vellum frame; it is not a web page embedded in a new browser engine, and it is not a stream of the user's desktop.

The user supplied an AgentScreen React reference and the agent-browser feature documentation. Preserve the reference's framed preview, expand/collapse, loading state and quiet controls. Implement with Vellum's kit, Central Icons, theme and custom motion. Do not port its DOM portals, Tailwind classes, fake cursor, placeholder desktop, example URL or simulated recording controls.

## Confirmed presentation

- The first browser action creates an inline Agent Screen at that point in the note.
- While browser work is active, scrolling the inline card above the viewport moves the live view into a small floating frame. Scrolling back returns it inline.
- The frame can be expanded and dragged by its title bar. Dragging must move its contents together, without child springs trailing behind.
- Dismissing the floating frame minimizes it to the top-bar browser icon. It must not immediately float again. The icon reopens it.
- Normal browser calls do not render individual generic tool cards. The underlying actions and results remain available in history and in Agent Screen details.
- The top-bar icon appears when the active note has a starting, attached, running, waiting-for-user or recoverable browser session. Old restored records alone do not show a live icon.
- This works identically for Claude, Codex and OpenCode.

## What exists today

Verified from the current checkout, not inferred from the older plan:

| Source | Existing behavior and required change |
| --- | --- |
| `scripts/browser.ts`, `bin/browser` | Note-scoped CLI wrapper, stream discovery, bridge reporting, screenshot paths. Still launches `agent-browser` from PATH and blocks CDP. |
| `core/browser.ts` | Set of remembered note IDs and fire-and-forget process cleanup. Needs actual runtime ownership and awaited cleanup. |
| `core/browser-stream.ts` | WebSocket frames, URL updates, ACK pacing, FPS changes and reconnect. Needs shared ownership, lifecycle/status messages and bounded frame handling. |
| `core/capture.ts`, `core/threads.ts` | Browser session type and one updatable browser block per session. Extend compatibly; keep the append-only event log. |
| `ui/BrowserBlock.tsx` | Inline live card and full-window viewer. Each surface currently opens its own socket. Replace the duplicated ownership with one viewer controller. |
| `App.tsx`, `ui/blocks.tsx` | Browser viewer overlay, event replay and tool grouping. Add the visibility/float host and browser-specific presentation. |
| `core/bridge.ts`, `core/mobile-tools.ts` | Existing native tool registration, note scoping, execution reporting and nested tool correlation. Reuse those paths. |
| `extension/src/background.ts`, `content.ts`, `messages.ts` | Snapshot toolbar and temporary debugger attachment for captures. No reliable toolbar-presence/CDP pairing model exists yet. |
| `scripts/build-app.ts` | Ships the wrapper but does not bundle the actual agent-browser executable. |

The installed CLI reports `agent-browser 0.39.1`. The V2 plan already proposed 4 FPS inline / 30 FPS expanded and a real frame viewer. Preserve its useful work; this document supersedes its shell-command sniffing and presentation assumptions. The existing screenshot crop bug is separate and remains unresolved.

## Approaches considered

| Approach | Tradeoff |
| --- | --- |
| Keep shell detection and restyle BrowserBlock | Least code, but nested OpenCode code runners, mixed shell commands and provider aliases make action recognition unreliable. |
| Embed upstream's dashboard | Supplies diagnostics, but adds web UI hosting to a native app and duplicates Vellum's note, account and permission surfaces. |
| Native browser tools + shared runtime + native Agent Screen | Recommended. More deliberate runtime work, but one authoritative action stream and the same behavior across all three agents. |

The third approach is the draft architecture, proposed for approval. The user has confirmed the inline-to-floating direction; they have not yet approved all implementation choices below.

## Runtime and tool contract

Expose two built-in MCP tools through the existing note-scoped Vellum server:

1. `browser`: `{ args: string[], title?: string }`. `args` is one agent-browser invocation, passed as argv rather than parsed as a shell script. Examples: `["open", "https://example.com"]`, `["snapshot", "-i"]`, `["click", "@e3"]`. Optional title is presentation only; derive a reliable fallback from command arguments.
2. `browser_session`: `{ action: "status" | "connect" | "disconnect" | "targets", mode?: "managed" | "toolbar", targetKey?: string }`. Connection selection is separate from browser commands. An omitted mode uses a managed browser unless this note already has an explicitly bound toolbar target.

Both the tool and the existing `browser` executable call the same host runtime. The shell executable becomes a compatibility client of that runtime, preserving stdout, stderr and exit status. No independent shell-launched session and no duplicate bridge reporting. AgentBrowser is the browser engine dependency; Vellum's runtime owns routing, identity, session options, artifacts and presentation.

One logical session per note, named `vellum-<noteId>`, plus a generation token whenever a stopped session starts again. A verified external browser target has one owning note/generation across Vellum, keyed by browser endpoint identity plus target ID. A second note receives `target_in_use` and the owning note reference. An explicit “Move here” action waits for that owner's in-flight action and user-control lease to end, detaches the old session, then transfers the claim; it never permits two writers. Serialize commands within a session. Different notes can operate independently. Generate action IDs and session metadata in Vellum; never trust model-supplied URLs/titles as a routing identity. A title can be absent or inaccurate without changing what is executed.

Vellum supplies a pinned binary path, session/namespace, stream setup, artifact directories and the selected connection mode. No model override of those ownership options. Preserve command-specific options and document the narrow list of Vellum-owned/global management operations. This wrapper is not a sandbox against an agent that can independently execute shell commands.

## Detecting the toolbar's actual Chrome tab

Toolbar presence is not CDP access. Extension tab/window IDs are scoped to a Chrome profile, and a URL is not a unique tab identity.

Have the extension report its installation ID, toolbar instance ID, `tabId`, `windowId`, optional debugger `targetId`, URL, title, open/closed state and a heartbeat while the toolbar is open. Derive tab/window values from the extension's trusted sender; do not accept page-supplied values. The host adds its receive timestamp. Expire presence after 45 seconds without a 15-second heartbeat, and revoke it on close/removal/disconnect. Keep a list if several toolbars are open; never choose by matching URL or whichever Chrome window became focused last.

When the person explicitly selects “Use this Chrome tab,” bind that target to the note. Discover an approved local Chrome CDP endpoint, enumerate targets, and verify the reported target ID against that endpoint before selecting it. Upstream supports CDP target IDs as tab refs and strict pinning. Explicitly select the matching tab after connection: `--pin-tab` on an unbound session alone can open a fresh tab. After binding, tab loss must fail rather than silently act on another tab. [CDP mode](https://agent-browser.dev/cdp-mode), [commands](https://agent-browser.dev/commands), [Chrome debugger target information](https://developer.chrome.com/docs/extensions/reference/api/debugger).

If that Chrome profile does not expose a usable CDP endpoint, show a concrete connection state and the managed-browser alternative. Do not restart the user's Chrome, copy its profile, equate extension permission with remote-debugging access, or invent a general CDP relay through `chrome.debugger`. Full extension-to-CDP relay work is a separate project if the direct endpoint approach cannot meet the requirement.

Coordinate Snapshot's temporary screenshot debugger attachment with the bound session. A capture must either use the existing controlled connection or acquire an exclusive capture lease; it must not steal/detach another owner's debugger. Prove the supported behavior before shipping this mode.

## Event log, identity and tool presentation

Keep the note's raw ACP/MCP events under the existing persistence policy. Those payloads may include tool input/output values; this proposal does not promise credential-free transcripts or add a global redaction migration. Redaction below applies to the new browser activity summaries and journal, not to already-retained raw provider events. Prefer upstream credential resolution over supplying secrets in argv where supported. Add typed browser lifecycle/action events with `noteId`, logical session, generation, action ID, originating tool call ID, phase, timestamp and artifact references. Persist actions/results, never stream frames or per-frame URLs.

Create one browser block per session generation, at its first action, and update that block's derived summary. Later actions update its activity/details and session status. Closing/restarting makes a new generation, so old cards do not turn live against a reused port. Legacy `vellum/browser` records remain readable and static until a current host session validates them.

Route only trusted built-in browser tool records through the special presentation. For code-execution wrappers, use the bridge's captured child calls. If a parent also performs non-browser work, keep those sibling calls and its failure visible. Do not hide arbitrary Bash calls or look for strings such as `browser` inside JavaScript. Permission requests, questions and errors remain visible even when success cards are suppressed.

## Shared streaming and truthful states

One socket and bounded latest-frame buffer per live session generation. Inline, floating and expanded renderers subscribe to that controller; only one live surface paints at a time. The inline slot keeps stable geometry and a quiet placeholder when the live frame floats, avoiding scroll jumps and oscillation.

Use ACK pacing and send the ACK after the native image submission has accepted the frame, not merely after receiving it. GPUIX may not expose actual presentation timing; do not claim an ACK proves the pixels reached the display. Keep at most one pending frame. Preserve viewport metadata separately from encoded image dimensions, especially when stream dimensions are capped. [Streaming](https://agent-browser.dev/streaming).

Use 4 FPS inline/floating, 30 FPS expanded, 1 FPS with Vellum unfocused, and disconnect the visual subscriber when minimized. A separate low-volume command/lifecycle connection may remain if the pinned CLI's protocol requires it; otherwise wrapper events supply state. A static page with no new frames is not automatically disconnected. “Live” requires a validated current connection; restored screenshots say “Last capture.”

Session states: `idle`, `starting`, `ready`, `working`, `waiting-user`, `disconnected`, `closed`, `error`. Browser-work eligibility is a separate run epoch, beginning with the first browser call of a note's current agent turn and lasting through thinking gaps and user waits until that turn ends. Carry the host-generated run ID with events; a new unrelated turn does not inherit the old epoch. A standalone compatibility CLI call with no run ID is active only while its action is executing. At normal turn completion, an automatically floated view minimizes; an explicitly pinned float stays open. Errors remain available through the inline card and top-bar error state. Viewer placement (`inline`, `floating`, `expanded`, `minimized`) is independent. Connection loss does not imply browser work stopped. Minimize/collapse does not stop commands or recordings. Upstream's live command feed is useful telemetry, not a durable action journal; Vellum records completion from its own wrapper. [Dashboard protocol](https://agent-browser.dev/dashboard).

## Native viewer behavior

- Inline: framed viewport, current page title/origin, quiet live status and current action; details accessible on demand. Entire viewport visible with `contain` sizing.
- Auto-float: only while the active note has an active browser-work epoch and its inline slot is above the note viewport. Start around 340px wide, clamp to available content bounds with 16px margins. No focus theft.
- Return: dock when the inline slot is at least half visible. Use a small visibility hysteresis so boundary scrolling cannot thrash placement. Manual dragging pins the floating position until “Return inline.”
- Dismiss: remember minimization for this session generation; no auto-reopen on subsequent actions. Top-bar icon restores it.
- Expanded: existing native overlay pattern, screen fitted to available space, Escape returns to the previous placement. No browser input in watch mode.
- Drag: title bar only, controls excluded, window-level pointer capture and immediate shared-parent positioning. Clamp on window resizing. Avoid React state commits per pointer move that restart descendant layout springs.
- “Take control”: explicit mode. Request cancellation/interrupt, prevent new runtime commands, and wait for any in-flight browser command to settle before enabling input. A pending/cancelling state must be honest if upstream cannot cancel promptly. Never claim a safe pause from merely sending an interrupt.
- Hand back: release pressed input and return command ownership. Do not silently replay interrupted irreversible actions. Close/blur while driving must not leave held mouse buttons or keys behind.
- Recording: preserve CLI recording capability and artifact output. A recording badge appears only when actual recording is confirmed. Omit the reference's “Teach a task” UI for now; video recording is not workflow teaching.

The floating viewer stays inside Vellum's existing native window. Detached OS picture-in-picture is outside this release. Changing notes hides the old note's floating viewer and follows the active note; background session work continues with its own state.

## Bundling, configuration and lifecycle

Bundle the actual pinned agent-browser binary in app helpers, with version, target platform/architecture, source and checksum recorded. First compatibility target is the installed 0.39.1; update the pin only if the capability check proves a newer version is required. A developer-only override may point at an explicit binary; production must not silently pick PATH.

Bundling the CLI does not bundle Chrome or ffmpeg. Reuse a supported browser, offer an explicit first-run browser install when needed, and explain missing recording prerequisites. Do not launch installs during a tool call without making that setup visible. Upstream video recording requires ffmpeg. [Recording](https://agent-browser.dev/recording).

Use a generated Vellum configuration instead of unexpectedly inheriting project/global agent-browser settings. Allow deliberate advanced settings for proxy, init scripts and enabled features; apply launch-time changes at the next safe restart, not midway through a task. Preserve exact browser identity during a failed reconnect. CDP tabs share that browser's storage; a note session name is not cookie isolation for an attached personal tab. [Configuration](https://agent-browser.dev/configuration), [sessions](https://agent-browser.dev/sessions).

Close owned browser processes when the note tab closes/trashes or the app exits, as V2 specified. Detach external sessions without closing the user's Chrome or their existing tabs. Await owned cleanup and bound it with a deadline; if it fails, expose retryable state. Never kill an arbitrary Chrome process.

## Scope and release boundary

Ship: native tools, bundled CLI resolution, managed sessions, explicit toolbar-tab binding when supported, durable browser activity, inline/auto-floating/expanded viewing, honest control ownership, screenshot/download/diagnostic artifacts, and compatibility with all three providers.

Do not build a second browser engine, full dashboard, teaching/automation recorder, desktop capture system, cloud-browser marketplace or another simulator layer. The upstream feature map in the implementation plan preserves access to relevant CLI capabilities without creating a separate Vellum panel for each one.

Before implementation, review the proposed connection/lifecycle/tool interfaces. The only product behavior confirmed after research so far is the inline-to-floating presentation; remaining details are concrete defaults for review.
