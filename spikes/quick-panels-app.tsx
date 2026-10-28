// Spike: inline + floating quick panels on a plain document.
//   bun spikes/quick-panels-app.tsx            (look by eye)
//   bun scripts/check-quick-panels.ts          (state + screenshots)
import { useState } from 'react'
import { render, useWindowSize } from '@gpuix/react'
import { MaterialContext } from '../components/theme'
import { dark, nativeTheme } from '../ui/theme'
import { InlinePanel, FloatingPanel } from '../ui/QuickPanels'
import { initialPanel, reducePanel, type PanelState } from '../core/panels'

function Demo() {
  const view = useWindowSize()
  const [panel, setPanel] = useState<PanelState>(initialPanel)
  const [anchor, setAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const [draft, setDraft] = useState('')
  const open = (e: PanelState['mode']) =>
    setPanel((s) => reducePanel({ ...s, draft }, { type: e === 'inline' ? 'OPEN_INLINE' : 'OPEN_FLOATING', anchorId: 'demo' }))
  return (
    <MaterialContext.Provider value={dark}>
      <div style={{ width: '100%', height: '100%', backgroundColor: dark.pane, display: 'flex', flexDirection: 'column', padding: 32, gap: 12 }}>
        <text style={{ fontSize: 16, color: dark.text }}>Quick panels demo</text>
        <div style={{ display: 'flex', flexDirection: 'row', gap: 8 }}>
          <div testId="open-inline" onClick={(e) => { setAnchor({ x: e.x ?? 120, y: e.y ?? 160, width: 40, height: 18 }); open('inline') }} style={{ padding: 8, backgroundColor: dark.popup, borderRadius: 8, borderWidth: 1, borderColor: dark.border }}>
            <text style={{ fontSize: 13, color: dark.text }}>Open inline</text>
          </div>
          <div testId="open-floating" onClick={() => open('floating')} style={{ padding: 8, backgroundColor: dark.popup, borderRadius: 8, borderWidth: 1, borderColor: dark.border }}>
            <text style={{ fontSize: 13, color: dark.text }}>Open floating</text>
          </div>
          <div testId="close-panels" onClick={() => setPanel((s) => reducePanel(s, { type: 'CLOSE' }))} style={{ padding: 8, backgroundColor: dark.popup, borderRadius: 8, borderWidth: 1, borderColor: dark.border }}>
            <text style={{ fontSize: 13, color: dark.text }}>Close</text>
          </div>
        </div>
        <textarea testId="draft" value={draft} minRows={1} onChange={(e) => setDraft(e.value ?? '')} style={{ width: 360, color: dark.text }} />
        <InlinePanel
          state={panel}
          anchor={anchor ?? { x: 120, y: 160, width: 40, height: 18 }}
          onClose={() => setPanel((s) => reducePanel(s, { type: 'CLOSE' }))}
          onDockHint="⌥Space floats · Esc closes"
          header={<text style={{ fontSize: 12, color: dark.textMuted, paddingLeft: 12, paddingTop: 8 }}>inline · closes on outside</text>}
        >
          <textarea testId="inline-field" value={draft} minRows={3} onChange={(e) => setDraft(e.value ?? '')} style={{ width: '100%', color: dark.text }} />
        </InlinePanel>
        <FloatingPanel
          state={panel}
          view={view}
          onClose={() => setPanel((s) => reducePanel(s, { type: 'CLOSE' }))}
          onCollapse={() => setPanel((s) => reducePanel(s, { type: 'COLLAPSE' }))}
          onExpand={() => setPanel((s) => reducePanel(s, { type: 'EXPAND' }))}
        >
          <textarea testId="floating-field" value={draft} minRows={3} onChange={(e) => setDraft(e.value ?? '')} style={{ width: '100%', color: dark.text }} />
        </FloatingPanel>
      </div>
    </MaterialContext.Provider>
  )
}

render(<Demo />, { title: 'quick-panels-spike', width: 900, height: 640 })
