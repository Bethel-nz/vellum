// Spike: does an <input> report onFocus / onBlur when it is clicked, and when focus leaves?
import { appendFileSync } from 'node:fs'
import { render } from '@gpuix/react'
const out = process.env.SPIKE_OUT ?? '/dev/null'
render(
  <div style={{ width: '100%', height: '100%', backgroundColor: '#141414', padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
    <input testId="a" value="" onChange={() => {}} onFocus={() => appendFileSync(out, 'focus a\n')} onBlur={() => appendFileSync(out, 'blur a\n')} style={{ height: 32, backgroundColor: '#222', color: '#eee' }} />
    <input testId="b" value="" onChange={() => {}} onFocus={() => appendFileSync(out, 'focus b\n')} style={{ height: 32, backgroundColor: '#222', color: '#eee' }} />
  </div>,
  { title: 'input-focus', width: 400, height: 200 },
)
