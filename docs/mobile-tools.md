# Simulator tools in Vellum

Vellum exposes SimDriver through its note-scoped MCP server to Claude, Codex and
OpenCode. The mobile view owns the live driver. Tool handlers reuse that driver and
its agent; ordinary screen/input tools do not boot a device or create another driver.
`mobile_connection` explicitly manages that shared connection and device lifecycle.

Reference: the installed `simdriver` 0.1.2 package's `simdriver-controls.md`, README
and type declarations. The package currently ships a Node API and native helpers;
it does not declare a CLI executable in `package.json`.

## Which tool to call

| Task | Tool and arguments | Result |
| --- | --- | --- |
| Read the current screen | `mobile_snapshot({image?: boolean, grid?: boolean, settleMs?: number, cols?: number})` | Device name, numbered elements, settled/mode/elements metadata, and an annotated PNG when requested. Image defaults to true. |
| See the screen as a plain image | `mobile_screenshot({path?: string})` | Device name and a PNG with no element boxes or grid, taken without waiting for the screen to settle. `path` also saves it (a file, or a folder ending in `/`). |
| Tap one element | `mobile_tap({target, expect?: string})` | Target, matched name and tap coordinates. Take a new snapshot afterward. |
| Perform a workflow | `mobile_steps({steps: [...]})` | Completed count, failure details, latest screen, and any requested element screenshots. Stops at the first failure. |
| Discover app bundle ids | `mobile_apps({udid?: string})` | Installed app names, bundle ids and app types, including system apps. |
| Set permissions, text size or status bar | `mobile_configure({actions: [...]})` | Applied actions or the failed action and prior completed actions. All arguments are checked before the first action runs. |
| Send a notification | `mobile_notify({bundleId, payload})` | Delivery confirmation. `payload` is an APNs object, not a path. |
| Erase app data or keychain | `mobile_reset({what: "app-data", bundleId})` or `mobile_reset({what: "keychain"})` | Confirmation. Both are destructive and require a user request. |
| Manage devices and the live driver | `mobile_connection({action, udid?, fps?, scale?, helperDir?})` | Device discovery, connection state, connect/disconnect or explicit boot/shutdown. |
| Use exact coordinate input | `mobile_input({actions: [...]})` | Ordered raw pointer, scroll, touch, keyboard and hardware-button results, stopping on failure. |
| Read driver details | `mobile_inspect({what, ...arguments})` | Raw accessibility, dimensions, grid calculations, stats or recent diagnostic events. |

Tool names may have the MCP client's server prefix. Use the names advertised by
its tool discovery. No connected phone returns an error directing the user to
connect through `mobile_connection` or open Vellum's mobile view.

## Screen-aware workflow

1. Call `mobile_snapshot`. Targets can be a returned ref (`e4`), a visible label or
   identifier, or a grid cell (`C4`) when accessibility cannot describe the screen.
2. Batch deterministic actions in `mobile_steps`. Use `waitFor` for an expected
   screen instead of sleeping. Prefer `fill` for text fields.
3. Read the completion report and trailing screen before deciding the next action.
   A stale, covered or missing target needs a fresh snapshot, not a blind retry.
4. Check fill verification; successful input delivery alone does not prove the
   value was committed. Pass `secret: true` for secret field values.

For example, after reading the screen:

```json
{
  "steps": [
    {"action": "tap", "target": "Refresh"},
    {"action": "waitFor", "text": "GPUIX", "timeoutMs": 15000}
  ]
}
```

`mobile_steps` accepts 1–50 actions:

| Group | Actions |
| --- | --- |
| Input | `tap`, `doubleTap`, `longPress`, `fill`, `type`, `key`, `press` |
| Gestures | `scroll`, `swipe`, `fling`, `drag`, `pinch`, `rotate`, `pan`, `transform` |
| Navigation and observation | `back`, `appSwitcher`, `keyboardDismiss`, `waitFor`, `alert`, `screenshotElement` |
| Apps and device state | `openUrl`, `launch`, `terminate`, `setLocation`, `appearance` |
| Pasteboard | `clipboardRead`, `clipboardWrite` |

Every step has an `action` field plus the following arguments. `?` marks optional
fields; additional fields are rejected by SimDriver.

