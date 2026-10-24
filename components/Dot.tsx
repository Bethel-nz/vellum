// A status / identity dot. `pulse` breathes for a running agent: 1.8s loop on the material
// curve. GPUIX has no repeating motion, so the dot flips its target every half cycle.

import { useEffect, useState } from 'react'
import { motion } from '@gpuix/react'
import { ease, tween, useReducedMotion } from './motion'

const HALF = 0.9

export function Dot({ color, size = 7, pulse }: { color: string; size?: number; pulse?: boolean }) {
  const [dim, setDim] = useState(false)
  const reduced = useReducedMotion()
  const animate = pulse && !reduced
  useEffect(() => {
    if (!animate) return setDim(false)
    const timer = setInterval(() => setDim((d) => !d), HALF * 1000)
    return () => clearInterval(timer)
  }, [animate])
  return (
    <motion.div
      initial={false}
      animate={{ opacity: animate && dim ? 0.35 : 1 }}
      transition={tween({ duration: HALF, ease: ease.material })}
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, flexShrink: 0 }}
    />
  )
}
