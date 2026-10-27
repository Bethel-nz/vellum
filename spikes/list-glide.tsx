// Spike: can a <virtual-list> scroll smoothly? GPUIX has scrollToItem (a jump) and
// getListScrollTop (the anchor gpui scrolls by: [item, offsetInItem, viewport]). This probes
// what an anchor past an item's height, past the last item, or stepped every frame does, and
// whether followTail picks up again after a jump to the end. Results go to the file in
// SPIKE_OUT, one JSON line per step (spikes/list-glide-run.ts drives it).
import { useRef, useState } from 'react'
import { render, useGpuixRequired, type PublicInstance } from '@gpuix/react'
import { appender } from '../scripts/scratch'

const out = process.env.SPIKE_OUT ?? '/dev/null'
const record = appender(out)
const log = (step: string, value: unknown) => record(JSON.stringify({ step, value }) + '\n')
const height = (i: number) => 40 + ((i * 37) % 160)

function Spike() {
  const renderer = useGpuixRequired()
  const list = useRef<PublicInstance>(null)
  const [rows, setRows] = useState(60)
  const anchor = () => (list.current ? renderer.getListScrollTop?.(list.current.id) : null)
  const at = (step: string) => setTimeout(() => log(step, anchor()), 120)
  const jump = (index: number, offset: number, step: string) => {
    renderer.scrollToItem?.(list.current!.id, index, offset)
    at(step)
  }
  const glide = () => {
    // Step the anchor by 24px a frame from wherever it is, 20 times.
    let n = 0
    const tick = () => {
      const a = anchor()
      if (!a) return
      renderer.scrollToItem?.(list.current!.id, a[0], a[1] + 24)
      log(`glide-${n}`, a)
      if (++n < 20) setTimeout(tick, 16)
    }
    tick()
  }
  const buttons: [string, () => void][] = [
    ['anchor', () => at('anchor')],
    ['top', () => jump(0, 0, 'top')],
    ['past-height', () => jump(5, 600, 'past-height')],
    ['above', () => jump(30, -300, 'above')],
    ['big-index', () => jump(9999, 0, 'big-index')],
    ['big-index-up', () => jump(9999, -400, 'big-index-up')],
    ['glide', glide],
    ['raf', () => log('raf', 'requestAnimationFrame' in globalThis)],
    ['grow', () => { setRows((r) => r + 3); at('grow') }],
    // Is the at-end sentinel readable in the same tick, before any paint? Then put it back.
    ['count', () => {
      const before = anchor()
      renderer.scrollToItem?.(list.current!.id, 1e9, 0)
      const end = anchor()
      if (before) renderer.scrollToItem?.(list.current!.id, before[0], before[1])
      log('count', { before, end, restored: anchor() })
      at('count-after')
    }],
    // Past the end by far: does gpui clamp?
    ['overshoot', () => { const a = anchor(); if (a) renderer.scrollToItem?.(list.current!.id, a[0], a[1] + 50000); at('overshoot') }],
  ]
  return (
    <div testId="root" style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'row', backgroundColor: '#111' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 8 }}>
        {buttons.map(([id, f]) => (
          <div key={id} testId={id} onClick={f} style={{ width: 80, height: 22, backgroundColor: '#333' }} />
        ))}
      </div>
      <virtual-list ref={list} followTail alignment="top" estimatedItemHeight={90} overdraw={300} onVisibleRange={(e) => log('range', [e.startIndex, e.endIndex])} style={{ flexGrow: 1, minHeight: 0, height: '100%' }}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} style={{ height: height(i), borderBottomWidth: 1, borderColor: '#444', display: 'flex', alignItems: 'center', paddingLeft: 12 }}>
            <text style={{ color: '#ccc', fontSize: 13 }}>{`row ${i} · ${height(i)}px`}</text>
          </div>
        ))}
      </virtual-list>
    </div>
  )
}

render(<Spike />, { width: 700, height: 500 })
