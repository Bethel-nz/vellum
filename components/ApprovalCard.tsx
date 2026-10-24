// One expanded request, after Arc's Deploy agent card. Real command/path and preview,
// quiet Deny at the left, rule choice and the primary approval at the right.
// Arrival never takes focus. The shadowed card unmounts atomically; only the inset deny
// field (which has no elevation) may animate out.

import { useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useWindowSize } from '@gpuix/react'
import { concentric, elevation, font, radiusXl } from '../ui/theme'
import { Button, Label } from './Button'
import { Field } from './Field'
import { Icon } from './Icon'
import { Kbd } from './Kbd'
import { Scroll } from './Scroll'
import { enter, offset, useReducedMotion } from './motion'
import { useM } from './theme'

export type ApprovalView = {
  requestId: string
  title: string
  detail: string
  at: string
  tool?: string
  /** The actual rule offered by the agent. Never invent a broader permission. */
  alwaysLabel?: string
}

export type ApprovalPreview = ReactNode
const CARD_BOTTOM = 46

function waited(at: string, now: number) {
  const seconds = Math.max(0, Math.floor((now - new Date(at).getTime()) / 1000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

type Props = {
  ask?: ApprovalView
  preview?: ApprovalPreview
  more?: number
  workspace?: string
  model?: string
  denying: boolean
  onDenying: (open: boolean) => void
  onAllow: () => void
  onAlways: () => void
  onDeny: (message: string) => void
}

export function ApprovalCard(props: Props) {
  return props.ask ? <Card key={props.ask.requestId} {...props} ask={props.ask} /> : null
}

function Card({ ask, preview, more = 0, workspace, model, denying, onDenying, onAllow, onAlways, onDeny }: Props & { ask: ApprovalView }) {
  const m = useM()
  const reduced = useReducedMotion()
  const window = useWindowSize()
  const [now, setNow] = useState(Date.now())
  const [message, setMessage] = useState('')
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const command = ask.tool === 'Bash'
  return (
    <div style={{ position: 'absolute', right: 14, bottom: CARD_BOTTOM, width: Math.min(480, window.width - 36) }}>
      <motion.div initial={reduced ? false : { opacity: 0, top: offset.dialog }} animate={{ opacity: 1, top: 0 }} transition={enter()} style={{ position: 'relative', pointerEvents: 'none' }}>
        <div testId="approval" style={{ pointerEvents: 'auto', display: 'flex', flexDirection: 'column', gap: 16, padding: 18, backgroundColor: m.popup, borderRadius: radiusXl, borderWidth: 1, borderColor: m.borderFocused, boxShadow: elevation(m, 'card') }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="claude" size={15} color={m.accent} />
            <text style={{ fontSize: 12.5, lineHeight: 17, fontWeight: 500, color: m.text }}>Claude</text>
            {model ? <text style={{ fontSize: 11.5, lineHeight: 16, color: m.textMuted }}>{model}</text> : null}
            <div style={{ flexGrow: 1 }} />
            <text style={{ fontSize: 11.5, lineHeight: 16, color: m.textFaint }}>{`${waited(ask.at, now)} waiting`}</text>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <text style={{ fontSize: 17, lineHeight: 23, fontWeight: 500, color: m.text }}>{ask.title}</text>
            <text style={{ fontSize: 12, lineHeight: 17, color: m.textMuted }}>{more > 0 ? `${more + 1} requests pending` : 'Waiting for your approval'}</text>
          </div>
          {preview ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ask.detail ? <text testId="approval-path" style={{ fontSize: 12, lineHeight: 17, color: m.textMuted, fontFamily: font.mono }}>{ask.detail}</text> : null}
              <Scroll testId="approval-preview" style={{ maxHeight: 240 }}>{preview}</Scroll>
            </div>
          ) : ask.detail ? (
            <Scroll style={{ maxHeight: 200, borderRadius: concentric(radiusXl, 2), backgroundColor: m.chipBg }} padding={{ left: 14, right: 14, top: 12, bottom: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Detail label={command ? 'Command' : 'Target'} value={ask.detail} testId="approval-detail" />
                {workspace && command ? <Detail label="Folder" value={workspace} /> : null}
                {ask.alwaysLabel ? <Detail label="Rule" value={ask.alwaysLabel} /> : null}
              </div>
            </Scroll>
          ) : null}
          <AnimatePresence initial={false}>
            {denying ? (
              <motion.div key="deny" initial={reduced ? false : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: 34 }} exit={{ opacity: 0, height: 0 }} transition={enter('fast')} style={{ overflow: 'hidden' }}>
                <Field testId="approval-deny-field" value={message} autoFocus placeholder="e.g. run this against the preview instead" onChange={setMessage} onSubmit={() => onDeny(message)} onKeyDown={(event) => { if (event.key === 'escape') { event.preventDefault(); onDenying(false) } }} />
              </motion.div>
            ) : null}
          </AnimatePresence>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 2 }}>
            {denying ? (
              <>
                <Button onPress={() => onDenying(false)} testId="approval-deny-cancel"><Label muted>Back</Label><Kbd>esc</Kbd></Button>
                <div style={{ flexGrow: 1 }} />
                <Button variant="danger" onPress={() => onDeny(message)} testId="approval-deny-send"><Label variant="danger">Deny</Label><Kbd>↵</Kbd></Button>
              </>
            ) : (
              <>
                <Button onPress={() => onDenying(true)} testId="approval-deny" style={{ marginLeft: -8 }}><Label muted>Deny</Label></Button>
                <div style={{ flexGrow: 1 }} />
                {ask.alwaysLabel ? <Button onPress={onAlways} testId="approval-always" title={ask.alwaysLabel}><Label muted>Always allow</Label></Button> : null}
                <Button variant="solid" onPress={onAllow} testId="approval-allow" style={{ height: 32, minHeight: 32, paddingLeft: 13, paddingRight: 9, borderRadius: 16, gap: 8 }}>
                  <Label variant="solid">Approve</Label>
                  <div style={{ width: 20, height: 20, borderRadius: 6, borderWidth: 1, borderColor: `${m.pane.slice(0, 7)}44`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><text style={{ fontSize: 12, lineHeight: 15, color: m.pane }}>↵</text></div>
                </Button>
              </>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  )
}

function Detail({ label, value, testId }: { label: string; value: string; testId?: string }) {
  const m = useM()
  return (
    <div style={{ display: 'flex', flexDirection: 'row', gap: 12, alignItems: 'start' }}>
      <text style={{ width: 64, flexShrink: 0, fontSize: 12, lineHeight: 18, color: m.textMuted }}>{label}</text>
      <text testId={testId} style={{ flexGrow: 1, minWidth: 0, fontSize: 12, lineHeight: 18, color: m.text, fontFamily: font.mono }}>{value}</text>
    </div>
  )
}
