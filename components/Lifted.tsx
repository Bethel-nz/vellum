// A shadowed surface that enters with a fade. GPUI paints a box shadow at full strength whatever
// the node's opacity (a square halo on the dark materials), so a fading panel shows its shadow
// first: a dark pane, then the panel inside it (scripts/check-motion.ts, frame 0). So the shadow
// only goes on once the surface is opaque: it enters flat, then lifts. Exits are instant anyway
// (Menu, Toast), so this is about entering only.

import { forwardRef, useEffect, useState } from 'react'
import { motion, type MotionDivProps, type PublicInstance, type StyleDesc } from '@gpuix/react'

/** Past the longest enter (`considered`, 0.48s): lift even if no motion-complete event came. */
const FALLBACK_MS = 600

export const Lifted = forwardRef<PublicInstance, MotionDivProps & { shadow: StyleDesc['boxShadow'] }>(function Lifted({ shadow, initial, style, onMotionComplete, ...rest }, ref) {
  // No enter (reduced motion, or initial={false}): lifted from the start.
  const [lifted, setLifted] = useState(initial === false)
  useEffect(() => {
    if (lifted) return
    const timer = setTimeout(() => setLifted(true), FALLBACK_MS)
    return () => clearTimeout(timer)
  }, [lifted])
  return (
    <motion.div
      ref={ref}
      initial={initial}
      onMotionComplete={(e) => {
        setLifted(true)
        onMotionComplete?.(e)
      }}
      style={{ ...style, boxShadow: lifted ? shadow : undefined }}
      {...rest}
    />
  )
})
