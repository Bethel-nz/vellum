# agent-browser 0.39.1 compatibility

Verified 2026-10-27 on macOS arm64 with Chrome for Testing 151.0.7922.71. The installed Homebrew wrapper and its locally built native executable differ from the upstream release digest. Releases use the official pinned executable, not the unchecked PATH wrapper. The version, release URLs, target architecture and GitHub release SHA-256 digests are recorded in [manifest](../assets/agent-browser/manifest.json), with Apache-2.0 attribution beside it. `prepareAgentBrowser` downloads and checks that digest at packaging time. Development may use the verified helper under `dist/helpers` or an explicit `VELLUM_BROWSER_EXECUTABLE`; compiled apps only resolve the bundled helper.

Sources: [official v0.39.1 release](https://github.com/vercel-labs/agent-browser/releases/tag/v0.39.1), [CDP](https://agent-browser.dev/cdp-mode), [streaming](https://agent-browser.dev/streaming), [configuration](https://agent-browser.dev/configuration). Installed help is the version authority when the website differs.

## Disposable live probe

`VELLUM_BROWSER_EXECUTABLE=/absolute/path/to/pinned/agent-browser bun spikes/agent-browser-compat.ts` creates its own temporary Chrome profile and tiny debugger extension. The probe uses the local Chrome for Testing installation; it never enables debugging on a personal profile. It removes the profile and closes its Chrome when finished.

Verified sequence:

1. Enumerate `chrome.debugger.getTargets()` from the disposable extension's service worker. Its page `id` matches the CDP `/json/list` target `id`; Chrome tab/window IDs alone are insufficient. Two windows with the same URL have distinct targets.
2. Connect the fresh note daemon using `connect <approved-local-endpoint>` **without pinning the unbound session**. Then `tab <exact-target-id> --pin-tab`. Later calls preserve that explicit target. The runtime also verifies endpoint browser identity and target existence before every command.
3. Extension debugger attach, `Page.captureScreenshot` and detach coexist with the direct CDP connection. The host now wraps capture in an exclusive lease, waits for active commands and does not permit browser input during capture.
4. Closing the pinned tab fails. The first failure can be `CDP error (DOM.enable): Session with given id not found`; a subsequent call reports structured `code=tab_gone`. Neither selects another tab. The host's pre-command verification produces `target_gone` without relying on this inconsistent first error.
5. `close` on the attached daemon leaves Chrome and remaining user tabs open.
6. Two host notes cannot claim one verified endpoint/target. “Move here” waits while the first note holds control, detaches it, then binds the second. Capture leases block browser commands; cleanup preserves the external tab.
7. A real host-managed open and screenshot produce a verified local image artifact; awaited close terminates that managed session.

## Stream contract

Observed stream messages: `status`, `tabs`, `frame`; the native fake stream additionally exercises `url`. The upstream help documents the command/result/error feed, but Vellum does not use it as the durable action journal. Host command completion is authoritative.

- The opening URL includes `?pacing=ack&maxFps=N`.
- Frames have numeric `seq`, base64 encoded image, and metadata: `deviceWidth`, `deviceHeight`, `offsetTop`, `pageScaleFactor`, `scrollOffsetX`, `scrollOffsetY`, `timestamp`.
- Actual PNG/JPEG dimensions are decoded separately from viewport dimensions. The controller retains only the newest pending frame.
- ACK is sent after the active renderer's `setImage` submission accepts the frame. GPUIX's implementation calls its native setter synchronously and returns void. This is submission, not proof of display presentation.
- One controller/socket survives inline/floating/expanded handoffs, using 10/15/30 FPS while watching and 60 FPS while driving the expanded view, 1 while unfocused and no visual subscriber while minimized. A scratch protocol probe verifies the opening URL and 10/15/30/60/30/1 FPS transitions. Last image survives loss/minimization; static pages are not timed out for lack of frames.
- `session info --json` on an absent session returns `active:false,pid:null` without starting a daemon. The host compares the current PID before opening/reopening a stream to prevent port-reuse attachment.

## Native contract audit

Audited the local `clones/agent-browser` checkout at tag `v0.39.1` (`1165952d`). The Rust source is authoritative; the removed TypeScript `BrowserManager` API is not used.

- `core/agent-browser-types.ts` records each CLI payload with its producing Rust function. `connection.rs: Response` defines the envelope; `main.rs: run_session_info` wraps the daemon's session payload. `invoke` always requests JSON, throws on failure envelopes even with exit code zero, retains machine-readable error codes, and records warnings in browser activity. `tab_gone` closes the stream and requires an explicit reconnect.
- `core/stream-protocol.ts` describes input, configuration, acknowledgements and the complete server broadcast feed from `stream/websocket.rs`, `stream/mod.rs` and `stream/cdp_loop.rs`. `keyboard_params` defaults missing VK/modifiers to zero and omits absent key/code/text strings. Mouse defaults are button `none` and click count zero.
- `AgentScreen` sends key/code/VK on key down/up, including synthetic releases during hand-back. Printable text still uses a separate `char` event. Escape hands control back. Mouse move reports a button only during a held press; move/wheel omit click counts.
- GPUIX 0.11's pinned [macOS event conversion](https://github.com/remorses/zed/blob/f77e5cfe9dad04288566f00c66ecf3c58d6f84b3/crates/gpui_macos/src/events.rs) maps the Mac backward-delete key to `backspace` and forward delete to `delete`. The viewer logs the first delete-family key name without entered text. Its pinned [renderer](https://github.com/remorses/gpuix/blob/2e31b47ff6432ceebe70e7fc7b0f51a76d7d30cf/packages/native/src/renderer.rs) passes content scroll deltas through, with negative Y scrolling down; Vellum negates them for CDP.
- `cdp_loop.rs: cdp_event_loop` stamps frames with the stream's viewport dimensions, independently of encoded frame caps. Pointer mapping removes centered `objectFit: contain` letterboxing and scales straight into viewport CSS pixels, matching the pinned dashboard's `toViewport`. It does not apply another page-scale/offset conversion.

Validation for this audit: the six existing focused runtime/stream/presentation tests and Biome checks pass. A disposable protocol fixture also checks zero-exit failure envelopes, `tab_gone`, warning replay, typed key releases, FPS transitions and capped-frame letterboxing. Physical keyboard/trackpad input in a live Chrome session has not been exercised for these edits; source inspection confirms the native naming and wheel sign. No build or dependency change was needed.

## Capability coverage

The pinned help lists navigation, refs/selectors, snapshots, screenshots/PDF/download/upload/clipboard, video recording, console/errors/trace/profiler, React inspection, network routes/requests/HAR, WebMCP and diffing. These pass through argv with Vellum ownership/launch options reserved. WebGPU, proxy and init hooks are explicit launch configuration, not model-owned per-command settings. Recording requires ffmpeg; browser engines and ffmpeg are not bundled. No automatic install, dashboard hosting or plugin management runs during tool execution.

Focused tests cover argv fidelity and conflicts, queue ordering/cancellation settlement/control, generation rollover, presence expiry/duplicate identities, event replay/provenance filtering, ACK after slow submission/latest-frame dropping, and affected provider reducer fixtures. `scripts/check-browser.ts` verifies the native viewer using a scratch home, fake provider and fake stream. Paid provider runs and packaged app/extension builds are deliberately deferred.
