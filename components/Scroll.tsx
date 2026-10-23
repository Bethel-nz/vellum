// A vertical scroll box that only shows its thumb when there is more to see, with room for it.
//
// GPUIX counts a scroll box's own padding as overflow, so a padded box paints a full-length thumb
// over three short rows, and the thumb sits on the rows' edge (spikes/scrollbar.tsx). So the box
// carries no padding: an inner column that never shrinks holds it, and keeps a gutter on the
// right wide enough for the 6px thumb plus air.

import type { ReactNode } from 'react'
import type { StyleDesc } from '@gpuix/react'
import { useM } from './theme'

const THUMB = 6
const AIR = 4

export function Scroll({
  children,
  style,
  padding = 0,
  gap,
  testId,
}: {
  children: ReactNode
  /** The box: size, background, border. Not padding; use `padding`. */
  style?: StyleDesc
  padding?: number | { top?: number; right?: number; bottom?: number; left?: number }
  gap?: number
  testId?: string
}) {
  const m = useM()
  const p = typeof padding === 'number' ? { top: padding, right: padding, bottom: padding, left: padding } : padding
  return (
    <div testId={testId} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflowY: 'scroll', scrollbarColor: m.scrollbar, scrollbarWidth: THUMB, ...style }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          gap,
          paddingTop: p.top ?? 0,
          paddingBottom: p.bottom ?? 0,
          paddingLeft: p.left ?? 0,
          paddingRight: Math.max(p.right ?? 0, THUMB + AIR * 2),
        }}
      >
        {children}
      </div>
    </div>
  )
}
