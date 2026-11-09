// A vertical scroll box that only shows its thumb when there is more to see, with room for it.
// The box carries no padding: an inner column that never shrinks holds it, and keeps a gutter
// on the right wide enough for the thumb plus air.

import type { ReactNode, Ref } from 'react'
import type { PublicInstance, StyleDesc } from '@gpuix/react'
import { useM } from './theme'
import { scrollbarWidth } from '../ui/theme'

const THUMB = scrollbarWidth
const AIR = 4

export function Scroll({
  children,
  style,
  padding = 0,
  gap,
  gutter = THUMB + AIR * 2,
  testId,
  scrollRef,
}: {
  children: ReactNode
  /** The box: size, background, border. Not padding; use `padding`. */
  style?: StyleDesc
  padding?: number | { top?: number; right?: number; bottom?: number; left?: number }
  gap?: number
  /** Room on the right for the thumb. Narrower only where the rows' own padding can take it. */
  gutter?: number
  testId?: string
  scrollRef?: Ref<PublicInstance>
}) {
  const m = useM()
  const p = typeof padding === 'number' ? { top: padding, right: padding, bottom: padding, left: padding } : padding
  return (
    <div ref={scrollRef} testId={testId} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflowY: 'scroll', scrollbarColor: m.scrollbar, scrollbarWidth: THUMB, pointerEvents: 'auto', ...style }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          gap,
          paddingTop: p.top ?? 0,
          paddingBottom: p.bottom ?? 0,
          paddingLeft: p.left ?? 0,
          paddingRight: Math.max(p.right ?? 0, gutter),
        }}
      >
        {children}
      </div>
    </div>
  )
}
