// A lead-and-branches view of delegation, backed by recorded calls and results.
// A completed background launch means "Started", not that the agent finished its work.
import { useState } from 'react'
import { motion } from './spring'
import { Button as Base } from '@gpuix/react/button'
import type { ToolCall } from '../core/threads'
import { modelName } from '../core/models'
import { font, radiusXl, type } from '../ui/theme'
import { Icon } from './Icon'
import { ToolDetail } from './ToolCall'
import { enter, useReducedMotion } from './motion'
import { useM } from './theme'

export const isSubagentCall = (call: ToolCall) => /^(Agent|Task)$/i.test(call.name)
type State = ToolCall['status'] | 'started'
const taskState = (call: ToolCall): State => call.status === 'ok' && call.input?.run_in_background === true ? 'started' : call.status
const labels: Record<State, string> = { running: 'Thinking', ok: 'Returned', error: 'Failed', started: 'Started in background' }
const textInput = (call: ToolCall, key: string) => typeof call.input?.[key] === 'string' ? call.input[key] as string : undefined
const taskTitle = (call: ToolCall) => textInput(call, 'description') || call.title || call.detail
const elapsed = (call: ToolCall) => {
  if (!call.startedAt || !call.finishedAt) return
  const seconds = (Date.parse(call.finishedAt) - Date.parse(call.startedAt)) / 1000
  if (!Number.isFinite(seconds) || seconds < 0) return
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`
  const rounded = Math.round(seconds)
  return `${Math.floor(rounded / 60)}m ${rounded % 60}s`
}

export function SubagentTasks({ items }: { items: ToolCall[] }) {
  const m = useM()
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const count = (state: State) => items.filter((call) => taskState(call) === state).length
  const working = count('running')
  const started = count('started')
  const returned = count('ok')
  const failed = count('error')
  const branchColor = (index: number) => m.accents[(index + 1) % m.accents.length] ?? m.accent
  const toggle = (id: string) => setOpen((current) => ({ ...current, [id]: !current[id] }))
  return <div testId="subagent-tasks" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 28 }}>
      <Icon name="claude" size={17} color="#d97757" />
      <text style={{ ...type.title, fontWeight: 600, color: m.textUi }}>Claude</text>
      <text style={{ ...type.title, color: m.textMuted }}>Lead</text>
      <div style={{ flexGrow: 1 }} />
      <text testId="subagent-working" style={{ ...type.meta, color: m.textMuted }}>{working ? `${working} thinking` : started ? `${started} started` : 'Delegation finished'}</text>
    </div>
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 12, paddingLeft: 28 }}>
      <div style={{ position: 'absolute', left: 8, top: 0, bottom: 0, width: 1, backgroundColor: m.borderFocused, pointerEvents: 'none' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingBottom: 4 }}>
        {items.map((call, index) => <Base key={call.id} testId={`subagent-assignment-${call.id}`} aria-label={`Show ${taskTitle(call)}`} onClick={() => setOpen((current) => ({ ...current, [call.id]: true }))} style={{ display: 'flex', flexDirection: 'row', alignItems: 'start', gap: 10, minHeight: 24, paddingTop: 3, paddingBottom: 3, borderRadius: 4, hover: { backgroundColor: m.hover }, focusVisible: { outlineWidth: 2, outlineColor: m.focusRing, outlineOffset: 1 } }}>
          <div style={{ width: 5, height: 5, borderRadius: 3, marginTop: 6, flexShrink: 0, backgroundColor: branchColor(index) }} />
          <text style={{ ...type.meta, color: m.textMuted }}>{taskTitle(call)}</text>
        </Base>)}
      </div>
      {items.map((call, index) => <AgentBranch key={call.id} call={call} color={branchColor(index)} open={Boolean(open[call.id])} onToggle={() => toggle(call.id)} />)}
    </div>
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 28, paddingTop: 2 }}>
      <text testId="subagent-returned" style={{ ...type.meta, color: m.textMuted }}>{`${returned} of ${items.length} returned${failed ? ` · ${failed} failed` : ''}${started ? ` · ${started} started in background` : ''}`}</text>
    </div>
  </div>
}

function AgentBranch({ call, color, open, onToggle }: { call: ToolCall; color: string; open: boolean; onToggle: () => void }) {
  const m = useM()
  const reduced = useReducedMotion()
  const title = taskTitle(call)
  const model = textInput(call, 'model')
  const claude = Boolean(model && /^(claude-|opus|sonnet|haiku)/i.test(model))
  const family = model && /^(opus|sonnet|haiku)$/i.test(model) ? model[0]?.toUpperCase() + model.slice(1) : model ? modelName(model) : undefined
  const role = textInput(call, 'subagent_type')
  const identity = family ? `${claude ? 'Claude ' : ''}${family}` : role ?? 'Subagent'
  const state = taskState(call)
  const duration = elapsed(call)
  const prompt = textInput(call, 'prompt')
  const result = call.output ?? call.error
  const preview = result && !result.trim().startsWith('{') ? result.trim().replace(/\s+/g, ' ') : undefined
  const status = call.error === 'Stopped' ? 'Stopped' : labels[state]
  const statusColor = state === 'error' ? m.danger : state === 'ok' ? m.success : m.textMuted
  return <div style={{ position: 'relative' }}>
    <div style={{ position: 'absolute', left: -20, top: 23, width: 20, height: 1, backgroundColor: color, pointerEvents: 'none' }} />
    <div style={{ position: 'absolute', left: -24, top: 19, width: 8, height: 8, borderRadius: 4, backgroundColor: color, pointerEvents: 'none' }} />
    <div style={{ display: 'flex', flexDirection: 'column', borderRadius: radiusXl, borderWidth: 1, borderColor: m.border, backgroundColor: m.panel, overflow: 'hidden' }}>
      <Base testId={`subagent-${call.id}`} aria-label={`${title}. ${status}`} aria-expanded={open} onClick={onToggle} style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: 14, borderRadius: radiusXl, hover: { backgroundColor: m.hover }, focusVisible: { outlineWidth: 2, outlineColor: m.focusRing, outlineOffset: -2 } }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {claude ? <Icon name="claude" size={15} color="#d97757" /> : null}
          <text style={{ ...type.meta, color: m.textMuted, flexGrow: 1, minWidth: 0 }}>{identity}</text>
          {duration ? <text style={{ ...type.meta, color: m.textMuted }}>{duration}</text> : null}
        </div>
        <text style={{ ...type.title, color: m.textUi, fontWeight: 500 }}>{title}</text>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          {state === 'ok' || state === 'error' ? <Icon name={state === 'ok' ? 'check' : 'circleX'} size={13} color={statusColor} /> : null}
          <text testId={`subagent-status-${call.id}`} style={{ ...type.meta, color: statusColor }}>{status}</text>
        </div>
        {preview && !open ? <text style={{ fontSize: 12, lineHeight: 18, color: state === 'error' ? m.danger : m.textMuted, lineClamp: 2 }}>{preview}</text> : null}
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <text style={{ ...type.meta, color: m.textFaint, flexGrow: 1 }}>{family && role ? role : ''}</text>
          <Icon name={open ? 'chevronUp' : 'chevronDown'} size={12} color={m.textFaint} />
        </div>
      </Base>
      {open ? <div style={{ position: 'relative', paddingLeft: 14, paddingRight: 14, paddingBottom: 14 }}>
        <motion.div initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={enter('fast')} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: m.panel, pointerEvents: 'none' }} />
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {prompt ? <ToolDetail title="Assignment" text={prompt}><text style={{ ...type.mono, color: m.textUi }}>{prompt}</text></ToolDetail> : null}
          <ToolDetail title="Result" text={result}><text testId={`subagent-result-${call.id}`} style={{ ...type.mono, fontFamily: font.mono, color: state === 'error' ? m.danger : m.textUi }}>{result || (state === 'running' ? 'Waiting for a result…' : state === 'started' ? 'Started in the background.' : 'No result recorded')}</text></ToolDetail>
        </div>
      </div> : null}
    </div>
  </div>
}
