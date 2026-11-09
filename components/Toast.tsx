// A passing confirmation: bottom-left beside the status bar, where it
// never covers the note's tail; under 720px wide the bottom line crowds the approval card,
// so it drops from the top edge instead. Rises once on the enter curve, stays 1.5s, then
// unmounts whole: its elevation cannot fade with node opacity.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useWindowSize } from '@gpuix/react'
import { motion } from './spring'
import { concentric, elevation, radiusBase } from '../ui/theme'
import { Dot } from './Dot'
import { enter, offset, useReducedMotion } from './motion'
import { useM } from './theme'

export type ToastTone = 'neutral' | 'success' | 'danger'
type Shown = { id: number; text: string; tone: ToastTone }

const STAY = 1500

export function useToast() {
  const [shown, setShown] = useState<Shown | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seq = useRef(0)
  const show = useCallback((text: string, tone: ToastTone = 'neutral') => {
    if (timer.current) clearTimeout(timer.current)
    setShown({ id: ++seq.current, text, tone })
    timer.current = setTimeout(() => setShown(null), STAY)
  }, [])
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])
  return { toast: <Toast shown={shown} />, show }
}

function Toast({ shown }: { shown: Shown | null }) {
  const m = useM()
  const reduced = useReducedMotion()
  const window = useWindowSize()
  // Narrow windows stack the approval card nearly full-width over the bottom line;
  // the toast gets out of the way to the top edge instead of layering on top of it.
  const narrow = window.width < 720
  const dot = shown?.tone === 'success' ? m.success : shown?.tone === 'danger' ? m.danger : null
  return (
    <>
      {shown ? (
        // Plain wrapper owns position; the motion child only animates (R13).
        // Nothing here takes presses, so clicks pass straight through to the note.
        <div
          key={shown.id}
          style={{
            position: 'absolute',
            left: narrow ? 0 : 16,
            right: narrow ? 0 : undefined,
            bottom: narrow ? undefined : 50,
            top: narrow ? 46 : undefined,
            display: 'flex',
            flexDirection: 'row',
            justifyContent: narrow ? 'center' : 'flex-start',
            pointerEvents: 'none',
          }}
        >
        <motion.div
          initial={reduced ? false : { opacity: 0, top: narrow ? -offset.toast : offset.toast }}
          animate={{ opacity: 1, top: 0 }}
          transition={enter()}
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            height: 32,
            paddingLeft: 12,
            paddingRight: 12,
            backgroundColor: m.popup,
            borderRadius: concentric(radiusBase + 4, 0),
            borderWidth: 1,
            borderColor: m.border,
            boxShadow: elevation(m, 'popover'),
            pointerEvents: 'none',
          }}
        >
          <div testId="toast" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {dot ? <Dot color={dot} size={6} /> : null}
            <text style={{ fontSize: 12.5, lineHeight: 16, color: m.textUi, whiteSpace: 'nowrap' }}>{shown.text}</text>
          </div>
        </motion.div>
        </div>
      ) : null}
    </>
  )
}
