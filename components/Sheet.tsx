// Modal surfaces, after arc's dialog and Glass's "Conversation details".
//
//   Sheet     — centred, 14px radius, opaque popup fill; the scrim fades in over `fast` and the
//               panel rises 8px on the enter curve (`standard`).
//   SidePanel — a 560px panel against the right edge (the diff review); slides in 24px from the
//               side it lives on, over `considered` / 2 on the standard curve.
//
// GPUIX's Dialog unmounts on close, so both have enter motion only; the close is instant.

import type { ReactNode } from 'react'
import { Dialog, DialogBackdrop, DialogPopup, DialogPortal, motion, type PublicInstance } from '@gpuix/react'
import { radiusXl } from '../ui/theme'
import { Button } from './Button'
import { Icon } from './Icon'
import { duration, ease, offset, tween } from './motion'
import { useM } from './theme'

function Scrim() {
  const m = useM()
  return (
    <DialogBackdrop style={{ backgroundColor: '#00000000' }}>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={tween({ duration: duration.fast, ease: ease.standard })}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: m.scrim }}
      />
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
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPortal>
        <Scrim />
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
            style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}
          >
            {children}
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
      <Button onPress={onClose} testId="sheet-close" title="Close (Esc)" style={{ width: 24, paddingLeft: 0, paddingRight: 0 }}>
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
  const from = side === 'right' ? 24 : -24
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPortal>
        <Scrim />
        <DialogPopup
          testId={testId}
          initialFocus={initialFocus}
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
            transition={tween({ duration: duration.considered / 2 + 0.06, ease: ease.standard })}
            style={{ position: 'relative', display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, height: '100%' }}
          >
            {children}
          </motion.div>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  )
}
