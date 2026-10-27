// Modal surfaces, after arc's dialog and Glass's "Conversation details".
//
//   Sheet     — centred, 14px radius, opaque popup fill; the scrim fades in over `fast` and the
//               panel rises 8px on the enter curve (`standard`).
//   SidePanel — a 560px panel against the right edge (the diff review); slides in 24px from the
//               side it lives on, on the converted smooth tween.
//
// Close: GPUIX's Dialog unmounts on close — and it must. An opacity-tween exit can't fade the
// elevation shadow with the panel, so animated exits leave a dark ghost (same reason menus close
// instantly). Instead the panel freezes and unmounts whole, while a one-beat hold keeps the
// Dialog alive for the scrim to lift over `exit`. Reduced motion skips the hold.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Dialog, DialogBackdrop, DialogPopup, DialogPortal, type PublicInstance } from '@gpuix/react'
import { motion } from './spring'
import { radiusXl } from '../ui/theme'
import { Button } from './Button'
import { Icon } from './Icon'
import { duration, ease, leave, offset, spring, tween, useReducedMotion } from './motion'
import { useM } from './theme'

/**
 * Hold a Dialog mounted one beat past `open → false` so the scrim can lift; then unmount whole.
 * The panel stays frozen the whole time — its shadow can't fade with node opacity (menus quit at
 * this), so the graceful part of the exit is the scrim, never the popup.
 */
function useHoldOpen(open: boolean): boolean {
  const reduced = useReducedMotion()
  const [hold, setHold] = useState(open)
  useEffect(() => {
    if (open) {
      setHold(true)
      return
    }
    if (reduced) { setHold(false); return }
    if (!hold) return
    const timer = setTimeout(() => setHold(false), duration.exit * 1000)
    return () => clearTimeout(timer)
  }, [open, reduced, hold])
  return open || (!reduced && hold)
}

function Scrim({ exiting, onClose }: { exiting: boolean; onClose: () => void }) {
  const m = useM()
  return (
    <DialogBackdrop style={{ backgroundColor: '#00000000' }}>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: exiting ? 0 : 1 }}
        transition={exiting ? leave() : tween({ duration: duration.fast, ease: ease.standard })}
        // A motion.div keeps presses to itself: let the click reach the backdrop, which closes.
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: m.scrim, pointerEvents: 'none' }}
      />
      <div onMouseDown={onClose} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
    </DialogBackdrop>
  )
}

export function Sheet({
  open,
  onClose,
  width,
  children,
  initialFocus,
  testId,
}: {
  open: boolean
  onClose: () => void
  width: number
  children: ReactNode
  initialFocus?: React.RefObject<PublicInstance | null>
  testId?: string
}) {
  const m = useM()
  const hold = useHoldOpen(open)
  return (
    <Dialog open={open || hold} onOpenChange={(next) => !next && onClose()}>
      <DialogPortal>
        <Scrim exiting={!open} onClose={onClose} />
        <DialogPopup
          testId={testId}
          initialFocus={initialFocus}
          style={{
            width,
            maxWidth: '92%',
            backgroundColor: m.popup,
            borderRadius: radiusXl,
            borderWidth: 1,
            borderColor: m.border,
            boxShadow: { offsetX: 0, offsetY: 18, blurRadius: 48, spreadRadius: 0, color: m.shadow },
            overflow: 'hidden',
          }}
        >
          <motion.div
            initial={{ opacity: 0, top: offset.dialog }}
            animate={{ opacity: 1, top: 0 }}
            transition={tween({ duration: duration.standard, ease: ease.enter })}
            style={{ position: 'relative', display: 'flex', flexDirection: 'column', pointerEvents: 'none' }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', pointerEvents: 'auto' }}>{children}</div>
          </motion.div>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  )
}

/** Title row with a close button, as in Glass's details dialog. */
export function SheetHeader({ title, onClose, children }: { title: string; onClose: () => void; children?: ReactNode }) {
  const m = useM()
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, height: 48, paddingLeft: 18, paddingRight: 10, flexShrink: 0 }}>
      <text style={{ flexGrow: 1, minWidth: 0, fontSize: 14, lineHeight: 18, fontWeight: 600, color: m.text, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{title}</text>
      {children}
      <Button onPress={onClose} testId="sheet-close" title="Close (esc)" style={{ width: 24, paddingLeft: 0, paddingRight: 0 }}>
        <Icon name="x" size={13} />
      </Button>
    </div>
  )
}

/** A labelled group inside a sheet. */
export function SheetSection({ label, children, hint }: { label?: string; children: ReactNode; hint?: string }) {
  const m = useM()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 18, paddingRight: 18, paddingTop: 6, paddingBottom: 12 }}>
      {label ? <text style={{ fontSize: 12, lineHeight: 16, fontWeight: 500, color: m.textMuted }}>{label}</text> : null}
      {children}
      {hint ? <text style={{ fontSize: 11.5, lineHeight: 15, color: m.textFaint }}>{hint}</text> : null}
    </div>
  )
}

/** One setting: label on the left, control on the right. */
export function SheetRow({ label, detail, children, testId }: { label: string; detail?: string; children: ReactNode; testId?: string }) {
  const m = useM()
  return (
    <div testId={testId} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 34 }}>
      <div style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <text style={{ fontSize: 13, lineHeight: 17, color: m.textUi }}>{label}</text>
        {detail ? <text style={{ fontSize: 11.5, lineHeight: 15, color: m.textFaint }}>{detail}</text> : null}
      </div>
      {children}
    </div>
  )
}

export function SidePanel({
  open,
  onClose,
  width = 560,
  side = 'right',
  initialFocus,
  children,
  testId,
}: {
  open: boolean
  onClose: () => void
  width?: number
  /** The edge it slides from, and back to. */
  side?: 'left' | 'right'
  initialFocus?: React.RefObject<PublicInstance | null>
  children: ReactNode
  testId?: string
}) {
  const m = useM()
  const hold = useHoldOpen(open)
  const from = side === 'right' ? 24 : -24
  // A panel with nothing focusable still takes esc: its own body holds focus.
  const body = useRef<PublicInstance>(null)
  return (
    <Dialog open={open || hold} onOpenChange={(next) => !next && onClose()}>
      <DialogPortal>
        <Scrim exiting={!open} onClose={onClose} />
        <DialogPopup
          testId={testId}
          initialFocus={initialFocus ?? body}
          style={{
            position: 'absolute',
            top: 8,
            bottom: 8,
            ...(side === 'right' ? { right: 8 } : { left: 8 }),
            width,
            maxWidth: '92%',
            backgroundColor: m.popup,
            borderRadius: radiusXl,
            borderWidth: 1,
            borderColor: m.border,
            boxShadow: { offsetX: 0, offsetY: 18, blurRadius: 48, spreadRadius: 0, color: m.shadow },
            overflow: 'hidden',
          }}
        >
          <motion.div
            initial={{ opacity: 0, left: from }}
            animate={{ opacity: 1, left: 0 }}
            transition={tween(spring.smooth)}
            style={{ position: 'relative', display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, height: '100%' }}
          >
            <div
              ref={body}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'escape') {
                  e.preventDefault()
                  onClose()
                }
              }}
              style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, keyboardFocusDim: false }}
            >
              {children}
            </div>
          </motion.div>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  )
}
