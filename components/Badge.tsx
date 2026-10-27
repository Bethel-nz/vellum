// A count or short label. Arc's badge swaps its value with a rise; GPUIX can't move text inside
// a box without a wrapper per value, so a new value fades in over `instant`.
//
// Tone pair with diff counts (`diffInk`): washes here (chipBg/diffAdd/diffDel) carry the label,
// solid Pierre ink carries the +/- numbers next to a diff. Wash = status, ink = measurement.

import { motion } from './spring'
import { font } from '../ui/theme'
import { enter } from './motion'
import { useM } from './theme'

export function Badge({ children, tone = 'neutral' }: { children: string | number; tone?: 'neutral' | 'accent' | 'success' | 'danger' | 'solid' }) {
  const m = useM()
  const fg = tone === 'accent' ? m.accent : tone === 'success' ? m.success : tone === 'danger' ? m.danger : tone === 'solid' ? m.pane : m.textMuted
  const bg = tone === 'accent' ? m.skillBg : tone === 'success' ? m.diffAdd : tone === 'danger' ? m.diffDel : tone === 'solid' ? m.text : m.chipBg
  return (
    <motion.div
      key={String(children)}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={enter('instant')}
      style={{ height: 16, minWidth: 16, paddingLeft: 5, paddingRight: 5, borderRadius: 8, backgroundColor: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
    >
      <text style={{ fontSize: 10.5, lineHeight: 12, fontWeight: 600, color: fg, fontFamily: font.mono }}>{String(children)}</text>
    </motion.div>
  )
}