| Action | Arguments |
| --- | --- |
| `tap`, `doubleTap`, `screenshotElement` | `target` |
| `longPress` | `target`, `ms?` (default 800) |
| `fill` | `target`, `value`, `secret?` |
| `type` | `value` |
| `key` | `name` (for example `enter`, `backspace`, `cmd+a`) |
| `press` | `button`: `home`, `lock`, `side`, `siri`, `volume-up`, `volume-down` |
| `scroll` | `direction`: `up`, `down`, `left`, `right`; `target?` |
| `fling` | `direction`: `up`, `down`, `left`, `right` |
| `swipe` | `from`, `to`: targets or normalized `[x, y]` points; `count?`, `pauseMs?` |
| `drag` | `from`, `to`: targets; `sourceHoldMs?`, `moveMs?`, `destinationHoldMs?` |
| `pinch` | `scale`, `target?`; above 1 zooms in |
| `rotate` | `degrees`, `target?` |
| `pan` | `dx`, `dy`, `target?`, `ms?` |
| `transform` | `scale`, `target?`, `dx?`, `dy?`, `degrees?` |
| `back` | `mode`: `system` or `inApp` |
| `appSwitcher`, `keyboardDismiss`, `clipboardRead` | None |
| `waitFor` | `text`, `timeoutMs?` |
| `alert` | `op`: `get`, `wait`, `accept`, `dismiss`; `ms?` |
| `openUrl` | `url` |
| `launch`, `terminate` | `bundleId` from `mobile_apps` |
| `setLocation` | `lat`, `lon` |
| `appearance` | `appearance`: `light` or `dark` |
| `clipboardWrite` | `text` |

`mobile_configure` accepts 1–20 actions:

```json
{
  "actions": [
    {"action": "permission", "op": "grant", "service": "photos", "bundleId": "com.example.app"},
    {"action": "contentSize", "size": "large"},
    {"action": "statusBar", "op": "override"}
  ]
}
```

Permission operations are `grant`, `revoke` or `reset`. Supported services are
`all`, `calendar`, `contacts`, `contacts-limited`, `location`, `location-always`,
`media-library`, `microphone`, `motion`, `photos`, `photos-add`, `reminders` and
`siri`. Status bar `override` pins 9:41 and a full battery; `clear` restores the
live status bar. Text sizes run from `extra-small` to `extra-extra-extra-large`,
plus the accessibility sizes listed in the tool description.

## CLI and script use

Prefer these native tools for routine actions. If a SimDriver CLI is installed,
inspect its help and use its documented commands. Custom scripts remain useful
for deeper workflows the tools or CLI cannot express; they are not necessary for
ordinary snapshots, taps or step batches.

A future CLI can expose the same ten operations—snapshot, tap, steps, apps,
configure, notify, reset, connection, input and inspect—with JSON arguments and the same result contracts.
Those are proposed operations, not commands available today. To control Vellum's
phone, route them through its authenticated bridge and existing handlers rather
than opening another driver. An independent CLI used outside Vellum can own its
own long-lived driver. Keep discovery, arguments and failure codes consistent
across the MCP and CLI interfaces.

## Current limits

The installed version targets iOS simulators on Apple Silicon macOS. Biometric
controls, orientation and gestures with more than two fingers are not exposed.
On Xcode 27.1, non-ASCII pasteboard input can fail to commit; inspect the returned
verification and current screen. Boot and shutdown run only through explicit connection actions.

## Full Node SDK coverage

Checked against `~/dev/simdriver/bindings/node/index.js` and the Rust agent's
`crates/simdriver-agent/src/steps.rs`, not just the generated declarations.
The installed Node wrapper matches that checkout. Vellum exposes ten tools; one
tool can cover several related SDK operations.

