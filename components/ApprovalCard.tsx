// One expanded request, after Arc's Deploy agent card. Real command/path and preview,
// quiet Deny at the left, rule choice and the primary approval at the right.
// Arrival never takes focus. The shadowed card unmounts atomically; only the inset deny
// field (which has no elevation) may animate out.

import { useEffect, useState, type ReactNode } from 'react'
import { useWindowSize } from '@gpuix/react'
import { AnimatePresence, motion } from './spring'
import { concentric, elevation, font, radiusXl } from '../ui/theme'
import { Button, Label } from './Button'
import { Field } from './Field'
import { useAgent } from './AgentContext'
import { Icon } from './Icon'
import { Kbd } from './Kbd'
import { Menu } from './Menu'
import { Scroll } from './Scroll'
import { enter, offset, useReducedMotion } from './motion'
import { useM } from './theme'

export type ApprovalView = {
  requestId: string
  title: string
  detail: string
  at: string
  tool?: string
  input?: Record<string, unknown>
  reason?: string
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
  const agent = useAgent()
  const reduced = useReducedMotion()
  const window = useWindowSize()
  const [now, setNow] = useState(Date.now())
  const [message, setMessage] = useState('')
  const [rulesOpen, setRulesOpen] = useState(false)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const command = ask.tool === 'Bash'
  const inputs = Object.entries(ask.input ?? {})
  const detailKey = inputs.some(([key]) => key === 'command') ? 'command' : inputs[0]?.[0]
  const toolIcon = command ? 'terminalBox' : /edit|write/i.test(ask.tool ?? '') ? 'pencil' : /^mcp__/.test(ask.tool ?? '') ? 'layers' : 'file'
  return (
    <div style={{ position: 'absolute', right: 14, bottom: CARD_BOTTOM, width: Math.min(480, window.width - 36) }}>
      <motion.div initial={reduced ? false : { opacity: 0, top: offset.dialog }} animate={{ opacity: 1, top: 0 }} transition={enter()} style={{ position: 'relative', pointerEvents: 'none' }}>
        <div testId="approval" style={{ pointerEvents: 'auto', display: 'flex', flexDirection: 'column', gap: 16, padding: 18, backgroundColor: m.popup, borderRadius: radiusXl, borderWidth: 1, borderColor: m.borderFocused, boxShadow: elevation(m, 'card') }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}><text style={{ fontSize: 13, lineHeight: 18, fontWeight: 500, color: m.text }}>Approval</text><text style={{ fontSize: 11.5, lineHeight: 16, color: m.textMuted }}>{`${more + 1} pending`}</text></div>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name={agent.id} size={15} color={m.accent} />
            <text style={{ fontSize: 12.5, lineHeight: 17, fontWeight: 500, color: m.text }}>{agent.title}</text>
            {ask.tool?.startsWith('mcp__') ? <text style={{ minWidth: 0, fontSize: 11.5, lineHeight: 16, color: m.textMuted }}>{ask.tool.split('__')[1]}</text> : null}
            {model ? <text style={{ fontSize: 11.5, lineHeight: 16, color: m.textMuted }}>{model}</text> : null}
            <div style={{ flexGrow: 1 }} />
            <text style={{ fontSize: 11.5, lineHeight: 16, color: m.textMuted }}>{`${waited(ask.at, now)} waiting`}</text>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'start', gap: 8 }}><Icon name={toolIcon} size={18} color={m.textUi} /><text style={{ flexGrow: 1, minWidth: 0, fontSize: 17, lineHeight: 23, fontWeight: 500, color: m.text }}>{ask.title}</text></div>
            {ask.reason ? <text style={{ fontSize: 12, lineHeight: 18, color: m.textMuted, lineClamp: 3 }}>{ask.reason}</text> : null}
          </div>
          {preview ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ask.detail ? <text testId="approval-path" style={{ fontSize: 12, lineHeight: 17, color: m.textMuted, fontFamily: font.mono }}>{ask.detail}</text> : null}
              <Scroll testId="approval-preview" style={{ maxHeight: 240 }}>{preview}</Scroll>
            </div>
          ) : ask.detail || inputs.length ? (
            <Scroll testId="approval-arguments" style={{ maxHeight: Math.min(220, Math.max(100, window.height - 360)), borderRadius: concentric(radiusXl, 2), backgroundColor: m.chipBg }} padding={{ left: 14, right: 14, top: 12, bottom: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {inputs.length ? inputs.map(([key, value]) => <Detail key={key} label={key === 'command' ? 'Command' : key.replaceAll('_', ' ')} value={typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? String(value)} testId={key === detailKey ? 'approval-detail' : undefined} />) : <Detail label={command ? 'Command' : 'Target'} value={ask.detail} testId="approval-detail" />}
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
                {ask.alwaysLabel ? <div onKeyDown={(event) => { if (event.key === 'escape' && rulesOpen) { event.preventDefault(); event.stopPropagation(); setRulesOpen(false) } }} style={{ position: 'relative' }}><Button onPress={() => setRulesOpen((open) => !open)} testId="approval-always" title={ask.alwaysLabel}><Label muted>Always allow</Label><Icon name="chevronDown" size={12} /></Button><Menu open={rulesOpen} onClose={() => setRulesOpen(false)} align="end" side="top" width={300} testId="approval-rules" items={[{ kind: 'label', label: 'Allow this exact rule' }, { label: ask.alwaysLabel, testId: 'approval-always-confirm', icon: 'check', onSelect: onAlways }]} /></div> : null}
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
