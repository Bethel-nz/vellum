// A single-line text field, after arc's input and Glass's "Conversation name" field: panel fill,
// hairline, and a blue focus ring that comes up over 100ms.

import { useState } from 'react'
import type { KeyEvent, PublicInstance } from '@gpuix/react'
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
        backgroundColor: m.rootTint,
        borderRadius: concentric(radiusBase, 1),
        borderWidth: 1,
        borderColor: focused ? m.focusRing : m.borderFocused,
        flexGrow: 1,
        minWidth: 0,
      }}
    />
  )
}
