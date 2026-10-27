import type { BrowserSession } from './capture'
import type { BrowserEvent } from './browser-types'
import type { Block, ToolCall } from './threads'

export const browserBlockId = (event: BrowserEvent) => `browser-${event.key.session}-${event.key.generation}`
export function applyBrowserEvent(previous: BrowserSession | undefined, event: BrowserEvent): BrowserSession {
  const browser: BrowserSession = { streamPort: 0, ...previous, ...event.key, ...(event.runId ? { runId: event.runId } : {}) }
  if (event.type === 'session') Object.assign(browser, { phase: event.phase, mode: event.binding.mode, targetId: event.binding.mode === 'toolbar' ? event.binding.targetId : undefined, error: event.error, streamPort: event.streamPort ?? browser.streamPort, url: event.url ?? browser.url, recording: event.recording })
  else if (event.type === 'warning') {
    const old = browser.activities ?? []
    if (!old.some(item => item.id === event.actionId)) browser.activities = [...old.slice(-99), { id: event.actionId, title: 'Browser warning', at: event.at, summary: event.message }]
  }
  else if (event.type === 'action-start') {
    browser.lastActionId = event.actionId
    browser.phase = 'working'
    const old = browser.activities ?? []
    if (!old.some(item => item.id === event.actionId)) browser.activities = [...old.slice(-99), { id: event.actionId, title: event.title, at: event.at }]
  } else if (event.type === 'action-end') {
    browser.activities = (browser.activities ?? []).map(item => item.id === event.actionId ? { ...item, exitCode: event.exitCode, durationMs: event.durationMs, summary: event.summary, artifacts: event.artifacts } : item)
    const screenshot = event.artifacts.find(artifact => artifact.kind === 'screenshot')
    if (screenshot) browser.screenshot = screenshot.path
  }
  return browser
}
/** Only host-captured browser provenance can suppress a card; preserve runner failures. */
export function browserVisibleCalls(items: ToolCall[]): ToolCall[] {
  return items.flatMap(call => {
    if (call.origin === 'bridge' && call.presentation?.kind === 'browser' && call.status !== 'error') return []
    if (!call.children?.length) return [call]
    const children = browserVisibleCalls(call.children)
    if (children.length === call.children.length) return [call]
    if (call.status === 'error') return [{ ...call, children: children.length ? children : undefined }]
    return children.length ? [{ ...call, children }] : []
  })
}
export function projectBrowserActivity(blocks: Block[]) {
  const browserBlocks = new Map<string, BrowserSession>()
  const suppressedToolIds = new Set<string>()
  const collect = (calls: ToolCall[]) => { for (const call of calls) { if (call.origin === 'bridge' && call.presentation?.kind === 'browser' && call.status !== 'error') suppressedToolIds.add(call.id); if (call.children) collect(call.children) } }
  for (const block of blocks) {
    if (block.kind === 'browser') browserBlocks.set(block.id, block.browser)
    else if (block.kind === 'activity') collect(block.items)
    else if (block.kind === 'shell' && block.call) collect([block.call])
  }
  return { browserBlocks, suppressedToolIds }
}
