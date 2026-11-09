// One expanded request. Real command/path and preview,
// quiet Deny at the left, rule choice and the primary approval at the right.
// Arrival never takes focus. The shadowed card unmounts atomically; only the inset deny
// field (which has no elevation) may animate out. A queue keeps the card: the next request
// fades into place and the body's height springs to fit it (arc's agent-approvals).

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useWindowSize } from '@gpuix/react'
import { AnimatePresence, motion } from './spring'
import { concentric, elevation, font, radiusBase, radiusXl, type } from '../ui/theme'
import { Button, Label } from './Button'
import { Field } from './Field'
import { useAgent } from './AgentContext'
import { Icon, brandMarks } from './Icon'
import { Kbd } from './Kbd'
import { Menu } from './Menu'
import { RollingNumber } from './RollingNumber'
import { Scroll } from './Scroll'
import { enter, offset, spring, tween, useReducedMotion } from './motion'
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
// Above the status bar (28) with 22px clearance: one focal line with toasts.
const CARD_BOTTOM = 50

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
  // One card for the whole queue: the next request swaps the content and the surface stays.
  return props.ask ? <Card {...props} ask={props.ask} /> : null
}

/** The full path, with the home folder as `~`. */
const home = (p: string) => (process.env.HOME && p.startsWith(`${process.env.HOME}/`) ? `~${p.slice(process.env.HOME.length)}` : p)

const labelFor = (key: string) => (key === 'command' ? 'Command' : `${key.charAt(0).toUpperCase()}${key.slice(1).replaceAll('_', ' ')}`)

