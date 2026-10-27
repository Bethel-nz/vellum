import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { DismissableLayer, useWindowSize, type PublicInstance } from '@gpuix/react'
import type { BrowserSession } from '../core/capture'
import type { BrowserKey } from '../core/browser-types'
import { validateBrowser } from '../core/browser-runtime'
import { browserKey } from '../core/browser-view'
import { browserInlineNodes, browserLayout, expandBrowser, subscribeBrowserLayout } from '../core/browser-layout'
import { AgentScreen } from './AgentScreen'
import { useM } from './kit'

export function BrowserBlock({ browser, onOpen }: { browser: BrowserSession; onOpen: () => void }) {
  const window = useWindowSize(), node = useRef<PublicInstance>(null)
  const key = useMemo(() => browser.generation ? { noteId: browser.noteId, session: browser.session, generation: browser.generation } : undefined, [browser.noteId, browser.session, browser.generation])
  const id = key ? browserKey(key) : browser.session
  const layout = useSyncExternalStore(subscribeBrowserLayout, () => key ? browserLayout(key) : undefined)
  useEffect(() => { if (key && node.current) browserInlineNodes.set(id, node.current.id); return () => { browserInlineNodes.delete(id) } }, [id, key])
  const live = key && validateBrowser(key)
  const elsewhere = Boolean(live && layout && layout.placement !== 'inline')
  // One defined box, computed per render: live captures letterbox into the same
  // 480×300 frame the empty state uses, so the card never changes shape per capture.
  const width = Math.max(120, Math.min(480, window.width - 112))
  return <div ref={node} testId={`browser-slot-${browser.generation ?? 'legacy'}`} style={{ width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
    <AgentScreen session={browser} placement="inline" width={width} quiet={elsewhere} onExpand={() => key && live ? expandBrowser(key) : onOpen()} />
  </div>
}
export function BrowserViewer({ browser, onClose, onTakeControl, onDrivingChange }: { browser: BrowserSession; onClose: () => void; onTakeControl: () => void; onDrivingChange: (driving: boolean) => void }) {
  const m = useM()
  return <DismissableLayer onEscapeKeyDown={onClose}>
    <div testId="browser-viewer" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: m.pane, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <AgentScreen session={browser} placement="expanded" onExpand={onClose} onTakeControl={onTakeControl} onDrivingChange={onDrivingChange} />
    </div>
  </DismissableLayer>
}
