import { createRequire } from 'node:module'
import path from 'node:path'
import { compiled, isMac } from './platform'

export type MobileDevice = { udid: string; name: string; state: string; runtime: string; deviceType?: string }
export type MobileFrame = { type: 'frame'; width: number; height: number; data: Uint8Array; seq?: number }
export type MobileEvent = MobileFrame | { type: 'state'; state: string } | { type: 'note'; text: string }
type Modifiers = { alt?: boolean; shift?: boolean; ctrl?: boolean; meta?: boolean }
export type MobileStartOptions = { udid?: string; fps?: number; scale?: number; helperDir?: string }
export type MobileGrid = {
  rows: number
  cols: number
  name(row: number, col: number): string
  center(name: string): { x: number; y: number } | null
  rect(name: string): { x: number; y: number; width: number; height: number } | null
  at(x: number, y: number): string
}
/** simdriver's agent layer (one per driver): numbered elements, validated taps, multi-step runs. */
export type MobileAgent = {
  snapshot(options?: { settleMs?: number; image?: boolean; grid?: boolean; cols?: number }): Promise<{ text: string; image: Uint8Array | null; settled: boolean; mode: string; elements: unknown[] } & Record<string, unknown>>
  tap(target: string, options?: { expect?: string }): Promise<{ target: string; name: string; at: [number, number] }>
  steps(steps: unknown[]): Promise<{ ok: boolean; completed: number; failed: { index: number; code: string; error: string } | null; screenshots?: { target: string; png: Uint8Array }[]; snapshot: { text: string } | null } & Record<string, unknown>>
}
export type MobileApp = { bundleId: string; name: string; appType: string }
export type MobileDriver = {
  readonly udid: string
  state: string
  pointer(phase: 'down' | 'move' | 'up', x: number, y: number, mods?: Modifiers): void
  scroll(phase: 'began' | 'changed' | 'ended' | 'momentum' | 'cancelled', x: number, y: number, dx: number, dy: number): void
  tap(x: number, y: number): void
  doubleTap(x: number, y: number): Promise<void>
  longPress(x: number, y: number, holdMs?: number): Promise<void>
  drag(x1: number, y1: number, x2: number, y2: number, options?: { holdMs?: number; moveMs?: number; destinationHoldMs?: number }): Promise<void>
  touch2(phase: 'down' | 'move' | 'up', x1: number, y1: number, x2: number, y2: number): void
  key(name: string): boolean
  keyCombo(keys: string[]): boolean
  text(text: string): void
  button(name: string, presses?: number, holdSecs?: number): void
  apps(): Promise<MobileApp[]>
  accessibility(): Promise<unknown>
  screenPoints(): { width: number; height: number } | null
  grid(cols?: number): MobileGrid | null
  stats(): { fps: number; activeFps: number; idleFps: number; lastResponseMs?: number; maxActiveGapMs: number; frames: number }
  grantPermission(service: string, bundleId: string): Promise<void>
  revokePermission(service: string, bundleId: string): Promise<void>
  resetPermission(service: string, bundleId: string): Promise<void>
  setContentSize(size: string): Promise<void>
  statusBarOverride(): Promise<void>
  statusBarClear(): Promise<void>
  pushNotification(bundleId: string, payloadPath: string): Promise<void>
  resetKeychain(): Promise<void>
  clearAppData(bundleId: string): Promise<void>
  agent(): MobileAgent
  stop(): void
}
type MobileSDK = { Driver: { start(options: MobileStartOptions, onEvent: (event: MobileEvent) => void): Promise<MobileDriver> }; listApps(udid: string): MobileApp[] }
export const mobileSupported = isMac && process.arch === 'arm64'
const requireMobile = createRequire(import.meta.url)
let sdk: MobileSDK | undefined

export function mobileSDK(): MobileSDK {
  if (!mobileSupported) throw new Error('Mobile view requires macOS on Apple Silicon.')
  const entry = compiled ? path.join(path.dirname(process.execPath), 'helpers', 'simdriver', 'index.js') : 'simdriver'
  return sdk ??= requireMobile(entry) as MobileSDK
}

