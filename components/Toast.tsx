// A passing confirmation, after arc's toast: bottom-right, rises 16px on the enter curve, stays
// 1.5s, fades out. One at a time; a new toast replaces the current one.

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from '@gpuix/react'
import { concentric, radiusBase } from '../ui/theme'
import { Dot } from './Dot'
import { duration, ease, offset, tween } from './motion'
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
  const dot = shown?.tone === 'success' ? m.success : shown?.tone === 'danger' ? m.danger : null
  return (
    <AnimatePresence>
      {shown ? (
        <motion.div
          key={shown.id}
          initial={{ opacity: 0, bottom: 16 - offset.toast }}
          animate={{ opacity: 1, bottom: 16 }}
          exit={{ opacity: 0, bottom: 16 }}
          transition={tween({ duration: duration.standard, ease: ease.enter })}
          style={{
            position: 'absolute',
            // Bottom-right: the bottom-left corner belongs to the status bar and the approval card.
            right: 16,
            display: 'flex',
            alignItems: 'center',
            height: 32,
            paddingLeft: 12,
            paddingRight: 12,
            backgroundColor: m.popup,
            borderRadius: concentric(radiusBase + 4, 0),
            borderWidth: 1,
            borderColor: m.border,
            boxShadow: { offsetX: 0, offsetY: 8, blurRadius: 24, spreadRadius: 0, color: m.shadow },
          }}
        >
          <div testId="toast" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {dot ? <Dot color={dot} size={6} /> : null}
            <text style={{ fontSize: 12.5, lineHeight: 16, color: m.textUi, whiteSpace: 'nowrap' }}>{shown.text}</text>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
