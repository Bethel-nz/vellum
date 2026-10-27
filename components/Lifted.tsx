// A shadowed surface that enters with a fade. GPUI paints a box shadow at full strength whatever
// the node's opacity (a square halo on the dark materials), so a fading panel used to show its
// shadow first: a dark pane, then the panel inside it (scripts/check-motion.ts, frame 0). The
// spring motion (components/spring.tsx) fades the shadow with the surface's opacity, so the
// surface simply wears its shadow; under reduced motion nothing fades and it's there at once.

import { forwardRef } from 'react'
import type { MotionDivProps, PublicInstance, StyleDesc } from '@gpuix/react'
import { motion } from './spring'

export const Lifted = forwardRef<PublicInstance, MotionDivProps & { shadow: StyleDesc['boxShadow'] }>(function Lifted({ shadow, style, ...rest }, ref) {
  return <motion.div ref={ref} style={{ ...style, boxShadow: shadow }} {...rest} />
})
