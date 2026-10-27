// A segmented control, after arc's: equal segments, one selection pill that glides between them
// on the morph curve (arc uses a shared-layout spring; GPUIX animates `left` instead).

import { motion } from './spring'
import { useState } from 'react'
import { Button as Base } from '@gpuix/react/button'
import { controlHeight, controlRadius } from './Button'
import { spring, tween, useReducedMotion } from './motion'
import { useM } from './theme'

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  width = 80,
  testId,
  pill = false,
}: {
  options: Array<{ value: T; label: string }>
  value: T
  onChange: (next: T) => void
  /** Width of one segment, or equal segments filling the control. */
  width?: number | 'fill'
  testId?: string
  pill?: boolean
}) {
  const m = useM()
  useReducedMotion()
  const [measuredWidth, setMeasuredWidth] = useState(0)
  const segmentWidth = width === 'fill' ? Math.max(0, measuredWidth - 6) / Math.max(1, options.length) : width
  const index = Math.max(0, options.findIndex((o) => o.value === value))
  return (
    <div
      testId={testId}
      onLayout={width === 'fill' ? (event) => setMeasuredWidth(event.width ?? 0) : undefined}
      style={{ position: 'relative', display: 'flex', flexDirection: 'row', padding: 2, borderRadius: pill ? controlHeight / 2 + 2 : controlRadius + 2, backgroundColor: pill ? m.chipBg : m.panel, borderWidth: 1, borderColor: m.border, flexShrink: 0 }}
    >
      <motion.div
        initial={false}
        animate={{ left: 2 + index * segmentWidth }}
        transition={tween(spring.morph)}
        style={{ position: 'absolute', top: 2, width: segmentWidth, height: controlHeight, borderRadius: pill ? controlHeight / 2 : controlRadius, backgroundColor: pill ? m.popup : m.selected, pointerEvents: 'none' }}
      />
      {options.map((o) => (
        <Base
          key={o.value}
          testId={testId ? `${testId}-${o.value}` : undefined}
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          style={{ position: 'relative', width: segmentWidth, height: controlHeight, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: pill ? controlHeight / 2 : controlRadius, cursor: 'pointer' }}
        >
          <text style={{ fontSize: 12, lineHeight: 16, fontWeight: 500, color: o.value === value ? m.text : m.textMuted }}>{o.label}</text>
        </Base>
      ))}
    </div>
  )
}
