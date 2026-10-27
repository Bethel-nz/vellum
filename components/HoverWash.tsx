// One shadowless wash travels between targets. The hit areas and their content stay still.
import { useRef } from 'react'
import { type MotionTransition } from '@gpuix/react'
import { motion } from './spring'
import { spring, tween, useReducedMotion } from './motion'
import { useM } from './theme'

export type WashBox = { left: number; top: number; width: number; height: number }

export function HoverWash({ box, pressed, radius = 4, transition = spring.snappy }: { box: WashBox | null; pressed?: boolean; radius?: number; transition?: MotionTransition }) {
  const m = useM()
  useReducedMotion()
  const last = useRef<WashBox>({ left: 0, top: 0, width: 0, height: 0 })
  if (box) last.current = box
  return (
    <motion.div
      initial={false}
      animate={{ ...last.current, opacity: box ? 1 : 0 }}
      transition={tween(transition)}
      style={{ position: 'absolute', pointerEvents: 'none', borderRadius: radius, backgroundColor: pressed ? m.pressed : m.hover }}
    />
  )
}
