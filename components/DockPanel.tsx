import type { ReactNode } from 'react'
import { AnimatePresence, motion } from './spring'
import { spring, tween, useReducedMotion } from './motion'

/** A side pane opens its space in the row; an overlay closes atomically with its shadow. Overlay leaves the bottom chrome (status bar + approval/toast line) visible. */
export function DockPanel({ open, width, overlay = false, gap = 8, testId, selectable = true, children }: {
  open: boolean
  width: number
  overlay?: boolean
  gap?: number
  testId?: string
  /** False while another pane owns text selection (app.tsx's active pane). */
  selectable?: boolean
  children: ReactNode
}) {
  const reduced = useReducedMotion()
  return <AnimatePresence>
    {open ? <motion.div
      key="pane"
      testId={testId}
      // Arc's drawer: the pane comes in from its own edge on a smooth spring that keeps its
      // speed if you toggle it mid-flight. Docked, the content is pinned right, so opening
      // the space slides it in.
      initial={reduced ? false : overlay ? { opacity: 0, right: -Math.min(48, width / 6) } : { width: 0, opacity: 0 }}
      animate={overlay ? { opacity: 1, right: 0 } : { width: width + gap, opacity: 1 }}
      exit={overlay ? undefined : { width: 0, opacity: 0 }}
      transition={tween(reduced ? { duration: 0 } : spring.panel)}
      style={{ ...(overlay ? { position: 'absolute', top: 0, right: 0, bottom: 42, width } : { position: 'relative', flexShrink: 0 }), minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
    >
      <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width, display: 'flex', flexDirection: 'column', minHeight: 0, ...(selectable ? {} : { userSelect: 'none' }) }}>
        {children}
      </div>
    </motion.div> : null}
  </AnimatePresence>
}
