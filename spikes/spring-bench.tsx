// Bench: N boxes spring between two targets every 450ms for 4s, then print the process's CPU
// and the renderer's frame times as JSON. PROP=opacity|top|height, N=40. applyBatch is timed
// too: it lays out and paints synchronously, so it is most of each frame's cost.
//   GPUIX_BACKGROUND=1 bun spikes/spring-bench.tsx
import { useEffect, useState } from 'react'
import { render, useGpuixRequired } from '@gpuix/react'
import { motion } from '../components/spring'
import { spring } from '../components/motion'

const N = Number(process.env.N ?? 40)
const PROP = (process.env.PROP ?? 'top') as 'opacity' | 'top' | 'height'
const target = (on: boolean) => (PROP === 'opacity' ? { opacity: on ? 1 : 0.2 } : PROP === 'top' ? { top: on ? 120 : 0 } : { height: on ? 140 : 20 })

function Bench() {
  const renderer = useGpuixRequired()
  const [on, setOn] = useState(false)
  useEffect(() => {
    const r = renderer as { applyBatch: (s: string) => unknown }
    const apply = r.applyBatch.bind(r)
    const stat = { calls: 0, ms: 0, worst: 0 }
    r.applyBatch = (s) => { const t = performance.now(); const out = apply(s); const d = performance.now() - t; stat.calls++; stat.ms += d; stat.worst = Math.max(stat.worst, d); return out }
    ;(globalThis as { benchStat?: typeof stat }).benchStat = stat
    const flip = setInterval(() => setOn((v) => !v), 450)
    let cpu: NodeJS.CpuUsage
    const begin = setTimeout(() => { renderer.resetDebugFrameOverlayStats?.(); cpu = process.cpuUsage(); stat.calls = 0; stat.ms = 0; stat.worst = 0 }, 1000)
    const end = setTimeout(() => {
      const used = process.cpuUsage(cpu)
      const frames = renderer.getDebugFrameOverlayStats?.()
      console.log(JSON.stringify({ prop: PROP, n: N, cpuPct: Math.round(((used.user + used.system) / 1000 / 4000) * 100), frames, batch: { calls: stat.calls, avgMs: +(stat.ms / stat.calls).toFixed(2), worstMs: +stat.worst.toFixed(1) } }))
      process.exit(0)
    }, 5000)
    return () => { clearInterval(flip); clearTimeout(begin); clearTimeout(end) }
  }, [renderer])
  return (
    <div style={{ width: '100%', height: '100%', backgroundColor: '#141414', display: 'flex', flexDirection: 'row', gap: 4, padding: 8 }}>
      {Array.from({ length: N }, (_, i) => (
        <div key={i} style={{ position: 'relative', width: 14, height: 300 }}>
          <motion.div initial={false} animate={target(on)} transition={spring.smooth} style={{ position: 'relative', width: 14, height: 20, borderRadius: 4, backgroundColor: '#8b7cf6' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{Array.from({ length: 6 }, (_, j) => <text key={j} style={{ fontSize: 8, lineHeight: 9, color: '#fff' }}>{String(j)}</text>)}</div>
          </motion.div>
        </div>
      ))}
    </div>
  )
}

render(<Bench />, { title: 'spring-bench', width: 900, height: 380, windowBackground: 'opaque' })
