---
name: simdriver
description: Drive a live iOS simulator on the user's Mac — see the screen, tap, type, fill, gesture, and manage apps — through the simdriver Node package. Use when a task involves an iPhone or iPad simulator: launching or testing an app, tapping or typing on the phone, filling forms, screenshots, accessibility snapshots, permissions, notifications, location or appearance changes, or resetting app data. Triggers include "test on the simulator", "open the app in the simulator", "tap / type / swipe on the phone", "screenshot the simulator", "grant camera permission", "push a test notification", "wipe the app and start over". Prefer simdriver over xcrun simctl UI scripting, AppleScript, or screenshot-diffing for anything that reads or touches the screen.
---

# simdriver

Control apps on the user's iOS simulator by reading or operating the screen. Prefer purpose-built interfaces when available — the app's own test target, deep links, or `xcrun simctl` for device lifecycle — and use simdriver for the live UI those cannot reach.

- Use the `simdriver` package (Bun, Node 20+, or an Electron main process; macOS on Apple Silicon with Xcode and an iOS runtime installed) for all simulator UI actions.
- Do not drive the simulator with AppleScript, `osascript`, CGEvent synthesis, or screenshot differencing. Do not infer state from `simctl io screenshot` output; `snapshot()` already returns the elements.
- One live driver per device per process. `stop()` is terminal and idempotent; a driver lives as long as its process, so keep one long-lived process (a REPL or a loop) for a multi-step task rather than restarting per action.
- Element refs (`e4`) come from the last snapshot and are re-validated right before each touch; a stale, covered, or gone ref is refused without touching.
- Screen positions are 0..1 in both axes, never pixels. Frames arrive as BGRA buffers through the start callback.
- Use only the APIs described in this skill or in the package's `simdriver-controls.md`.

## API

