// A passing confirmation, after arc's toast: bottom-left, rises 16px on the enter curve, stays
// 1.5s, then unmounts whole: its elevation cannot fade with node opacity.

import { useCallback, useEffect, useRef, useState } from 'react'
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
  const dot = shown?.tone === 'success' ? m.success : shown?.tone === 'danger' ? m.danger : null
  return (
    <>
      {shown ? (
        <motion.div
          key={shown.id}
          initial={reduced ? false : { opacity: 0, bottom: 16 - offset.toast }}
          animate={{ opacity: 1, bottom: 16 }}
          transition={enter()}
          style={{
            position: 'absolute',
            // Bottom-left: the bottom-right corner belongs to the status bar and the approval card.
            left: 16,
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
          }}
        >
          <div testId="toast" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {dot ? <Dot color={dot} size={6} /> : null}
            <text style={{ fontSize: 12.5, lineHeight: 16, color: m.textUi, whiteSpace: 'nowrap' }}>{shown.text}</text>
          </div>
        </motion.div>
      ) : null}
    </>
  )
}
