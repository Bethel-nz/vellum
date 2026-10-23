// Small shared pieces: the material context and a few primitives that only read tokens.

import { createContext, useContext, type ReactNode } from 'react'
import { Button } from '@gpuix/react/button'
import type { StyleDesc } from '@gpuix/react'
import { icons, type IconName } from './icons'
import { font, smoke, type, type Material } from './theme'

export const MaterialContext = createContext<Material>(smoke)
export const useM = () => useContext(MaterialContext)

export function Icon({ name, size = 14, color }: { name: IconName; size?: number; color?: string }) {
  const m = useM()
  return <svg source={icons[name]} style={{ width: size, height: size, flexShrink: 0, color: color ?? m.textMuted }} />
}

export function Meta({ children, color, mono }: { children: ReactNode; color?: string; mono?: boolean }) {
  const m = useM()
  return (
    <text style={{ ...type.meta, color: color ?? m.textFaint, fontFamily: mono ? font.mono : font.sans, whiteSpace: 'nowrap' }}>
      {children}
    </text>
  )
}

export function Dot({ color, size = 7 }: { color: string; size?: number }) {
  return <div style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, flexShrink: 0 }} />
}

/** A quiet text-ish button: pill hover, instant press feedback, keyboard reachable. */
export function Quiet({
  children,
  onPress,
  testId,
  title,
  style,
  disabled,
}: {
  children: ReactNode
  onPress: () => void
  testId?: string
  title?: string
  style?: StyleDesc
  disabled?: boolean
}) {
  const m = useM()
  return (
    <Button
      testId={testId}
      aria-label={title}
      disabled={disabled}
      onClick={onPress}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        height: 24,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: 7,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        userSelect: 'none',
        hover: disabled ? undefined : { backgroundColor: m.hover },
        active: disabled ? undefined : { backgroundColor: m.pressed },
        focusVisible: { outlineWidth: 2, outlineColor: m.focusRing, outlineOffset: 1 },
        ...style,
      }}
    >
      {children}
    </Button>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  const m = useM()
  return (
    <div style={{ paddingLeft: 5, paddingRight: 5, height: 18, borderRadius: 5, borderWidth: 1, borderColor: m.border, display: 'flex', alignItems: 'center' }}>
      <text style={{ fontSize: 10.5, lineHeight: 14, color: m.textMuted, fontFamily: font.mono }}>{children}</text>
    </div>
  )
}
