import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react'
import { DismissableLayer, useGpuixRequired, type PublicInstance } from '@gpuix/react'
import type { BrowserSession } from '../core/capture'
import type { BrowserKey } from '../core/browser-types'
import { browserWorkActive, releaseBrowserControl, subscribeBrowserRuntime } from '../core/browser-runtime'
import { browserKey, releaseBrowserInput, setBrowserDemand } from '../core/browser-view'
import { browserInlineNodes, browserLayout, changeBrowserLayout, collapseBrowser, dockBrowser, expandBrowser, minimizeBrowser, reopenBrowser, subscribeBrowserLayout } from '../core/browser-layout'
import type { Thread } from '../core/threads'
import type { RowWatch } from './Timeline'
import { AgentScreen } from './AgentScreen'
import { Button, Icon } from '../components'
import { useM } from './kit'
import { radiusXl } from './theme'

export function BrowserLauncher({ browser }: { browser: BrowserSession }) {
  const m = useM(), key = browser as BrowserKey
  useSyncExternalStore(subscribeBrowserLayout, () => browserLayout(key))
  return <Button testId="open-browser" selected={browserLayout(key).placement !== 'minimized'} title="Agent Screen" onPress={() => browserLayout(key).placement === 'floating' || browserLayout(key).placement === 'expanded' ? minimizeBrowser(key) : reopenBrowser(key)}><Icon name="browser" size={14} color={browser.phase === 'error' ? m.danger : undefined} /></Button>
}
export function AgentScreenHost({ browser, thread, rows, page, onTakeControl, onDrivingChange }: { browser: BrowserSession; thread: Thread; rows: RowWatch; page: RefObject<PublicInstance | null>; onTakeControl: () => void; onDrivingChange: (driving: boolean) => void }) {
  const m = useM(), renderer = useGpuixRequired()
  const key = useMemo(() => ({ noteId: browser.noteId, session: browser.session, generation: browser.generation! }), [browser.noteId, browser.session, browser.generation])
  const id = browserKey(key)
  const layout = useSyncExternalStore(subscribeBrowserLayout, () => browserLayout(key))
  const visible = useSyncExternalStore(rows.subscribe, rows.get)
  const activeWork = useSyncExternalStore(subscribeBrowserRuntime, () => browserWorkActive(browser))
  const [bounds, setBounds] = useState({ x: 0, y: 0, width: 700, height: 500 })
  const floating = useRef<PublicInstance>(null)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ dx: number; dy: number; x: number; y: number } | undefined>(undefined)
  const width = Math.max(120, Math.min(340, bounds.width - 34))
  const height = width * 800 / 1280 + 76
  // The page bounds include the scrollbar gutter; the frame stays 16px inside the content.
  const margin = 14 + 16
  const clamp = (x: number, y: number) => ({ x: Math.max(16, Math.min(Math.max(16, bounds.width - width - margin), x)), y: Math.max(16, Math.min(Math.max(16, bounds.height - height - 16), y)) })
  useEffect(() => {
    let candidate: string | undefined, since = 0
    const update = () => {
      const actual = page.current && renderer.getElementBounds?.(page.current.id)
      if (!actual) return
      setBounds(old => old.x === actual.x && old.y === actual.y && old.width === actual.width && old.height === actual.height ? old : actual)
      const current = browserLayout(key)
      if (current.minimized || current.placement === 'expanded' || current.pinned) return
      const inlineNode = browserInlineNodes.get(id), slot = inlineNode === undefined ? undefined : renderer.getElementBounds?.(inlineNode)
      const index = thread.blocks.findIndex(block => block.kind === 'browser' && block.browser.generation === key.generation) + 1
      const range = rows.get()
      const above = slot ? slot.y + slot.height < actual.y - 16 : range && index > 0 && index < range[0]
      const overlap = slot ? Math.max(0, Math.min(slot.y + slot.height, actual.y + actual.height) - Math.max(slot.y, actual.y)) : 0
      const halfVisible = slot ? overlap >= slot.height / 2 && slot.y + slot.height > actual.y + 16 : false
      const desired = current.placement === 'inline' && above && browserWorkActive(browser) ? 'floating' : current.placement === 'floating' && halfVisible ? 'inline' : current.placement === 'floating' && !browserWorkActive(browser) ? 'minimized' : undefined
      if (!desired) { candidate = undefined; return }
      if (candidate !== desired) { candidate = desired; since = Date.now(); return }
      if (Date.now() - since >= 120) { changeBrowserLayout(key, { placement: desired, ...(desired === 'minimized' ? { minimized: true } : {}) }); candidate = undefined }
    }
    update(); const timer = setInterval(update, 60)
    return () => clearInterval(timer)
  }, [id, thread.blocks, visible, activeWork, renderer])
  useEffect(() => {
    const current = browserLayout(key)
    if (current.x === undefined || current.y === undefined || dragging) return
    const next = clamp(current.x, current.y)
    if (next.x !== current.x || next.y !== current.y) changeBrowserLayout(key, next)
  }, [bounds.width, bounds.height, dragging])
  useEffect(() => { if (layout.placement === 'minimized') setBrowserDemand(key, { placement: 'minimized', visible: false, focused: false }) }, [id, layout.placement])
  useEffect(() => () => { releaseBrowserInput(key); void releaseBrowserControl(key.noteId); onDrivingChange(false) }, [id])
  const startDrag = (event: { x?: number; y?: number; button?: number }) => {
    if (event.x === undefined || event.y === undefined || event.button && event.button !== 0) return
    const x = layout.x ?? Math.max(16, bounds.width - width - margin), y = layout.y ?? 16
    drag.current = { dx: event.x - bounds.x - x, dy: event.y - bounds.y - y, x, y }
    changeBrowserLayout(key, { pinned: true }); setDragging(true)
  }
  const move = (event: { x?: number; y?: number }) => {
    if (!drag.current || event.x === undefined || event.y === undefined || !floating.current) return
    const position = clamp(event.x - bounds.x - drag.current.dx, event.y - bounds.y - drag.current.dy)
    drag.current.x = position.x; drag.current.y = position.y
    // Direct shared-parent mutation: descendants move as one, without layout springs.
    renderer.applyBatch(JSON.stringify([['setStyle', floating.current.id, { left: position.x, top: position.y }]]))
  }
  const finishDrag = () => { if (drag.current) changeBrowserLayout(key, { x: drag.current.x, y: drag.current.y, pinned: true }); drag.current = undefined; setDragging(false) }
  if (layout.placement === 'expanded') return <DismissableLayer onEscapeKeyDown={() => { releaseBrowserInput(key); void releaseBrowserControl(key.noteId); onDrivingChange(false); collapseBrowser(key) }}>
    <div testId="browser-viewer" onMouseUp={() => releaseBrowserInput(key)} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: m.pane, display: 'flex', justifyContent: 'center', alignItems: 'center' }}><AgentScreen session={browser} placement="expanded" onExpand={() => collapseBrowser(key)} onTakeControl={onTakeControl} onDrivingChange={onDrivingChange} /></div>
  </DismissableLayer>
  if (layout.placement !== 'floating') return null
  return <>
    <div ref={floating} testId="browser-floating" style={{ position: 'absolute', top: layout.y ?? 16, left: layout.x ?? Math.max(16, bounds.width - width - margin), borderRadius: radiusXl }}>
      <AgentScreen session={browser} placement="floating" width={width} onExpand={() => expandBrowser(key)} onMinimize={() => minimizeBrowser(key)} onReturnInline={() => dockBrowser(key)} onDrag={startDrag} />
    </div>
    {dragging ? <div testId="browser-drag-cover" onMouseMove={move} onMouseUp={finishDrag} onBlur={finishDrag} style={{ position: 'absolute', left: -bounds.x, top: -bounds.y, width: 10000, height: 10000, cursor: 'move', userSelect: 'none' }} /> : null}
  </>
}
