import { rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { paths } from './store'
import { bootMobile, connectMobile, disconnectMobile, liveMobile, mobileConnectionStatus, mobileDevices, mobileEvents, mobileSDK, mobileSupported, shutdownMobile, withMobileAgent, type MobileDriver } from './mobile'

// The iOS simulator in Vellum's mobile view, through simdriver's agent layer. Refs (e4) come
// from the last snapshot and are re-checked right before each touch, so a stale one is refused.
const target = { type: 'string', description: 'An element ref from the last snapshot (e4), a label on screen ("Log in"), a grid cell (C4, tapped at its centre), or an exact point @x,y in screen points (@201,816) for anything smaller or between cells.' }
const bundleId = { type: 'string', description: 'An app bundle identifier, e.g. com.apple.MobileSMS. mobile_apps lists what is installed.' }
const services = 'all, calendar, contacts, contacts-limited, location, location-always, media-library, microphone, motion, photos, photos-add, reminders, siri'
const contentSizes = 'extra-small, small, medium, large, extra-large, extra-extra-large, extra-extra-extra-large, accessibility-medium, accessibility-large, accessibility-extra-large, accessibility-extra-extra-large, accessibility-extra-extra-extra-large'
const number = { type: 'number' }
const point = { type: 'number', minimum: 0, maximum: 1 }
const duration = { type: 'number', minimum: 0 }
const string = { type: 'string' }
const milliseconds = { type: 'integer', minimum: 0 }
const direction = { type: 'string', enum: ['up', 'down', 'left', 'right'] }
function actionSchema(action: string, properties: Record<string, unknown> = {}, required: string[] = []) {
  return { type: 'object', properties: { action: { type: 'string', enum: [action] }, ...properties }, required: ['action', ...required], additionalProperties: false }
}
const swipeTarget = { anyOf: [target, { type: 'array', items: point, minItems: 2, maxItems: 2 }] }
const stepSchema = { oneOf: [
  ...['tap', 'doubleTap', 'screenshotElement'].map((action) => actionSchema(action, { target }, ['target'])),
  actionSchema('longPress', { target, ms: milliseconds }, ['target']),
  actionSchema('fill', { target, value: string, secret: { type: 'boolean' } }, ['target', 'value']),
  actionSchema('type', { value: string }, ['value']),
  actionSchema('key', { name: string }, ['name']),
  actionSchema('press', { button: { type: 'string', enum: ['home', 'lock', 'side', 'siri', 'volume-up', 'volume-down'] } }, ['button']),
  actionSchema('scroll', { direction, target }, ['direction']),
  actionSchema('fling', { direction }, ['direction']),
  actionSchema('swipe', { from: swipeTarget, to: swipeTarget, count: { type: 'integer', minimum: 1, maximum: 10 }, pauseMs: milliseconds }, ['from', 'to']),
  actionSchema('drag', { from: target, to: target, sourceHoldMs: milliseconds, moveMs: milliseconds, destinationHoldMs: milliseconds }, ['from', 'to']),
  actionSchema('pinch', { target, scale: { type: 'number', exclusiveMinimum: 0 } }, ['scale']),
  actionSchema('rotate', { target, degrees: number }, ['degrees']),
  actionSchema('pan', { target, dx: number, dy: number, ms: milliseconds }, ['dx', 'dy']),
  actionSchema('transform', { target, dx: number, dy: number, scale: { type: 'number', exclusiveMinimum: 0 }, degrees: number }, ['scale']),
  actionSchema('back', { mode: { type: 'string', enum: ['system', 'inApp'] } }, ['mode']),
  actionSchema('appSwitcher'), actionSchema('keyboardDismiss'), actionSchema('clipboardRead'),
  actionSchema('waitFor', { text: string, timeoutMs: milliseconds }, ['text']),
  actionSchema('alert', { op: { type: 'string', enum: ['get', 'wait', 'accept', 'dismiss'] }, ms: milliseconds }, ['op']),
  actionSchema('openUrl', { url: string }, ['url']),
  ...['launch', 'terminate'].map((action) => actionSchema(action, { bundleId }, ['bundleId'])),
  actionSchema('setLocation', { lat: { type: 'number', minimum: -90, maximum: 90 }, lon: { type: 'number', minimum: -180, maximum: 180 } }, ['lat', 'lon']),
  actionSchema('appearance', { appearance: { type: 'string', enum: ['light', 'dark'] } }, ['appearance']),
  actionSchema('clipboardWrite', { text: string }, ['text']),
  actionSchema('screenshot', { path: string }),
] }
const configurationSchema = { oneOf: [
  actionSchema('permission', { op: { type: 'string', enum: ['grant', 'revoke', 'reset'] }, service: { type: 'string', enum: services.split(', ') }, bundleId }, ['op', 'service', 'bundleId']),
  actionSchema('contentSize', { size: { type: 'string', enum: contentSizes.split(', ') } }, ['size']),
  actionSchema('statusBar', { op: { type: 'string', enum: ['override', 'clear'] } }, ['op']),
] }
const inputSchema = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['pointer', 'scroll', 'tap', 'doubleTap', 'longPress', 'drag', 'touch2', 'key', 'keyCombo', 'text', 'button'] },
    phase: { type: 'string', description: 'pointer/touch2: down, move, up. scroll: began, changed, ended, momentum or cancelled (ends the scroll).' },
    x: point, y: point, x1: point, y1: point, x2: point, y2: point, dx: number, dy: number,
    mods: { type: 'object', properties: { alt: { type: 'boolean' }, shift: { type: 'boolean' }, ctrl: { type: 'boolean' }, meta: { type: 'boolean' } } },
    holdMs: duration, moveMs: duration, destinationHoldMs: duration,
    name: { type: 'string' }, keys: { type: 'array', items: { type: 'string' } }, text: { type: 'string' },
    presses: { type: 'integer', minimum: 1 }, holdSecs: duration,
  }, required: ['action'],
}
export const mobileTools = !mobileSupported ? [] : [
  { name: 'mobile_snapshot', description: 'See the iOS simulator open in Vellum: its interactive elements numbered e1, e2… and an annotated screenshot. Waits for the screen to settle. Take one before acting and after the screen changes; when nothing is accessible (maps, games) it shows a lettered grid instead.', inputSchema: { type: 'object', properties: { image: { type: 'boolean', description: 'Include the annotated screenshot (default true).' }, grid: { type: 'boolean', description: 'Draw the grid over the screen instead of element boxes.' }, settleMs: { type: 'integer', minimum: 0, description: 'Screen settling window in milliseconds.' }, cols: { type: 'integer', minimum: 1, description: 'Grid column count.' } } } },
  { name: 'mobile_screenshot', description: 'The simulator screen as it is now, as a plain image: no element boxes or grid, no waiting for it to settle. Optional path also saves the PNG there (a file, or a folder ending in /, which gets a generated name). Use mobile_snapshot instead when you need the elements to act on.', inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Where to save the PNG, if anywhere.' } } } },
  { name: 'mobile_tap', description: 'Tap one element. Refused, without touching, if the element moved, is covered, is gone, or (with expect) no longer reads as expected: take a new snapshot then.', inputSchema: { type: 'object', properties: { target, expect: { type: 'string', description: 'The label you expect the target to have.' } }, required: ['target'] } },
  { name: 'mobile_steps', description: 'Run several actions in order; stops at the first failure and returns the screen as it is then. Actions: tap, doubleTap, longPress{ms}, fill{target,value,secret}, type{value}, key{name: enter, backspace, cmd+a…}, press{button: home, lock, side, siri, volume-up, volume-down}, scroll{direction, target?}, swipe{from,to}, fling{direction}, drag{from,to}, pinch{scale}, rotate{degrees}, pan{dx,dy,target?}, transform{dx,dy,scale,degrees,target?}, back{mode: system|inApp}, appSwitcher, keyboardDismiss, waitFor{text,timeoutMs}, alert{op: get|wait|accept|dismiss}, openUrl{url}, launch{bundleId}, terminate{bundleId}, setLocation{lat,lon}, appearance{appearance: light|dark}, clipboardRead, clipboardWrite{text}, screenshot{path?} (the whole screen, plain; path also saves it: a file, or a folder ending in /), screenshotElement{target}.', inputSchema: { type: 'object', properties: { steps: { type: 'array', minItems: 1, maxItems: 50, items: stepSchema } }, required: ['steps'] } },
  { name: 'mobile_apps', description: 'List the apps installed on the phone, system apps included, with their names and bundle ids. An optional udid lists apps without a live connection. A bundle id picks the app for launch, terminate, permissions, notifications and data resets in the other mobile_ tools.', inputSchema: { type: 'object', properties: { udid: { type: 'string' } } } },
  { name: 'mobile_configure', description: `Change the phone's settings, several at once, in order; every action is checked before anything runs, and it stops at the first that fails, saying how far it got. Actions: permission{op: grant|revoke|reset, service, bundleId} — services: ${services}; the app may be terminated to apply it; contentSize{size} — one of ${contentSizes}; statusBar{op: override|clear} — override pins 9:41 with a full battery for clean screenshots, clear restores the live status bar.`, inputSchema: { type: 'object', properties: { actions: { type: 'array', minItems: 1, maxItems: 20, items: configurationSchema } }, required: ['actions'] } },
  { name: 'mobile_notify', description: 'Deliver a local notification to an app on the phone, as a push would. The payload is APNs JSON, e.g. {"aps":{"alert":{"title":"Export done","body":"Tap to reopen"},"sound":"default"}}; a foreground app that handles notifications shows it its own way.', inputSchema: { type: 'object', properties: { bundleId, payload: { type: 'object', description: 'The APNs payload to deliver.' } }, required: ['bundleId', 'payload'] } },
  { name: 'mobile_reset', description: 'Destructive, for clean-slate setup. what: app-data erases everything one app has saved — documents, preferences, caches — terminating it first; keychain empties the whole simulator keychain, every saved password on the phone. Prefer logging out inside the app when that is enough.', inputSchema: { type: 'object', properties: { what: { type: 'string', enum: ['app-data', 'keychain'] }, bundleId }, required: ['what'] } },
  { name: 'mobile_connection', description: 'Manage the same simulator connection shown in Vellum. action: devices lists available iOS simulators; status reports the view, device and driver state; connect opens the mobile view and connects (boots the selected device if needed), reusing an existing connection when possible; disconnect stops the driver and updates the view; boot/shutdown explicitly change a device’s lifecycle (require udid). Connect accepts udid, fps, scale and an optional native helperDir. An omitted udid uses the view’s selected device. Disconnect does not shut down the simulator.', inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['devices', 'status', 'connect', 'disconnect', 'boot', 'shutdown'] }, udid: { type: 'string' }, fps: { type: 'integer', minimum: 1 }, scale: { type: 'integer', minimum: 1 }, helperDir: { type: 'string' } }, required: ['action'] } },
  { name: 'mobile_input', description: 'Low-level Driver input when screen-aware mobile_steps cannot express the action. Pass 1–50 actions. Coordinates are normalized 0..1. pointer{phase,x,y,mods?}; scroll{phase,x,y,dx,dy}; tap/doubleTap{x,y}; longPress{x,y,holdMs?}; drag{x1,y1,x2,y2,holdMs?,moveMs?,destinationHoldMs?}; touch2{phase,x1,y1,x2,y2}; key{name}; keyCombo{keys}; text{text}; button{name,presses?,holdSecs?}. Pointer and touch2 phases are down/move/up; scroll phases are began/changed/ended/momentum/cancelled. Finish each contact with up and each scroll with ended. Validates the whole batch first and stops on failure. Returns each result (including false for unsupported keys). Snapshot afterward to inspect the screen.', inputSchema: { type: 'object', properties: { actions: { type: 'array', minItems: 1, maxItems: 50, items: inputSchema } }, required: ['actions'] } },
  { name: 'mobile_inspect', description: 'Read the connected driver directly. what: status returns udid/state; stats returns frame/input performance; events returns recent state/diagnostic events and latest BGRA frame dimensions/sequence (the live bytes are rendered in Vellum); accessibility returns the raw accessibility tree; screen returns screen dimensions in points; grid exposes Grid operations. For grid, cols defaults to 6; op is info (rows/cols), name{row,col} (zero-based), center{cell}, rect{cell}, or at{x,y} (normalized 0..1). Use mobile_snapshot for a settled annotated screen and image.', inputSchema: { type: 'object', properties: { what: { type: 'string', enum: ['status', 'stats', 'events', 'accessibility', 'screen', 'grid'] }, op: { type: 'string', enum: ['info', 'name', 'center', 'rect', 'at'] }, cols: { type: 'integer', minimum: 1 }, row: { type: 'integer', minimum: 0 }, col: { type: 'integer', minimum: 0 }, cell: { type: 'string' }, x: point, y: point }, required: ['what'] } },
]
const png = (bytes: Uint8Array) => ({ type: 'image', data: Buffer.from(bytes).toString('base64'), mimeType: 'image/png' })
const content = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] })
function numeric(args: any, key: string, min = -Infinity, max = Infinity, optional = false): number | undefined {
  const value = args[key]
  if (optional && value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${key}: expected a finite number from ${min} to ${max}`)
  return value
}
function integer(args: any, key: string, min = 0, optional = false): number | undefined {
  const value = numeric(args, key, min, 0xffffffff, optional)
  if (value !== undefined && !Number.isInteger(value)) throw new Error(`${key} must be an integer`)
  return value
}
function text(args: any, key: string, empty = false): string {
  if (typeof args[key] !== 'string' || !empty && !args[key]) throw new Error(`Give ${key} as ${empty ? 'a' : 'a non-empty'} string`)
  return args[key]
}
function choice<T extends string>(value: unknown, options: readonly T[], label: string): T {
  const found = options.find((item) => item === value)
  if (!found) throw new Error(`${label} must be one of: ${options.join(', ')}`)
  return found
}

/** Validate every raw input before the first touches the phone. */
function inputAction(driver: MobileDriver, a: any): () => unknown {
  if (!a || typeof a !== 'object' || Array.isArray(a)) throw new Error('Each input action must be an object')
  const action = text(a, 'action')
  if (['pointer', 'scroll', 'tap', 'doubleTap', 'longPress'].includes(action)) {
    const x = numeric(a, 'x', 0, 1)!, y = numeric(a, 'y', 0, 1)!
    if (action === 'tap') return () => driver.tap(x, y)
    if (action === 'doubleTap') return () => driver.doubleTap(x, y)
    if (action === 'longPress') { const hold = integer(a, 'holdMs', 0, true); return () => driver.longPress(x, y, hold) }
    if (action === 'scroll') {
      const phase = choice(a.phase, ['began', 'changed', 'ended', 'momentum', 'cancelled'] as const, 'scroll phase')
      const dx = numeric(a, 'dx')!, dy = numeric(a, 'dy')!
      return () => driver.scroll(phase === 'cancelled' ? 'ended' : phase, x, y, dx, dy)
    }
    const phase = choice(a.phase, ['down', 'move', 'up'] as const, 'pointer phase')
    if (a.mods !== undefined && (!a.mods || typeof a.mods !== 'object' || Array.isArray(a.mods) || Object.entries(a.mods).some(([key, value]) => !['alt', 'shift', 'ctrl', 'meta'].includes(key) || typeof value !== 'boolean'))) throw new Error('mods contains optional alt, shift, ctrl and meta booleans')
    return () => driver.pointer(phase, x, y, a.mods)
  }
  if (action === 'drag' || action === 'touch2') {
    const x1 = numeric(a, 'x1', 0, 1)!, y1 = numeric(a, 'y1', 0, 1)!, x2 = numeric(a, 'x2', 0, 1)!, y2 = numeric(a, 'y2', 0, 1)!
    if (action === 'touch2') { const phase = choice(a.phase, ['down', 'move', 'up'] as const, 'touch2 phase'); return () => driver.touch2(phase, x1, y1, x2, y2) }
    const options = { holdMs: integer(a, 'holdMs', 0, true), moveMs: integer(a, 'moveMs', 0, true), destinationHoldMs: integer(a, 'destinationHoldMs', 0, true) }
    return () => driver.drag(x1, y1, x2, y2, options)
  }
  if (action === 'key') { const name = text(a, 'name'); return () => driver.key(name) }
  if (action === 'keyCombo') {
    if (!Array.isArray(a.keys) || !a.keys.length || a.keys.some((key: unknown) => typeof key !== 'string' || !key)) throw new Error('keys must be a non-empty array of key names')
    return () => driver.keyCombo(a.keys)
  }
  if (action === 'text') { const value = text(a, 'text', true); return () => driver.text(value) }
  if (action === 'button') {
    const name = choice(a.name, ['home', 'lock', 'side', 'siri', 'volume-up', 'volume-down'] as const, 'button name')
    const presses = integer(a, 'presses', 1, true), hold = numeric(a, 'holdSecs', 0, Infinity, true)
    return () => driver.button(name, presses, hold)
  }
  throw new Error(`Unknown input action ${JSON.stringify(action)}`)
}

function inspect(driver: MobileDriver, args: any) {
  if (args.what === 'status') return { udid: driver.udid, state: driver.state }
  if (args.what === 'stats') return driver.stats()
  if (args.what === 'accessibility') return driver.accessibility()
  if (args.what === 'screen') return driver.screenPoints()
  if (args.what !== 'grid') throw new Error('what is status, stats, accessibility, screen or grid')
  const grid = driver.grid(integer(args, 'cols', 1, true))
  if (!grid) throw new Error('Screen dimensions are not available yet')
  switch (args.op ?? 'info') {
    case 'info': return { rows: grid.rows, cols: grid.cols }
    case 'name': {
      const row = integer(args, 'row')!, col = integer(args, 'col')!
      if (row >= grid.rows || col >= grid.cols) throw new Error('row and col must be inside the grid')
      return grid.name(row, col)
    }
    case 'center': return grid.center(text(args, 'cell'))
    case 'rect': return grid.rect(text(args, 'cell'))
    case 'at': return grid.at(numeric(args, 'x', 0, 1)!, numeric(args, 'y', 0, 1)!)
    default: throw new Error('grid op is info, name, center, rect or at')
  }
}

type Contacts = { pointer?: [number, number]; touch2?: [number, number, number, number]; scroll?: [number, number] }
const contacts = new WeakMap<MobileDriver, Contacts>()
function rememberInput(driver: MobileDriver, action: any) {
  const active = contacts.get(driver) ?? {}
  if (action.action === 'pointer') active.pointer = action.phase === 'up' ? undefined : [action.x, action.y]
  if (action.action === 'touch2') active.touch2 = action.phase === 'up' ? undefined : [action.x1, action.y1, action.x2, action.y2]
  if (action.action === 'scroll') active.scroll = ['ended', 'cancelled'].includes(action.phase) ? undefined : [action.x, action.y]
  contacts.set(driver, active)
}
function releaseInput(driver: MobileDriver) {
  const active = contacts.get(driver)
  if (!active) return
  try { if (active.pointer) driver.pointer('up', ...active.pointer) } catch {}
  try { if (active.touch2) driver.touch2('up', ...active.touch2) } catch {}
  try { if (active.scroll) driver.scroll('ended', ...active.scroll, 0, 0) } catch {}
  contacts.delete(driver)
}

/** One mobile_configure action, checked up front and named for the report; calling it applies it. */
function configureAction(driver: MobileDriver, action: any): { run: () => Promise<void>; label: string } {
  if (!action || typeof action !== 'object' || typeof action.action !== 'string') throw new Error('Every configure action is an object with an action: permission, contentSize or statusBar')
  const app = typeof action.bundleId === 'string' && action.bundleId ? action.bundleId : ''
  if (action.action === 'permission') {
    if (!['grant', 'revoke', 'reset'].includes(action.op)) throw new Error('permission op is grant, revoke or reset')
    if (!app) throw new Error('permission needs the app bundleId it applies to')
    if (!services.split(', ').includes(action.service)) throw new Error(`Unknown permission service ${JSON.stringify(action.service)}. Services: ${services}`)
    return {
      run: () => action.op === 'grant' ? driver.grantPermission(action.service, app) : action.op === 'revoke' ? driver.revokePermission(action.service, app) : driver.resetPermission(action.service, app),
      label: `${action.op} ${action.service === 'all' ? 'all permissions' : action.service} for ${app}`,
    }
  }
  if (action.action === 'contentSize') {
    if (!contentSizes.split(', ').includes(action.size)) throw new Error(`contentSize size is one of: ${contentSizes}`)
    return { run: () => driver.setContentSize(action.size), label: `text size ${action.size}` }
  }
  if (action.action === 'statusBar') {
    if (action.op === 'override') return { run: () => driver.statusBarOverride(), label: 'status bar pinned at 9:41, battery full' }
    if (action.op === 'clear') return { run: () => driver.statusBarClear(), label: 'status bar live again' }
    throw new Error('statusBar op is override or clear')
  }
  throw new Error(`Unknown configure action ${JSON.stringify(action.action)}. Actions: permission, contentSize, statusBar`)
}

async function dispatchMobileTool(name: string, args: any) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be an object')
  if (name === 'mobile_connection') {
    if (args.action === 'devices') return content(await mobileDevices())
    if (args.action === 'status') return content(mobileConnectionStatus())
    if (args.action === 'disconnect') return content(disconnectMobile())
    if (args.action === 'boot' || args.action === 'shutdown') {
      const udid = text(args, 'udid')
      if (args.action === 'boot') await bootMobile(udid)
      else { if (liveMobile()?.device.udid === udid) disconnectMobile(); await shutdownMobile(udid) }
      return content({ action: args.action, udid, ok: true })
    }
    if (args.action !== 'connect') throw new Error('action is devices, status, connect, disconnect, boot or shutdown')
    if (args.udid !== undefined) text(args, 'udid')
    if (args.helperDir !== undefined) text(args, 'helperDir')
    const fps = integer(args, 'fps', 1, true), scale = integer(args, 'scale', 1, true)
    return content(await connectMobile({ udid: args.udid, fps, scale, helperDir: args.helperDir }))
  }
  if (name === 'mobile_inspect' && args.what === 'events') return content(mobileEvents())
  if (name === 'mobile_apps' && args.udid !== undefined) return content(mobileSDK().listApps(text(args, 'udid')))
  return withMobileAgent(async (agent, { driver, device }) => {
    if (name === 'mobile_inspect') return content(await inspect(driver, args))
    if (name === 'mobile_input') {
      if (!Array.isArray(args.actions) || !args.actions.length || args.actions.length > 50) throw new Error('Give 1–50 input actions')
      const plan = args.actions.map((action: any) => inputAction(driver, action))
      const results: unknown[] = []
      for (let index = 0; index < plan.length; index++) {
        try {
          const result = await plan[index]()
          rememberInput(driver, args.actions[index])
          results.push({ action: args.actions[index].action, result: result ?? null })
          if (result === false) throw new Error('The driver did not recognize this key or key combination')
        } catch (error) {
          releaseInput(driver)
          return { ...content({ completed: index, results, failed: { index, error: String((error as Error).message) } }), isError: true }
        }
      }
      return content({ completed: results.length, results, failed: null })
    }
    if (name === 'mobile_snapshot') {
      for (const key of ['image', 'grid']) if (args[key] !== undefined && typeof args[key] !== 'boolean') throw new Error(`${key} must be a boolean`)
      const settleMs = integer(args, 'settleMs', 0, true), cols = integer(args, 'cols', 1, true)
      const { image, ...snapshot } = await agent.snapshot({ image: args.image !== false, grid: args.grid === true, settleMs, cols })
      return { structuredContent: snapshot, content: [{ type: 'text', text: `${device.name}\n${JSON.stringify(snapshot, null, 2)}` }, ...(image ? [png(image)] : [])] }
    }
    if (name === 'mobile_screenshot') {
      if (args.path !== undefined && (typeof args.path !== 'string' || !args.path)) throw new Error('path must be a non-empty string')
      const shot = await agent.screenshot(args.path)
      return { content: [{ type: 'text', text: args.path ? `${device.name} · saved to ${path.resolve(args.path)}` : device.name }, png(shot)] }
    }
    if (name === 'mobile_tap') {
      if (typeof args.target !== 'string' || !args.target) throw new Error('Give a target: e4, a label, a grid cell, or @x,y')
      if (args.expect !== undefined && typeof args.expect !== 'string') throw new Error('expect must be a string')
      const tapped = await agent.tap(args.target, typeof args.expect === 'string' ? { expect: args.expect } : {})
      return { content: [{ type: 'text', text: JSON.stringify(tapped) }] }
    }
    if (name === 'mobile_apps') {
      const apps = await driver.apps()
      return { content: [{ type: 'text', text: `${device.name} · ${apps.length} apps\n${JSON.stringify(apps, null, 2)}` }] }
    }
    if (name === 'mobile_configure') {
      const actions = Array.isArray(args.actions) ? args.actions : []
      if (!actions.length || actions.length > 20) throw new Error('Give 1–20 actions')
      const plan = actions.map((action: any) => configureAction(driver, action))
      const done: string[] = []
      for (const step of plan) {
        try { await step.run() } catch (error) { return { content: [{ type: 'text', text: `${step.label} failed: ${String((error as Error).message)}.${done.length ? ` Already done: ${done.join('; ')}.` : ''}` }], isError: true } }
        done.push(step.label)
      }
      return { content: [{ type: 'text', text: `Done: ${done.join('; ')}.` }] }
    }
    if (name === 'mobile_notify') {
      const app = typeof args.bundleId === 'string' && args.bundleId ? args.bundleId : ''
      if (!app) throw new Error('Give the bundleId of the app to notify')
      if (!args.payload || typeof args.payload !== 'object' || Array.isArray(args.payload)) throw new Error('Give the APNs payload as an object, e.g. {"aps":{"alert":"Done"}}')
      const json = JSON.stringify(args.payload)
      if (json.length > 10_000) throw new Error('The payload is too large')
      const file = path.join(paths.home, `push-${crypto.randomUUID()}.json`)
      writeFileSync(file, json)
      try { await driver.pushNotification(app, file) } finally { rmSync(file, { force: true }) }
      return { content: [{ type: 'text', text: `Delivered a notification to ${app} (${device.name}).` }] }
    }
    if (name === 'mobile_reset') {
      const app = typeof args.bundleId === 'string' && args.bundleId ? args.bundleId : ''
      if (args.what === 'app-data') {
        if (!app) throw new Error('app-data needs the bundleId of the app to erase')
        await driver.clearAppData(app)
        return { content: [{ type: 'text', text: `Erased ${app}'s data on ${device.name} (the app was terminated first).` }] }
      }
      if (args.what === 'keychain') {
        await driver.resetKeychain()
        return { content: [{ type: 'text', text: `Reset the keychain on ${device.name}.` }] }
      }
      throw new Error('what is app-data (with bundleId) or keychain')
    }
    if (!Array.isArray(args.steps) || !args.steps.length || args.steps.length > 50) throw new Error('Give 1–50 steps')
    const { screenshots = [], snapshot, ...report } = await agent.steps(args.steps)
    const text = `${JSON.stringify({ ...report, screenshots: screenshots.map((shot) => shot.file ?? shot.target) })}${snapshot ? `\n\nScreen now:\n${snapshot.text}` : ''}`
    return { content: [{ type: 'text', text }, ...screenshots.map((shot) => png(shot.png))], ...(report.ok ? {} : { isError: true }) }
  })
}

// A shared phone has one ordered stream of tool operations, even across notes.
let pending: Promise<unknown> = Promise.resolve()
export function mobileCall(name: string, args: unknown) {
  const call = pending.then(() => dispatchMobileTool(name, args))
  pending = call.catch(() => {})
  return call
}
