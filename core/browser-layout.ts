import type { BrowserKey, BrowserPlacement } from './browser-types'
import { browserKey } from './browser-view'
export type BrowserLayout = { placement: BrowserPlacement; previous: 'inline' | 'floating'; pinned: boolean; minimized: boolean; x?: number; y?: number }
const layouts = new Map<string, BrowserLayout>()
const listeners = new Set<() => void>()
// The confirmed presentation: the screen rests inline in the note, floats only while
// scrolled above view during active browser work, and returns inline when visible again.
const initial: BrowserLayout = { placement: 'inline', previous: 'inline', pinned: false, minimized: false }
export const subscribeBrowserLayout = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export function browserLayout(key: BrowserKey) { return layouts.get(browserKey(key)) ?? initial }
export function changeBrowserLayout(key: BrowserKey, patch: Partial<BrowserLayout>) { layouts.set(browserKey(key), { ...browserLayout(key), ...patch }); for (const listener of listeners) listener() }
export function expandBrowser(key: BrowserKey) { const layout = browserLayout(key); if (layout.placement === 'expanded') return; changeBrowserLayout(key, { previous: layout.placement === 'floating' ? 'floating' : 'inline', placement: 'expanded', minimized: false }) }
export function collapseBrowser(key: BrowserKey) { changeBrowserLayout(key, { placement: browserLayout(key).previous }) }
export function minimizeBrowser(key: BrowserKey) { const layout = browserLayout(key); changeBrowserLayout(key, { placement: 'minimized', minimized: true, previous: layout.placement === 'floating' ? 'floating' : layout.previous }) }
export function reopenBrowser(key: BrowserKey) { changeBrowserLayout(key, { placement: 'floating', pinned: true, minimized: false }) }
export function dockBrowser(key: BrowserKey) { changeBrowserLayout(key, { placement: 'inline', previous: 'inline', minimized: false, pinned: false }) }
export const browserInlineNodes = new Map<string, number>()
