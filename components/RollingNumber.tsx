// A count that rolls to its new value, like an odometer: up when it grows, down when it shrinks
// (arc's animated-counter, with top and opacity in a clipped line instead of transforms and blur).
// The current value also sits in the flow, invisible, so the line keeps its width.

import { useState } from 'react'
import { motion } from './spring'
import { enter, useReducedMotion } from './motion'

type TextStyle = { fontSize: number; lineHeight: number; color?: string; fontWeight?: number; fontFamily?: string }

export function RollingNumber({ value, style, testId }: { value: number; style: TextStyle; testId?: string }) {
  const reduced = useReducedMotion()
  const [shown, setShown] = useState(value)
  const [from, setFrom] = useState<number>()
  const [direction, setDirection] = useState(1)
  const [change, setChange] = useState(0)
  if (value !== shown) {
    setFrom(shown)
    setDirection(value > shown ? 1 : -1)
    setChange(change + 1)
    setShown(value)
  }
  const line = style.lineHeight
  return (
    <div testId={testId} style={{ position: 'relative', height: line, overflow: 'hidden', flexShrink: 0 }}>
      <text style={{ ...style, opacity: 0 }}>{String(value)}</text>
      {from !== undefined && !reduced ? (
        <motion.div key={`from-${change}`} initial={{ top: 0, opacity: 1 }} animate={{ top: -direction * line, opacity: 0 }} transition={enter('fast')} style={{ position: 'absolute', left: 0 }}>
          <text style={style}>{String(from)}</text>
        </motion.div>
      ) : null}
      <motion.div key={`to-${change}`} initial={change === 0 || reduced ? false : { top: direction * line, opacity: 0 }} animate={{ top: 0, opacity: 1 }} transition={enter('fast')} style={{ position: 'absolute', left: 0 }}>
        <text style={style}>{String(value)}</text>
      </motion.div>
    </div>
  )
}
