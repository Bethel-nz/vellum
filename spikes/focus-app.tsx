// Spike: does clicking a tabIndex div focus it, and do onFocus / focusElement fire?
import { useRef, useState } from 'react'
import { render, useGpuixRequired, type PublicInstance } from '@gpuix/react'

function App() {
  const r = useGpuixRequired()
  const ref = useRef<PublicInstance>(null)
  const [log, setLog] = useState<string[]>([])
  const add = (s: string) => setLog((l) => [...l, s])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 20, height: '100%', backgroundColor: '#171717' }}>
      <div testId="outer" onClick={() => { add('outer-click'); ref.current && r.focusElement?.(ref.current.id); setTimeout(() => add(`focused=${r.getFocusedElementId?.()} inner=${ref.current?.id}`), 80) }} style={{ padding: 10, backgroundColor: '#222' }}>
        <text style={{ color: '#fff' }}>header text</text>
        <div ref={ref} testId="inner" tabIndex={0} onFocus={() => add('focus')} onBlur={() => add('blur')} onKeyDown={(e) => add('key:' + e.key)} onClick={() => { add('inner-click'); setTimeout(() => add(`focused=${r.getFocusedElementId?.()}`), 80) }} style={{ height: 60, backgroundColor: '#333' }}>
          <text style={{ color: '#aaa' }}>inner</text>
        </div>
      </div>
      <text testId="readout" style={{ color: '#9f9fa9' }}>{log.join(',')}</text>
    </div>
  )
}
render(<App />, { title: 'focus', width: 500, height: 300, focus: process.env.GPUIX_BACKGROUND !== '1' })
