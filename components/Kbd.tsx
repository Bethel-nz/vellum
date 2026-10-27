import type { ReactNode } from 'react'
import { keys } from '../core/platform'
import { font } from '../ui/theme'
import { useM } from './theme'

/** A shortcut chip: mono 10.5, 18 high, radius 5, alpha hairline. Rides inside buttons and menu rows. */
export function Kbd({ children }: { children: ReactNode }) {
  const m = useM()
  return (
    <div style={{ paddingLeft: 5, paddingRight: 5, height: 18, borderRadius: 6, borderWidth: 1, borderColor: m.borderFocused, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
      <text style={{ fontSize: 10.5, lineHeight: 14, color: m.textMuted, fontFamily: font.mono }}>{typeof children === 'string' ? keys(children) : children}</text>
    </div>
  )
}
