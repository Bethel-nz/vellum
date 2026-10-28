# Agent Screen and browser tools

Vellum exposes the same built-in MCP tools to Claude, Codex and OpenCode through the existing note-scoped transport. `browser` accepts one **argv array**, not a shell script. Commands in one note are serialized. Different notes have independent managed browsers.

```json
{"name":"browser","arguments":{"args":["open","https://example.com"]}}
{"name":"browser","arguments":{"args":["snapshot","-i"]}}
{"name":"browser","arguments":{"args":["click","@e3"]}}
{"name":"browser","arguments":{"args":["fill","@e4","a value with spaces"]}}
{"name":"browser","arguments":{"args":["screenshot"]}}
```

Take a fresh snapshot before using refs. The viewer is a visual stream; the accessibility snapshot returned to the agent supplies refs and text. Website content remains untrusted. A `title` is optional and never selects a browser or changes command execution; Vellum currently derives value-free titles from the command to keep entered values out of the new journal.

`browser_session` accepts `status`, `connect`, `disconnect` or `targets`. With no explicit mode an existing connection is preserved, otherwise a separate managed browser is used. For example:

```json
{"name":"browser_session","arguments":{"action":"connect","mode":"managed"}}
{"name":"browser_session","arguments":{"action":"targets"}}
{"name":"browser_session","arguments":{"action":"connect","mode":"toolbar","targetKey":"<key returned by targets>"}}
{"name":"browser_session","arguments":{"action":"disconnect"}}
```

In Settings → Browser, open Snapshot toolbars appear separately by installation/tab/window, including duplicate URLs. Enter an explicitly approved local Chrome debugging port and submit the field. Vellum also checks Chrome's local `DevToolsActivePort` files. It verifies the extension's debugger target ID against exactly one endpoint; a URL or focused window never chooses a tab. Chrome must already expose CDP. Vellum does not restart personal Chrome or copy its profile to enable this. If unavailable, use a managed browser. Attached tabs share their browser's cookies/storage. “Move here” waits for the previous note's command and manual-control ownership before transferring the claim. Closing an attached session detaches its daemon and leaves Chrome and its tabs open.

The first action adds one Agent Screen per generation. Scroll it completely above view while browser work is active to float it; reveal at least half to dock. Dragging pins the float. “Return inline” clears that pin. Dismiss stays minimized until the top-bar browser icon restores it. Expanding shares the same stream. Watch mode sends no input. “Take control” interrupts the note, reserves browser ownership and waits for the in-flight command to settle; it remains pending if settlement is unknown. Hand-back releases held input. Snapshot capture uses a separate exclusive lease, so a viewer cannot revoke capture ownership.

Browser-work eligibility follows the host's agent-turn ID across thinking gaps and user waits. An unrelated turn does not inherit it. A standalone compatibility call is active only while its action executes. Automatically floated views minimize when work ends; dragged/pinned views stay open.

## Commands and artifacts

| Feature | Example argv | Result |
| --- | --- | --- |
| Screenshot | `["screenshot"]` | Verified local image, MCP image content, static last capture |
| PDF | `["pdf"]` | Local PDF artifact |
| Download | `["download","@e3","report.csv"]` | Verified local file if saved locally |
| Video | `["record","start","demo.webm"]`, then `["record","stop"]` | Real video artifact after stop; badge only after confirmed start |
| Trace | `["trace","start"]`, then `["trace","stop"]` | Saved DevTools trace JSON |
| Profile | `["profiler","start"]`, then `["profiler","stop"]` | Saved profile JSON |
| HAR | `["network","har","start"]`, then `["network","har","stop"]` | Local HAR; can contain sensitive traffic |
| Inspect | `["console"]`, `["errors"]`, `["inspect"]` | Original CLI output / Chrome DevTools |
| React | Enable `react-devtools` in advanced launch configuration before starting | Original inspection output |
| WebMCP | `["webmcp","list"]`, then fetch a tool's schema before invoking | Website metadata remains untrusted |
| Diff | `["diff","snapshot"]` or upstream screenshot diff args | Original structured/text results |
| Other supported browsing commands | Installed `agent-browser skills get core --full` reference | Original stdout, stderr, structured data and exit code |

Default output paths live under the note's capture directory and generation. Explicit relative output paths resolve there; explicit absolute paths are preserved and verified as real files before loading. Arbitrary stdout is never interpreted as a file path. Video requires a separate ffmpeg installation with the required encoders. Chrome and ffmpeg are not bundled and no tool call installs them.

Vellum reserves session/namespace, profile/restore/state, connection/target pinning, CLI path, engine/provider, stream setup, launch args, init hooks/features/proxy, download configuration, install/upgrade/dashboard/chat and plugin management. Toolbar commands cannot change tabs; reconnect explicitly to choose a different target. Normal upstream browser, selector, snapshot, file, network, recording and inspection commands stay available. Explicit `browserLaunch` settings in Vellum settings support `proxy`, `initScripts`, `enable` and `webgpu`; these are applied on the next safe connection. Plugins are disabled; automatic plugin installation is not supported. Vellum does not silently relaunch an external browser to apply launch hooks or WebGPU.

## Persistence and recovery

Raw ACP/MCP events keep the existing retention policy and can contain actual tool arguments/results. The new browser journal retains value-free activity summaries, generation/action/run IDs and artifact paths. It does **not** redact old provider transcripts. Stream frames and per-frame URLs are never logged. Activity details show summaries/artifacts; full raw results remain in the note's event history.

Restored browser records are static until a current host registry validates the generation. Neither a restored port nor a reused port revives a session. Reconnect checks the live daemon PID through the CLI's non-launching `session info`. A lost pinned target or uncertain command requires explicit recovery; Vellum never switches targets or replays a cancelled action.

Normal note cleanup awaits its command then closes the daemon with a deadline. GPUIX 0.11 exits synchronously when the last window closes, so final app cleanup waits for bounded synchronous close RPCs (8 seconds total); a failed exit cleanup leaves a retry diagnostic in that generation's capture directory. Force-killing the app cannot promise cleanup.

## Verification limits

See [compatibility evidence](agent-browser-compatibility.md). Native smoke checks use a fake provider/stream; no paid provider turns were run. The actual app package and updated extension bundle have not been built as part of this source implementation. Cross-platform packaging, a user's personal Chrome profile, full recording/advanced-feature combinations, and the full dark/light/reduced-motion/small-window matrix remain release checks.
