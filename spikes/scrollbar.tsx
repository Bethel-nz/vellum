// Spike: when does GPUIX paint a scrollbar thumb? Padding on the scroll box itself reads as
// overflow (a full-length thumb over 3 short rows), and the thumb sits on the content's edge.
// The fix under test: no padding on the box, padding on an inner column, with room on the right
// for the thumb. Rows don't shrink, so the last box really overflows.
import { render } from '@gpuix/react'
import { groknight } from '../ui/theme'

const m = groknight
const rows = (n: number) => Array.from({ length: n }, (_, i) => <div key={i} style={{ height: 30, flexShrink: 0, backgroundColor: m.hover, marginBottom: 2 }} />)
const box = (id: string, n: number, inner: boolean) => (
  <div testId={id} style={{ display: 'flex', flexDirection: 'column', width: 120, height: 300, overflowY: 'scroll', scrollbarColor: '#ff0000', scrollbarWidth: 6, borderWidth: 1, borderColor: m.border, ...(inner ? {} : { padding: 6 }) }}>
    {inner ? <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, paddingTop: 6, paddingBottom: 6, paddingLeft: 6, paddingRight: 14 }}>{rows(n)}</div> : rows(n)}
  </div>
)
render(
  <div testId="root" style={{ width: '100%', height: '100%', backgroundColor: m.popup, padding: 20, display: 'flex', flexDirection: 'row', gap: 16 }}>
    {box('padded-short', 3, false)}
    {box('inner-short', 3, true)}
    {box('padded-long', 20, false)}
    {box('inner-long', 20, true)}
  </div>,
  { title: 'scrollbar-spike', width: 600, height: 360, focus: false },
)
