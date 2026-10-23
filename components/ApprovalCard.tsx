// The approval card: Claude is waiting for your OK on a tool. It rises into the bottom-right
// corner of the pane (after the "Pending" card in a money app): a blue Waiting pill and the
// time it has waited, the verb and scope (`Run in vellum/`), the command in mono, then the
// answers with their keys. ↵ allows, ⌘↵ always allows (only when the CLI offers a rule), esc
// opens a one-line "what to do instead" field whose ↵ denies with that message.
//
// It never takes focus while you write: the composer forwards ↵ ⌘↵ esc here only while it is
// empty. Clicking works the same as the keys.

import { useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from '@gpuix/react'
import { concentric, font, radiusXl } from '../ui/theme'
import { Button, Label } from './Button'
import { Dot } from './Dot'
import { Field } from './Field'
import { Kbd } from './Kbd'
import { duration, ease, offset, spring, tween } from './motion'
import { useM } from './theme'

export type ApprovalView = {
  requestId: string
  title: string
  detail: string
  at: string
  alwaysLabel?: string
}

/** An edit's diff, drawn by the caller (the card has no diff renderer of its own). */
export type ApprovalPreview = ReactNode

function waited(at: string, now: number) {
  const s = Math.max(0, Math.floor((now - new Date(at).getTime()) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function ApprovalCard({
  ask,
  more = 0,
  denying,
  onDenying,
  onAllow,
  onAlways,
  onDeny,
  preview,
}: {
  ask?: ApprovalView
  /** Shown instead of the detail line: what an edit would change. */
  preview?: ApprovalPreview
  /** Asks queued behind this one. */
  more?: number
  /** The deny field is open. */
  denying: boolean
  onDenying: (open: boolean) => void
  onAllow: () => void
  onAlways: () => void
  onDeny: (message: string) => void
}) {
  return <AnimatePresence>{ask ? <Card key={ask.requestId} ask={ask} preview={preview} more={more} denying={denying} onDenying={onDenying} onAllow={onAllow} onAlways={onAlways} onDeny={onDeny} /> : null}</AnimatePresence>
}

function Card({ ask, preview, more, denying, onDenying, onAllow, onAlways, onDeny }: { ask: ApprovalView; preview?: ApprovalPreview; more: number; denying: boolean; onDenying: (open: boolean) => void; onAllow: () => void; onAlways: () => void; onDeny: (message: string) => void }) {
  const m = useM()
  const [now, setNow] = useState(Date.now())
  const [message, setMessage] = useState('')
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const pad = 14
  return (
    // The corner is held by a plain box: the rise animates `top`, which would override `bottom`.
    <div style={{ position: 'absolute', right: 16, bottom: 16, width: 384 }}>
    <motion.div
      initial={{ opacity: 0, top: offset.toast }}
      animate={{ opacity: 1, top: 0 }}
      exit={{ opacity: 0, top: offset.toast / 2 }}
      transition={tween({ ...spring.smooth })}
      style={{ position: 'relative', pointerEvents: 'none' }}
    >
      <div
        testId="approval"
        style={{
          pointerEvents: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          padding: pad,
          backgroundColor: m.popup,
          borderRadius: radiusXl,
          borderWidth: 1,
          borderColor: m.borderFocused,
          boxShadow: { offsetX: 0, offsetY: 18, blurRadius: 44, spreadRadius: 0, color: m.shadow },
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, height: 20, paddingLeft: 7, paddingRight: 8, borderRadius: 10, backgroundColor: m.blue + '1f' }}>
            <Dot color={m.blue} size={6} pulse />
            <text style={{ fontSize: 11.5, lineHeight: 14, fontWeight: 500, color: m.blue }}>Waiting</text>
          </div>
          {more > 0 ? <text style={{ fontSize: 11.5, lineHeight: 14, color: m.textMuted }}>{`+${more} more`}</text> : null}
          <div style={{ flexGrow: 1 }} />
          <text style={{ fontSize: 11.5, lineHeight: 14, color: m.textFaint, fontFamily: font.mono }}>{waited(ask.at, now)}</text>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* Wraps rather than clipping: a long path must never hide behind an ellipsis. */}
          <text style={{ fontSize: 13.5, lineHeight: 18, fontWeight: 500, color: m.text }}>{ask.title}</text>
          {preview && ask.detail ? <text testId="approval-path" style={{ fontSize: 11.5, lineHeight: 16, color: m.textMuted, fontFamily: font.mono }}>{ask.detail}</text> : null}
          {preview ? (
            <div testId="approval-preview" style={{ maxHeight: 240, overflowY: 'scroll', scrollbarColor: m.scrollbar, scrollbarWidth: 6 }}>
              {preview}
            </div>
          ) : ask.detail && ask.detail !== ask.title.split(' ').slice(1).join(' ') ? (
            // The whole command, never clamped: long ones scroll inside the card.
            <div style={{ maxHeight: 168, overflowY: 'scroll', scrollbarColor: m.scrollbar, scrollbarWidth: 6, paddingLeft: 10, paddingRight: 10, paddingTop: 7, paddingBottom: 7, borderRadius: concentric(radiusXl, pad - 4), backgroundColor: m.codeBg, borderWidth: 1, borderColor: m.border }}>
              <text testId="approval-detail" style={{ fontSize: 12.5, lineHeight: 18, color: m.text, fontFamily: font.mono }}>{ask.detail}</text>
            </div>
          ) : null}
        </div>
        <AnimatePresence initial={false}>
          {denying ? (
            <motion.div
              key="deny"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 34 }}
              exit={{ opacity: 0, height: 0 }}
              transition={tween({ duration: duration.fast, ease: ease.enter })}
              style={{ overflow: 'hidden' }}
            >
              <Field
                testId="approval-deny-field"
                value={message}
                autoFocus
                placeholder="Tell Claude what to do instead (optional)"
                onChange={setMessage}
                onSubmit={() => onDeny(message)}
                onKeyDown={(e) => {
                  if (e.key === 'escape') {
                    e.preventDefault()
                    onDenying(false)
                  }
                }}
              />
            </motion.div>
          ) : null}
        </AnimatePresence>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {denying ? (
            <>
              <Button variant="danger" onPress={() => onDeny(message)} testId="approval-deny-send">
                <Label variant="danger">Deny</Label>
                <Kbd>↵</Kbd>
              </Button>
              <Button onPress={() => onDenying(false)} testId="approval-deny-cancel">
                <Label muted>Back</Label>
                <Kbd>esc</Kbd>
              </Button>
            </>
          ) : (
            <>
              <Button variant="solid" onPress={onAllow} testId="approval-allow" style={{ borderRadius: concentric(radiusXl, pad - 4) }}>
                <Label variant="solid">Allow</Label>
                <text style={{ fontSize: 11, lineHeight: 14, color: m.pane, fontFamily: font.mono }}>↵</text>
              </Button>
              {ask.alwaysLabel ? (
                <Button onPress={onAlways} testId="approval-always" title={`Always allow ${ask.alwaysLabel} in this folder`} style={{ flexShrink: 1, minWidth: 0 }}>
                  <text style={{ fontSize: 12.5, lineHeight: 16, fontWeight: 500, color: m.textUi, whiteSpace: 'nowrap', textOverflow: 'ellipsis', flexShrink: 1, minWidth: 0 }}>{`Always allow ${ask.alwaysLabel}`}</text>
                  <Kbd>⌘↵</Kbd>
                </Button>
              ) : null}
              <div style={{ flexGrow: 1 }} />
              <Button onPress={() => onDenying(true)} testId="approval-deny">
                <Label muted>Deny…</Label>
                <Kbd>esc</Kbd>
              </Button>
            </>
          )}
        </div>
      </div>
    </motion.div>
    </div>
  )
}

