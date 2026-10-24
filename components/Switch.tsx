// A toggle, after arc's switch: the thumb glides on the snappy curve, the track colour follows.

import { motion } from '@gpuix/react'
import { Button as Base } from '@gpuix/react/button'
import { spring, tween, useReducedMotion } from './motion'
import { useM } from './theme'

const W = 30
const H = 18
const THUMB = 14

export function Switch({ checked, onChange, testId, label }: { checked: boolean; onChange: (next: boolean) => void; testId?: string; label?: string }) {
  const m = useM()
  useReducedMotion()
  return (
    <Base
      testId={testId}
      aria-label={label}
      aria-selected={checked}
      onClick={() => onChange(!checked)}
      style={{
        width: W,
        height: H,
        borderRadius: H / 2,
        backgroundColor: checked ? m.blue : m.selected,
        position: 'relative',
        flexShrink: 0,
        cursor: 'pointer',
        focusVisible: { outlineWidth: 2, outlineColor: m.focusRing, outlineOffset: 1 },
      }}
    >
      <motion.div
        initial={false}
        animate={{ left: checked ? W - THUMB - 2 : 2, opacity: 1 }}
        transition={tween(spring.snappy)}
        style={{ position: 'absolute', top: (H - THUMB) / 2, width: THUMB, height: THUMB, borderRadius: THUMB / 2, backgroundColor: '#ffffff' }}
      />
      {/* A motion.div keeps presses to itself: the click is taken by this layer above the thumb. */}
      <div onClick={() => onChange(!checked)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
    </Base>
  )
}