async function simctl(args: string[], signal?: AbortSignal): Promise<string> {
  const child = Bun.spawn(['xcrun', 'simctl', ...args], { stdout: 'pipe', stderr: 'pipe', signal, timeout: 90_000 })
  const [code, out, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  if (code !== 0) throw new Error(error.trim() || 'The simulator command could not finish.')
  return out
}

export async function mobileDevices(signal?: AbortSignal): Promise<MobileDevice[]> {
  if (!mobileSupported) throw new Error('Mobile view requires macOS on Apple Silicon.')
  const result = JSON.parse(await simctl(['list', 'devices', 'available', '-j'], signal)) as {
    devices: Record<string, { udid: string; name: string; state: string; deviceTypeIdentifier?: string; isAvailable?: boolean }[]>
  }
  return Object.entries(result.devices).filter(([runtime]) => runtime.includes('.iOS-')).flatMap(([runtime, devices]) =>
    devices.filter((device) => device.isAvailable !== false).map(({ udid, name, state, deviceTypeIdentifier }) => ({ udid, name, state, runtime, deviceType: deviceTypeIdentifier })),
  ).sort((a, b) => Number(b.state === 'Booted') - Number(a.state === 'Booted') || a.name.localeCompare(b.name))
}

export async function bootMobile(udid: string, signal?: AbortSignal) {
  await simctl(['boot', udid], signal)
  await simctl(['bootstatus', udid], signal)
}
export async function shutdownMobile(udid: string) { await simctl(['shutdown', udid]) }

// The phone on screen, for agents: the mobile view registers its driver once connected, and
// the bridge's mobile_* tools act on it (core/bridge.ts). One per window, like the view.
type Live = { driver: MobileDriver; device: MobileDevice }
let live: Live | undefined
const activity = new Set<(busy: boolean) => void>()
let running = 0

export function setLiveMobile(next: Live | undefined) { live = next }
export function liveMobile() { return live }
let frameInfo: { width: number; height: number; seq?: number } | undefined
let events: { at: string; type: 'state' | 'note'; state?: string; text?: string }[] = []
export function recordMobileEvent(event: MobileEvent) {
  if (event.type === 'frame') { frameInfo = { width: event.width, height: event.height, seq: event.seq }; return }
  events = [...events.slice(-31), { ...event, at: new Date().toISOString() }]
}
export function mobileEvents() { return { frame: frameInfo, events } }
export function clearMobileEvents() { frameInfo = undefined; events = [] }

type MobileHost = { connect(options: MobileStartOptions): Promise<void>; disconnect(): void }
let host: MobileHost | undefined
let openView: (() => void) | undefined
const hostWaiters = new Set<() => void>()
export function registerMobileHost(next: MobileHost) {
  host = next
  for (const ready of hostWaiters) ready()
  return () => { if (host === next) host = undefined }
}
export function registerMobileOpener(open: () => void) {
  openView = open
  return () => { if (openView === open) openView = undefined }
}
export function mobileConnectionStatus() {
  return { viewOpen: Boolean(host), connected: Boolean(live), device: live?.device, state: live?.driver.state ?? 'stopped' }
}
export async function connectMobile(options: MobileStartOptions) {
  if (!host) {
    if (!openView) throw new Error('The mobile view is unavailable in this window.')
    await new Promise<void>((resolve, reject) => {
      const done = () => { clearTimeout(timer); hostWaiters.delete(done); resolve() }
      const timer = setTimeout(() => { hostWaiters.delete(done); reject(new Error('The mobile view could not open.')) }, 5000)
      hostWaiters.add(done)
      openView!()
    })
  }
  if (!host) throw new Error('The mobile view closed before connecting.')
  await host.connect(options)
  return mobileConnectionStatus()
}
export function disconnectMobile() {
  if (host) host.disconnect()
  else { live?.driver.stop(); live = undefined }
  return mobileConnectionStatus()
}

/** Runs `action` on the live phone's agent layer; the view shows the phone as busy meanwhile. */
export async function withMobileAgent<T>(action: (agent: MobileAgent, current: Live) => Promise<T>): Promise<T> {
  const current = live
  if (!current) throw new Error('No phone is connected. Open the mobile view in Vellum (⇧⌘M) and connect a simulator, then try again.')
  if (running++ === 0) for (const listener of activity) listener(true)
  try { return await action(current.driver.agent(), current) }
  finally { if (--running === 0) for (const listener of activity) listener(false) }
}

export function onMobileActivity(listener: (busy: boolean) => void) {
  activity.add(listener)
  return () => { activity.delete(listener) }
}
