// Shared note-library rows and relative timestamps.
import type { ReactNode } from 'react'
import { Button } from '@gpuix/react/button'
import { useM } from './kit'
import { concentric, radiusXl } from './theme'

/** A selectable row in a dialog list (recipes reuse it): quiet fill, hover wash, token radius. */
export function Row({ selected, onPress, children, testId }: { selected?: boolean; onPress: () => void; children: ReactNode; testId?: string }) {
  const m = useM()
  return (
    <Button
      testId={testId}
      onClick={onPress}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        minHeight: 34,
        paddingLeft: 10,
        paddingRight: 6,
        borderRadius: concentric(radiusXl, 8),
        backgroundColor: selected ? m.popupHover : m.popup,
        cursor: 'pointer',
        hover: { backgroundColor: m.popupHover },
        focusVisible: { outlineWidth: 2, outlineColor: m.focusRing },
      }}
    >
      {children}
    </Button>
  )
}

export function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}