| SDK surface | Vellum operation |
| --- | --- |
| `Driver.start({udid?, fps?, scale?, helperDir?})` | `mobile_connection({action: "connect", ...options})`; opens the view, uses its selected device if omitted, and reuses its driver unless start options change |
| `Driver.stop()` | `mobile_connection({action: "disconnect"})`; clears the connection in the view too; reconnect creates a new driver because stop is terminal |
| `udid`, `state` | `mobile_inspect({what: "status"})` or `mobile_connection({action: "status"})` |
| `pointer`, `scroll`, `tap`, `doubleTap`, `longPress`, `drag`, `touch2` | `mobile_input` actions with the same names; coordinates are normalized 0..1 |
| `key`, `keyCombo`, `text`, `button` | `mobile_input` actions; key/combination results preserve unsupported-key failures; buttons accept `presses` and `holdSecs` |
| `accessibility()`, `screenPoints()`, `stats()` | `mobile_inspect` with `what: "accessibility"`, `"screen"`, `"stats"` |
| `grid(cols?)`, `Grid.rows/cols/name/center/rect/at` | `mobile_inspect({what: "grid", cols?, op, ...arguments})` |
| `apps()` / `listApps(udid)` | `mobile_apps({})` / `mobile_apps({udid})`; the latter works without a connected driver |
| `openUrl`, `launch`, `terminate`, `setLocation`, `setAppearance` | `mobile_steps` actions `openUrl`, `launch`, `terminate`, `setLocation`, `appearance` |
| `clipboardRead`, `clipboardWrite` | Matching `mobile_steps` actions; read values are in the returned step report |
| `grantPermission`, `revokePermission`, `resetPermission` | `mobile_configure` permission actions with `op: "grant"`, `"revoke"`, `"reset"` |
| `setContentSize`, `statusBarOverride`, `statusBarClear` | `mobile_configure` contentSize/statusBar actions |
| `pushNotification(bundleId, payloadPath)` | `mobile_notify({bundleId, payload})`; Vellum writes and removes the temporary APNs file |
| `clearAppData`, `resetKeychain` | `mobile_reset` |
| `agent().snapshot`, `.tap`, `.steps`, `.screenshot` | `mobile_snapshot`, `mobile_tap`, `mobile_steps`, `mobile_screenshot`; all snapshot options and returned metadata are preserved |
| `listDevices`, `boot`, `shutdown` | `mobile_connection` actions `devices`, `boot`, `shutdown`; boot/shutdown require `udid` |
| Driver frame/state/note callbacks | The mobile view renders BGRA frames; `mobile_inspect({what: "events"})` returns the latest frame dimensions/sequence and recent state/diagnostic events. Use `mobile_snapshot` for a model-readable image. |

The public JavaScript wrapper accepts a drag options object, although the generated
`.d.ts` lists positional native arguments. Vellum follows the actual wrapper. Its
`accessibility()` also returns parsed JSON, despite the declaration's string type.
Native `takeEvent`/`pumpDone` are internal to the wrapper's event pump; agents do not
drain or interrupt the live view's frame stream.

### Raw input

```json
{"actions":[
  {"action":"pointer","phase":"down","x":0.3,"y":0.4,"mods":{"alt":true}},
  {"action":"pointer","phase":"move","x":0.5,"y":0.6},
  {"action":"pointer","phase":"up","x":0.5,"y":0.6},
  {"action":"button","name":"side","presses":1,"holdSecs":1.5}
]}
```

`mobile_input` validates all 1–50 actions before dispatch, executes in order, and
stops on the first error. Runtime failure attempts to release active contacts.
Separate raw phase calls can keep a contact held; end each pointer/touch2 contact
with `up`, and each scroll with `ended`. Take a snapshot afterward.

| Raw action | Arguments |
| --- | --- |
| `pointer` | `phase: down/move/up`, `x`, `y`, `mods?: {alt?, shift?, ctrl?, meta?}` |
| `scroll` | `phase: began/changed/ended/momentum/cancelled`, `x`, `y`, `dx`, `dy` |
| `tap`, `doubleTap` | `x`, `y` |
| `longPress` | `x`, `y`, `holdMs?` |
| `drag` | `x1`, `y1`, `x2`, `y2`, `holdMs?`, `moveMs?`, `destinationHoldMs?` |
| `touch2` | `phase: down/move/up`, `x1`, `y1`, `x2`, `y2` |
| `key` | `name` |
| `keyCombo` | `keys`, such as `["cmd", "a"]` |
| `text` | `text` |
| `button` | `name: home/lock/side/siri/volume-up/volume-down`, `presses?`, `holdSecs?` |

The current native scroll API accepts `momentum`, not `cancelled`. Vellum maps
`cancelled` to `ended` for compatibility with the host's input events.

### Driver inspection

`mobile_inspect` reads state without sending input. Grid operations use the live
screen's dimensions:

- `what: "grid", op: "info", cols?`: grid row/column count.
- `what: "grid", op: "name", row, col, cols?`: zero-based index to cell name.
- `what: "grid", op: "center" | "rect", cell, cols?`: normalized cell geometry;
  an unrecognized cell returns null.
- `what: "grid", op: "at", x, y, cols?`: normalized point to cell name.

Device shutdown disconnects the view first when it owns that device. Tools from
all notes share one queue, so connection changes and input batches cannot execute
concurrently against the same driver. Direct user input in the view can still
interrupt automation, as expected.
