// Sample: the inline browser card (defined 480x300 box, no caption), the error card
// with its alert block, and the double-click-to-fullscreen overlay.
//   bun spikes/browser-card-sample.tsx              (look by eye)
//   bun scripts/check-browser-card.ts               (screenshot + assertions)
import { useState } from 'react'
import path from 'node:path'
import { render } from '@gpuix/react'
import { MaterialContext } from '../components/theme'
import { dark } from '../ui/theme'
import { AgentScreen } from '../ui/AgentScreen'

const shot = path.resolve(import.meta.dir, '../screenshots/panels-floating-thread.png')

const mock = (noteId: string, extra: Record<string, unknown> = {}) => ({
  noteId, session: noteId, streamPort: 0, url: 'https://www.google.com/', screenshot: shot, phase: 'idle' as const, ...extra,
})

function Sample() {
  const [zoom, setZoom] = useState(false)
  return (
    <MaterialContext.Provider value={dark}>
      <div style={{ position: 'relative', width: '100%', height: '100%', backgroundColor: dark.pane, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 48, gap: 24, overflow: 'scroll' }}>
        <AgentScreen session={mock('sample')} placement="inline" width={480} onExpand={() => setZoom(true)} />
        <AgentScreen session={{ noteId: 'sample-err', session: 'sample-err', streamPort: 0, phase: 'error', error: 'Browser could not connect' }} placement="inline" width={480} onExpand={() => {}} />
        <AgentScreen session={mock('sample-big')} placement="expanded" onExpand={() => {}} />
        <div style={{ height: 48, flexShrink: 0 }} />
        {zoom ? (
          <div testId="browser-fullscreen" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: dark.scrim, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <AgentScreen session={mock('sample-zoom')} placement="expanded" onExpand={() => setZoom(false)} />
          </div>
        ) : null}
      </div>
    </MaterialContext.Provider>
  )
}

render(<Sample />, { title: 'browser-card-sample', width: 900, height: 860 })