function Card({ ask, preview, more = 0, workspace, model, denying, onDenying, onAllow, onAlways, onDeny }: Props & { ask: ApprovalView }) {
  const m = useM()
  const agent = useAgent()
  const reduced = useReducedMotion()
  const window = useWindowSize()
  const [now, setNow] = useState(Date.now())
  const [message, setMessage] = useState('')
  const [rulesOpen, setRulesOpen] = useState(false)
  // The body's measured height: the first lands at once, later requests spring to theirs.
  const [height, setHeight] = useState(0)
  const [settled, setSettled] = useState(false)
  const firstId = useRef(ask.requestId)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    setMessage('')
    setRulesOpen(false)
  }, [ask.requestId])
  useEffect(() => {
    if (height && !settled) setSettled(true)
  }, [height, settled])
  const command = ask.tool === 'Bash'
  // The reason already shows under the title; a `description` saying the same isn't repeated.
  const inputs = Object.entries(ask.input ?? {}).filter(([key, value]) => !(key === 'description' && value === ask.reason))
  const detailKey = inputs.some(([key]) => key === 'command') ? 'command' : inputs[0]?.[0]
  const toolIcon = command ? 'terminalBox' : /edit|write/i.test(ask.tool ?? '') ? 'pencil' : /^mcp__/.test(ask.tool ?? '') ? 'layers' : 'file'
  return (
    <div style={{ position: 'absolute', right: 14, bottom: CARD_BOTTOM, width: Math.min(480, window.width - 36) }}>
      <motion.div initial={reduced ? false : { opacity: 0, top: offset.dialog }} animate={{ opacity: 1, top: 0 }} transition={enter()} style={{ position: 'relative', pointerEvents: 'none' }}>
        <div testId="approval" style={{ pointerEvents: 'auto', display: 'flex', flexDirection: 'column', gap: 16, padding: 18, backgroundColor: m.popup, borderRadius: radiusXl, borderWidth: 1, borderColor: m.borderFocused, boxShadow: elevation(m, 'card') }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <text style={{ ...type.label, fontWeight: 500, color: m.text }}>Approval</text>
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <RollingNumber testId="approval-pending" value={more + 1} style={{ ...type.label, color: m.textMuted }} />
              <text style={{ ...type.label, color: m.textMuted }}>pending</text>
            </div>
          </div>
          <motion.div initial={false} animate={{ height }} transition={settled ? tween(spring.smooth) : { duration: 0 }} style={{ position: 'relative', overflow: 'hidden', flexShrink: 0, pointerEvents: 'none' }}>
            <div onLayout={(event) => { const next = Math.ceil(event.height ?? 0); setHeight((previous) => (previous === next ? previous : next)) }} style={{ position: 'absolute', top: 0, left: 0, right: 0, pointerEvents: 'auto' }}>
              <motion.div key={ask.requestId} initial={reduced || ask.requestId === firstId.current ? false : { opacity: 0, top: offset.tooltip }} animate={{ opacity: 1, top: 0 }} transition={enter('fast')} style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Icon name={agent.id} size={14} color={brandMarks.has(agent.id) ? undefined : m.accent} />
                    <text style={{ ...type.label, fontWeight: 500, color: m.text }}>{agent.title}</text>
                    {ask.tool?.startsWith('mcp__') ? <text style={{ minWidth: 0, ...type.meta, color: m.textMuted }}>{ask.tool.split('__')[1]}</text> : null}
                    {model ? <text style={{ ...type.meta, color: m.textMuted }}>{model}</text> : null}
                    <div style={{ flexGrow: 1 }} />
                    <text style={{ ...type.meta, color: m.textMuted }}>{`${waited(ask.at, now)} waiting`}</text>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {/* The mark sits on the title's first line at its cap height, not above it. */}
                    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'start', gap: 8 }}>
                      <div style={{ height: type.titleLg.lineHeight, display: 'flex', alignItems: 'center', flexShrink: 0 }}><Icon name={toolIcon} size={14} color={m.textMuted} /></div>
                      <text style={{ flexGrow: 1, minWidth: 0, ...type.titleLg, fontWeight: 500, color: m.text }}>{ask.title}</text>
                    </div>
                    {ask.reason ? <text style={{ ...type.label, lineHeight: 18, color: m.textMuted, lineClamp: 3, paddingLeft: 22 }}>{ask.reason}</text> : null}
                  </div>
                </div>
                {preview ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {ask.detail ? <text testId="approval-path" style={{ ...type.mono, color: m.textMuted, fontFamily: font.mono }}>{ask.detail}</text> : null}
                    <Scroll testId="approval-preview" style={{ maxHeight: 240 }}>{preview}</Scroll>
                  </div>
                ) : ask.detail || inputs.length ? (
                  <Scroll testId="approval-arguments" style={{ maxHeight: Math.min(220, Math.max(100, window.height - 360)), borderRadius: concentric(radiusXl, 2), backgroundColor: m.chipBg }} padding={{ left: 14, right: 14, top: 12, bottom: 12 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {inputs.length ? inputs.map(([key, value]) => <Detail key={key} label={labelFor(key)} value={typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? String(value)} testId={key === detailKey ? 'approval-detail' : undefined} />) : <Detail label={command ? 'Command' : 'Target'} value={ask.detail} testId="approval-detail" />}
                      {workspace && command ? <Detail label="Folder" value={home(workspace)} /> : null}
                      {ask.alwaysLabel ? <Detail label="Rule" value={ask.alwaysLabel} /> : null}
                    </div>
                  </Scroll>
                ) : null}
              </motion.div>
            </div>
          </motion.div>
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
                  <div style={{ width: 20, height: 20, borderRadius: concentric(radiusBase, 4), borderWidth: 1, borderColor: m.action.pressed, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><text style={{ fontSize: 12, lineHeight: 15, color: m.action.text }}>↵</text></div>
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
      <text style={{ width: 84, flexShrink: 0, ...type.mono, fontFamily: font.sans, color: m.textMuted }}>{label}</text>
      <text testId={testId} style={{ flexGrow: 1, minWidth: 0, ...type.mono, color: m.text, fontFamily: font.mono }}>{value}</text>
    </div>
  )
}
