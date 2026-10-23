// A segmented control, after arc's: equal segments, one selection pill that glides between them
// on the morph curve (arc uses a shared-layout spring; GPUIX animates `left` instead).

import { motion } from '@gpuix/react'
import { Button as Base } from '@gpuix/react/button'
import { controlHeight, controlRadius } from './Button'
import { spring, tween } from './motion'
import { useM } from './theme'

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  width = 80,
  testId,
}: {
  options: Array<{ value: T; label: string }>
  value: T
  onChange: (next: T) => void
  /** Width of one segment. */
  width?: number
  testId?: string
}) {
  const m = useM()
  const index = Math.max(0, options.findIndex((o) => o.value === value))
  return (
    <div
      testId={testId}
      style={{ position: 'relative', display: 'flex', flexDirection: 'row', padding: 2, borderRadius: controlRadius + 2, backgroundColor: m.panel, borderWidth: 1, borderColor: m.border, flexShrink: 0 }}
    >
      <motion.div
        initial={false}
        animate={{ left: 2 + index * width }}
        transition={tween(spring.morph)}
        style={{ position: 'absolute', top: 2, width, height: controlHeight, borderRadius: controlRadius, backgroundColor: m.selected }}
      />
      {options.map((o) => (
        <Base
          key={o.value}
          testId={testId ? `${testId}-${o.value}` : undefined}
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          style={{ width, height: controlHeight, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: controlRadius, cursor: 'pointer' }}
        >
          <text style={{ fontSize: 12, lineHeight: 16, fontWeight: 500, color: o.value === value ? m.text : m.textMuted }}>{o.label}</text>
        </Base>
      ))}
    </div>
  )
}
