// Spike 1 app: a textarea that reports which keys reach onKeyDown and whether
// preventDefault() on Ctrl+Enter stops the newline.
import { useState } from 'react'
import { render } from '@gpuix/react'

function App() {
  const [value, setValue] = useState('')
  const [log, setLog] = useState<string[]>([])
  const [sent, setSent] = useState<string[]>([])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 20, height: '100%', backgroundColor: '#171717' }}>
      <textarea
        testId="composer"
        value={value}
        minRows={2}
        maxRows={6}
        autoFocus
        style={{ color: '#fafafa', fontSize: 14, lineHeight: 20 }}
        onChange={(e) => setValue(e.value ?? '')}
        onKeyDown={(e) => {
          setLog((l) => [...l, `${e.key}${e.modifiers?.ctrl ? '+ctrl' : ''}${e.modifiers?.cmd ? '+cmd' : ''}`])
          if (e.key === 'enter' && e.modifiers?.ctrl) {
            e.preventDefault()
            setSent((s) => [...s, value])
            setValue('')
          }
        }}
      />
      <text testId="readout" style={{ color: '#9f9fa9' }}>
        {`value=${JSON.stringify(value)} sent=${JSON.stringify(sent)} keys=${log.slice(-12).join(',')}`}
      </text>
    </div>
  )
}

render(<App />, { title: 'spike', width: 600, height: 300, focus: process.env.GPUIX_BACKGROUND !== '1' })
