import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import type { ToolbarTarget } from './browser-types'
import { readSettings } from './store'

export type BoundTarget = { key: string; targetId: string; installationId: string; tabId: number; endpoint: string; identity: string; verify: () => Promise<void> }
const presence = new Map<string, ToolbarTarget>()
const claims = new Map<string, { noteId: string; target: BoundTarget }>()
const listeners = new Set<() => void>()
export const subscribeToolbarTargets = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const changed = () => { for (const listener of listeners) listener() }
export function recordToolbarPresence(value: unknown, receivedAt = Date.now()) {
  const p = value as Record<string, unknown>
  if (!p || typeof p !== 'object' || typeof p.installationId !== 'string' || !/^[\w-]{1,100}$/.test(p.installationId) || typeof p.toolbarId !== 'string' || !/^[\w-]{1,100}$/.test(p.toolbarId) || !Number.isInteger(p.tabId) || !Number.isInteger(p.windowId) || typeof p.open !== 'boolean') throw new Error('Invalid toolbar presence')
  const key = `${p.installationId}:${p.tabId}:${p.toolbarId}`
  if (!p.open) { presence.delete(key); changed(); return }
  if (typeof p.url !== 'string' || p.url.length > 8192 || typeof p.title !== 'string' || p.title.length > 2000 || p.targetId !== undefined && (typeof p.targetId !== 'string' || !/^[\w-]{1,160}$/.test(p.targetId))) throw new Error('Invalid toolbar target')
  // One open toolbar per actual tab/install. A navigation replaces its content-script instance.
  for (const [old, target] of presence) if (target.installationId === p.installationId && target.tabId === p.tabId) presence.delete(old)
  presence.set(key, { key, installationId: p.installationId, toolbarId: p.toolbarId, tabId: p.tabId as number, windowId: p.windowId as number, targetId: p.targetId as string | undefined, url: p.url, title: p.title, receivedAt })
  changed()
}
export function listToolbarTargets(now = Date.now()) {
  for (const [key, target] of presence) if (now - target.receivedAt > 45_000) presence.delete(key)
  return [...presence.values()]
}
async function endpoints() {
  const ports = new Set(readSettings().browserCdpPorts ?? [])
  for (const folder of ['Google/Chrome', 'Chromium', 'Google/Chrome for Testing']) {
    try { const port = Number(readFileSync(path.join(homedir(), 'Library/Application Support', folder, 'DevToolsActivePort'), 'utf8').split('\n')[0]); if (port > 0 && port <= 65535) ports.add(port) } catch {}
  }
  return (await Promise.all([...ports].filter(port => Number.isInteger(port) && port > 0 && port <= 65535).map(async port => {
    const endpoint = `http://127.0.0.1:${port}`
    try {
      const result = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1000), redirect: 'error' })
      const version = await result.json()
      const ws = new URL(version.webSocketDebuggerUrl)
      if (!['127.0.0.1', 'localhost'].includes(ws.hostname) || !ws.pathname.startsWith('/devtools/browser/')) return
      const targets: any[] = await (await fetch(`${endpoint}/json/list`, { signal: AbortSignal.timeout(1000), redirect: 'error' })).json()
      return { endpoint, identity: `${port}${ws.pathname}`, targets }
    } catch { return }
  }))).filter(result => result !== undefined)
}
export async function bindToolbarTarget(noteId: string, targetKey: string): Promise<BoundTarget> {
  const toolbar = listToolbarTargets().find(target => target.key === targetKey)
  if (!toolbar?.targetId) throw new Error('Chrome not available for control. Open Snapshot on the tab and expose a local CDP endpoint, or use a managed browser.')
  const available = await endpoints()
  const matches = available.filter(browser => browser.targets.some(target => target.type === 'page' && target.id === toolbar.targetId))
  if (matches.length !== 1) throw new Error('Chrome not available for control. The exact toolbar target could not be verified against one approved local browser.')
  const browser = matches[0]!, claimKey = `${browser.identity}:${toolbar.targetId}`
  const existing = claims.get(claimKey)
  if (existing && existing.noteId !== noteId) throw new Error(`target_in_use: owned by note ${existing.noteId}. Use Move here to transfer it.`)
  const target: BoundTarget = { key: targetKey, targetId: toolbar.targetId, installationId: toolbar.installationId, tabId: toolbar.tabId, endpoint: browser.endpoint, identity: claimKey, verify: async () => {
    const current = (await endpoints()).find(item => item.identity === browser.identity)
    if (!current?.targets.some(item => item.type === 'page' && item.id === toolbar.targetId)) throw new Error('target_gone: the selected Chrome tab was closed or its browser changed. Select a target explicitly.')
  } }
  claims.set(claimKey, { noteId, target }); changed()
  return target
}
export function browserTargetOwner(targetKey: string) { const toolbar = listToolbarTargets().find(target => target.key === targetKey); return [...claims.values()].find(claim => claim.target.key === targetKey || toolbar && claim.target.installationId === toolbar.installationId && claim.target.targetId === toolbar.targetId)?.noteId }
export function releaseBrowserTarget(noteId: string) { for (const [key, claim] of claims) if (claim.noteId === noteId) claims.delete(key); changed() }
export function claimedToolbar(installationId: string, tabId: number) {
  return [...claims.values()].find(claim => claim.target.installationId === installationId && claim.target.tabId === tabId)
}