```typescript
type Device = { udid: string; name: string; state: string; deviceType: string; runtime: string };
type App = { bundleId: string; name: string; appType: string };
type Modifiers = { alt?: boolean; shift?: boolean; ctrl?: boolean; meta?: boolean };
type StartOpts = { udid?: string; fps?: number; scale?: number; helperDir?: string };
type DriverEvent =
  | { type: "frame"; width: number; height: number; seq?: number; data: Uint8Array } // BGRA
  | { type: "state"; state: string }
  | { type: "note"; text: string };

declare class Driver {
  /** Resolves once the driver is live. Frames, state changes, and diagnostics arrive through onEvent. */
  static start(opts: StartOpts, onEvent: (event: DriverEvent) => void): Promise<Driver>;
  readonly udid: string;
  readonly state: string; // starting → live | input-displaced | restarting | stopped

  /** The agent layer: numbered elements, validated taps, multi-step runs. One per driver. */
  agent(): Agent;

  // Raw input, positions in 0..1 inside the screen.
  pointer(phase: "down" | "move" | "up", x: number, y: number, mods?: Modifiers): void;
  scroll(phase: "began" | "changed" | "ended" | "cancelled", x: number, y: number, dx: number, dy: number): void;
  tap(x: number, y: number): void;
  doubleTap(x: number, y: number): Promise<void>;
  longPress(x: number, y: number, holdMs?: number): Promise<void>;
  drag(x1: number, y1: number, x2: number, y2: number, opts?: { holdMs?: number; moveMs?: number; destinationHoldMs?: number }): Promise<void>;
  touch2(phase: string, x1: number, y1: number, x2: number, y2: number): void;

  // Keyboard and hardware buttons. Keys: letters, digits, enter, escape, backspace, tab, space, arrows…
  // Combos name their modifiers: ["cmd", "a"]. Buttons: home, lock, side, siri, volume-up, volume-down.
  key(name: string): boolean;
  keyCombo(keys: string[]): boolean;
  text(s: string): void;
  button(name: string, presses?: number, holdSecs?: number): void;

  // Reading the screen without the agent layer.
  accessibility(): Promise<string>;
  screenPoints(): { width: number; height: number } | null;
  grid(cols?: number): Grid | null;

  // Apps and simulator state.
  apps(): Promise<App[]>;
  openUrl(url: string): Promise<void>;
  launch(bundleId: string): Promise<void>;
  terminate(bundleId: string): Promise<void>;
  setLocation(lat: number, lon: number): Promise<void>;
  setAppearance(appearance: "light" | "dark"): Promise<void>;
  grantPermission(service: string, bundleId: string): Promise<void>;
  revokePermission(service: string, bundleId: string): Promise<void>;
  resetPermission(service: string, bundleId: string): Promise<void>;
  setContentSize(size: string): Promise<void>;
  statusBarOverride(): Promise<void>; // pins 9:41, battery full and charged
  statusBarClear(): Promise<void>;
  pushNotification(bundleId: string, payloadPath: string): Promise<void>; // APNs JSON at a file path
  resetKeychain(): Promise<void>;
  clearAppData(bundleId: string): Promise<void>; // terminates the app, then erases its data container
  clipboardRead(): Promise<string>;
  clipboardWrite(text: string): Promise<void>;

  stats(): { fps: number; activeFps: number; idleFps: number; lastResponseMs?: number; maxActiveGapMs: number; frames: number };
  stop(): void;
}

type Snapshot = {
  text: string; // the elements, numbered: "e1 button \"General\" …"
  image: Uint8Array | null; // annotated PNG when image is set
  settled: boolean;
  mode: string; // elements or grid
  elements: unknown[];
};

type StepsReport = {
  ok: boolean;
  completed: number;
  failed: { index: number; code: string; error: string } | null;
  screenshots?: { target: string; png: Uint8Array }[];
  snapshot: { text: string } | null; // the screen as it is where the run stopped
};

declare class Agent {
  snapshot(options?: { settleMs?: number; image?: boolean; grid?: boolean; cols?: number }): Promise<Snapshot>;
  tap(target: string, options?: { expect?: string }): Promise<{ target: string; name: string; at: [number, number] }>;
  steps(steps: Step[]): Promise<StepsReport>;
}

/** A named grid over a screen: rows lettered down (A, B, …), columns numbered across. */
declare class Grid {
  name(row: number, col: number): string;
  center(name: string): { x: number; y: number } | null; // in 0..1
  rect(name: string): { x: number; y: number; width: number; height: number } | null;
  at(x: number, y: number): string;
}

// Steps, passed to agent.steps(). A `target` is a ref from the last snapshot (e4),
// a label or identifier on screen ("Log in"), or a grid cell (C4). Unknown fields fail the step.
type Step =
  | { action: "tap"; target: string }
  | { action: "doubleTap"; target: string }
  | { action: "longPress"; target: string; ms?: number }
  | { action: "fill"; target: string; value: string; secret?: boolean }
  | { action: "type"; value: string }
  | { action: "key"; name: string } // "enter", "backspace", "cmd+a"…
  | { action: "press"; button: "home" | "lock" | "side" | "siri" | "volume-up" | "volume-down" }
  | { action: "scroll"; direction: "up" | "down" | "left" | "right"; target?: string }
  | { action: "swipe"; from: string | [number, number]; to: string | [number, number]; count?: number; pauseMs?: number }
  | { action: "fling"; direction: "up" | "down" | "left" | "right" }
  | { action: "drag"; from: string; to: string; sourceHoldMs?: number; moveMs?: number; destinationHoldMs?: number }
  | { action: "pinch"; target?: string; scale: number } // > 1 zooms in
  | { action: "rotate"; target?: string; degrees: number }
  | { action: "pan"; target?: string; dx: number; dy: number; ms?: number }
  | { action: "transform"; target?: string; dx?: number; dy?: number; scale: number; degrees?: number }
  | { action: "back"; mode: "system" | "inApp" }
  | { action: "appSwitcher" }
  | { action: "keyboardDismiss" }
  | { action: "waitFor"; text: string; timeoutMs?: number } // case-insensitive containment
  | { action: "alert"; op: "get" | "wait" | "accept" | "dismiss"; ms?: number }
  | { action: "screenshotElement"; target: string }
  | { action: "openUrl"; url: string }
  | { action: "launch"; bundleId: string }
  | { action: "terminate"; bundleId: string }
  | { action: "setLocation"; lat: number; lon: number }
  | { action: "appearance"; appearance: "light" | "dark" }
  | { action: "clipboardRead" }
  | { action: "clipboardWrite"; text: string };
```

`listDevices()`, `listApps(udid)`, `boot(udid)`, and `shutdown(udid)` run without a driver. Everything else needs a started `Driver`. Permission services: `all, calendar, contacts, contacts-limited, location, location-always, media-library, microphone, motion, photos, photos-add, reminders, siri`. Content sizes: `extra-small … extra-extra-extra-large` and the `accessibility-` sizes.

