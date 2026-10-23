// Spike: does a fenced block without a language still draw the header band, and does it still
// get syntax colours? Renders the same snippet with ```ts and with a bare fence.
import { render } from '@gpuix/react'
import { groknight, nativeTheme } from '../ui/theme'

const code = 'concentric(14, 4) // 10\nconst x = "string"'
render(
  <div style={{ width: '100%', height: '100%', backgroundColor: groknight.pane, padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
    <markdown testId="md" source={'With ts:\n\n```ts\n' + code + '\n```\n\nBare:\n\n```\n' + code + '\n```\n'} theme={nativeTheme(groknight)} style={{ color: groknight.textUi, width: 480 }} />
  </div>,
  { title: 'code-header-spike', width: 540, height: 420, focus: false },
)
