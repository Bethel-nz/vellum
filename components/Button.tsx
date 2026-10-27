// Buttons, after arc's button and Glass's toolbar (`.lg-toolbar`): 22px tall, 8px side padding,
// alpha washes instead of opaque chips. Feedback is on press (`active`), commit on click.
//
//   quiet   — text-ish shell control (header, menus, inline actions)
//   solid   — the one primary action in a sheet
//   danger  — destructive text action
//
// `Toolbar` is a cluster: 4px gaps; `segmented` joins its buttons into one rounded unit.

import type { ReactNode } from 'react'
import { Button as Base } from '@gpuix/react/button'
import type { PublicInstance, StyleDesc } from '@gpuix/react'
import { keys } from '../core/platform'
import { concentric, radiusBase } from '../ui/theme'
import { useM } from './theme'

export const controlHeight = 22
export const controlRadius = concentric(radiusBase, 3)

export function Button({
  children,
  onPress,
  onPressStart,
  variant = 'quiet',
  testId,
  title,
  style,
  disabled,
  selected,
  buttonRef,
}: {
  children: ReactNode
  onPress: () => void
  onPressStart?: () => void
  variant?: 'quiet' | 'solid' | 'danger'
  testId?: string
  title?: string
  style?: StyleDesc
  disabled?: boolean
  /** Shows the pressed wash while a menu it owns is open. */
  selected?: boolean
  buttonRef?: React.Ref<PublicInstance>
}) {
  const m = useM()
  const solid = variant === 'solid'
  const bg = solid ? m.action.background : selected ? m.pressed : '#00000000'
  return (
    <Base
      ref={buttonRef}
      testId={testId}
      aria-label={title === undefined ? undefined : keys(title)}
      disabled={disabled}
      onClick={onPress}
      onMouseDown={onPressStart}
      onKeyDown={(event) => { if (event.key === 'enter' || event.key === 'space') onPressStart?.() }}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        minHeight: controlHeight,
        height: controlHeight,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: controlRadius,
        backgroundColor: bg,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        userSelect: 'none',
        flexShrink: 0,
        hover: disabled ? undefined : { backgroundColor: solid ? m.action.hover : m.hover },
        active: disabled ? undefined : { backgroundColor: solid ? m.action.pressed : m.pressed },
        focusVisible: { outlineWidth: 2, outlineColor: m.focusRing, outlineOffset: 1 },
        ...style,
      }}
    >
      {children}
    </Base>
  )
}

/** Button label in the right colour for its variant. */
export function Label({ children, variant = 'quiet', muted }: { children: ReactNode; variant?: 'quiet' | 'solid' | 'danger'; muted?: boolean }) {
  const m = useM()
  const color = variant === 'solid' ? m.action.text : variant === 'danger' ? m.danger : muted ? m.textMuted : m.textUi
  return <text style={{ fontSize: 12.5, lineHeight: 16, fontWeight: 500, color, whiteSpace: 'nowrap' }}>{children}</text>
}

export function Toolbar({ children, segmented, style }: { children: ReactNode; segmented?: boolean; style?: StyleDesc }) {
  const m = useM()
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: segmented ? 0 : 4,
        flexShrink: 0,
        ...(segmented ? { padding: 1, borderRadius: controlRadius + 1, borderWidth: 1, borderColor: m.border } : {}),
        ...style,
      }}
    >
      {children}
    </div>
  )
}
