import { useEffect, useState } from 'react'
import { motion } from './spring'
import { useAgent } from './AgentContext'
import { AgentMark } from './AgentMark'
import { duration, enter, useReducedMotion } from './motion'
import { useM } from './theme'

/** A typing cue in a fixed-height row. The response itself still arrives in immutable chunks. */
export function AgentWorking({ label }: { label: string }) {
  const m = useM()
  const agent = useAgent()
  const reduced = useReducedMotion()
  const [shown, setShown] = useState(0)
  const [dim, setDim] = useState(false)
  useEffect(() => {
    setShown(reduced ? label.length : 0)
    if (reduced) return
    let count = 0
    const timer = setInterval(() => { count = Math.min(label.length, count + 3); setShown(count); if (count === label.length) clearInterval(timer) }, duration.instant * 1000)
    return () => clearInterval(timer)
  }, [label, reduced])
  useEffect(() => {
    if (reduced) { setDim(false); return }
    const timer = setInterval(() => setDim((value) => !value), duration.considered * 1000)
    return () => clearInterval(timer)
  }, [reduced])
  return <div style={{ position: 'relative', display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, height: 24 }}>
    <AgentMark />
    <text style={{ fontSize: 11, lineHeight: 16, color: m.accent, backgroundColor: m.skillBg, borderRadius: 4, paddingLeft: 5, paddingRight: 5 }}>{agent.title}</text>
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 3, minWidth: 145 }}>
      <text testId="agent-working-label" style={{ fontSize: 12, lineHeight: 17, color: m.textMuted }}>{label.slice(0, reduced ? label.length : shown)}</text>
      <motion.div initial={false} animate={{ opacity: dim ? 0.3 : 1 }} transition={enter('fast')} style={{ width: 1.5, height: 13, backgroundColor: m.accent, pointerEvents: 'none' }} />
    </div>
  </div>
}
