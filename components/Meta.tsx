import type { ReactNode } from 'react'
import { font, type } from '../ui/theme'
import { useM } from './theme'

/** Small grey metadata: times, paths, counts. */
export function Meta({ children, color, mono }: { children: ReactNode; color?: string; mono?: boolean }) {
  const m = useM()
  return (
    <text style={{ ...type.meta, color: color ?? m.textMuted, fontFamily: mono ? font.mono : font.sans, whiteSpace: 'nowrap' }}>
      {children}
    </text>
  )
}
