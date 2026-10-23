// Spike: can a chip sit inline in a run of text? Tries nested <text>, and a wrapping flex row
// of words + chip boxes. Run with the automation launcher (spikes/inline-chips-run.ts).
import { render } from '@gpuix/react'

const words = 'Look at the helper here and tell me whether the clamp is right for every caller that passes an inset'.split(' ')

render(
  <div style={{ width: '100%', height: '100%', backgroundColor: '#141414', padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
    <text testId="nested" style={{ fontSize: 15, lineHeight: 22, color: '#e5e5e5', width: 420 }}>
      Nested: look at <text style={{ color: '#BBB0FF', backgroundColor: '#242424' }}>#ui/theme.ts:42</text> and tell me whether the clamp is right for every caller.
    </text>
    <div testId="wrap" style={{ width: 420, display: 'flex', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 4, rowGap: 2 }}>
      {words.slice(0, 5).map((w, i) => <text key={i} style={{ fontSize: 15, lineHeight: 22, color: '#e5e5e5' }}>{w}</text>)}
      <div style={{ height: 20, paddingLeft: 5, paddingRight: 6, borderRadius: 5, backgroundColor: '#242424', borderWidth: 1, borderColor: '#2e2e32', display: 'flex', alignItems: 'center' }}>
        <text style={{ fontSize: 11.5, lineHeight: 15, color: '#d4d4d4', fontFamily: 'Menlo' }}>#ui/theme.ts:42</text>
      </div>
      {words.slice(5).map((w, i) => <text key={i} style={{ fontSize: 15, lineHeight: 22, color: '#e5e5e5' }}>{w}</text>)}
    </div>
  </div>,
  { title: 'inline-spike', width: 520, height: 300, focus: false },
)