## Selecting a device

Reuse the device list you already have; call `listDevices()` again only when you need a fresh one. Booting is the host's explicit call — nothing boots a simulator as a side effect.

```javascript
import { Driver, listDevices, boot } from "simdriver";
const device = listDevices().find((d) => d.state === "Booted") ?? listDevices()[0];
if (device.state !== "Booted") boot(device.udid);
const driver = await Driver.start({ udid: device.udid }, (event) => {});
```

Pass the `udid` whenever more than one simulator could be booted. Apps for `launch`, `terminate`, permissions, and notifications are addressed by bundle id (`com.apple.MobileSMS`); `listApps(udid)` or `driver.apps()` lists what is installed, system apps included.

## Workflow

After performing one or more actions, take a `snapshot()` before deciding what to do next. This keeps you in the current screen and forces you to re-derive fresh refs from the latest text instead of reusing stale ones. The snapshot waits for the screen to settle internally; do not pause or sleep before it.

- Batch a deterministic run into one `steps()` call; it executes in order, stops at the first failure, and returns the screen as it is where it stopped. Read the report's `failed` step and the trailing snapshot before retrying.
- Refs are re-validated immediately before each touch. On a `stale`, `covered`, or `not-found` refusal, take a new snapshot and use its refs; nothing was touched.
- When a screen exposes no accessibility elements (games, maps, camera), pass `grid: true` and address cells by name (`B3`); `pinch`, `rotate`, `pan`, and `transform` default to the target's centre, or the screen's.
- Prefer `fill` over tap-and-type for text fields: it verifies the committed value and reports a mismatch or an unobserved commit. Pass `secret: true` for passwords so the value is redacted from reports.
- Use `waitFor` instead of a fixed delay, and `alert` to get, wait for, accept, or dismiss a system alert; dismiss only presses known safe labels, so prefer accept with the button the user named.
- Scrolls avoid the detected keyboard; `keyboardDismiss` removes it and verifies it is gone. In Safari, send `cmd+l` before the snapshot to expose and focus the address field.

```javascript
const agent = driver.agent();
const report = await agent.steps([
  { action: "launch", bundleId: "com.example.app" },
  { action: "fill", target: "Email", value: "user@example.com" },
  { action: "tap", target: "Sign in" },
  { action: "waitFor", text: "Welcome", timeoutMs: 5000 },
]);
const snap = await agent.snapshot();
```

## Notes

- Driver states: `starting → live`; `input-displaced` means someone else took the touch input — frames keep streaming and your next touch reclaims it; `restarting` means the simulator rebooted and frames resume. `stop()` ends the driver for good.
- Agent refusals arrive as `code: message` with one of these codes: `stale`, `covered`, `not-found`, `not-ready`, `invalid`, `device`, `not-text-input`, `commit-not-observed`, `clear-not-observed`, `keyboard-occludes`. Branch on the code, not the prose.
- Non-ASCII text is delivered through the simulator pasteboard, which some Xcode versions fail to paste into native fields (`fill` then reports `verified: false` while `simctl pbpaste` shows the text). ASCII typing goes over HID and works; on that failure path, verify from the snapshot rather than assuming.
- `pushNotification` reads its payload from a file: write the APNs JSON (`{"aps":{"alert":{"title":"…","body":"…"}}}`) to a temp file, pass the path, remove it after.
- `clearAppData` terminates the app and erases its data container — documents, preferences, caches. It is destructive and never runs implicitly; use it for clean-slate setup when logging out in the app is not enough. `resetKeychain` empties the whole simulator's keychain.
- Biometric (Face ID / Touch ID) controls are not implemented. Device orientation is not exposed. Gestures of three or more fingers are not supported.
- Performance is real-time: ~60 fps streaming, ~9 ms tap-to-frame. `stats()` reports the actual rates if you need to prove smoothness.

Persist until the request is fully completed end-to-end. Attempting an action is not completion: verify that a fresh snapshot visibly shows the requested result. If an action is refused, the state is unchanged, or you only reach an intermediate screen, take a new snapshot and try another approach. Respond only after the requested screen, information, or state is visibly present, or explain a concrete blocker you cannot resolve.
