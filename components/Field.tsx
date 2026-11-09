// A single-line text field: panel fill,
// hairline, and a blue focus ring that comes up over 100ms.

import { useState } from 'react'
import type { KeyEvent, PublicInstance, StyleDesc } from '@gpuix/react'
import { concentric, radiusBase } from '../ui/theme'
import { useM } from './theme'

export function Field({
  value,
  onChange,
  onSubmit,
  onKeyDown,
  placeholder,
  autoFocus,
  testId,
  fieldRef,
  mono,
  quiet,
  style,
}: {
  value: string
  onChange: (next: string) => void
  onSubmit?: () => void
  onKeyDown?: (e: KeyEvent) => void
  placeholder?: string
  autoFocus?: boolean
  testId?: string
  fieldRef?: React.Ref<PublicInstance>
  mono?: boolean
  /** A chip fill and no hairline until focused: a field among rows of a list, not in a form. */
  quiet?: boolean
  /** Size and shape overrides. */
  style?: StyleDesc
}) {
  const m = useM()
  const [focused, setFocused] = useState(Boolean(autoFocus))
  return (
    <input
      ref={fieldRef}
      testId={testId}
      value={value}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.value ?? '')}
      onSubmit={onSubmit}
      onKeyDown={onKeyDown}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      theme={{ caret: m.termCursor, textFaint: m.textFaint }}
      style={{
        height: 32,
        paddingLeft: 10,
        paddingRight: 10,
        fontSize: 13.5,
        lineHeight: 18,
        fontFamily: mono ? 'Geist Mono' : undefined,
        color: m.text,
        backgroundColor: quiet ? m.chipBg : m.rootTint,
        borderRadius: concentric(radiusBase, 1),
        borderWidth: 1,
        borderColor: focused ? m.focusRing : quiet ? '#00000000' : m.borderFocused,
        flexGrow: 1,
        minWidth: 0,
        ...style,
      }}
    />
  )
}
