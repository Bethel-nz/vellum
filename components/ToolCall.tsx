// Arc's tool-call disclosure: one summary, expandable calls, inspectable inputs and outputs.
// All information comes from the agent's records. The surface has no elevation or focus grab.
import { useEffect, useState } from 'react'
import { motion } from '@gpuix/react'
import { Button as Base } from '@gpuix/react/button'
import type { ToolCall } from '../core/threads'
import { copyText } from '../core/platform'
import { concentric, font, radiusBase } from '../ui/theme'
import { Button } from './Button'
import { Dot } from './Dot'
import { Icon } from './Icon'
import { Scroll } from './Scroll'
import { enter, offset, stagger, useReducedMotion } from './motion'
import { useM } from './theme'

export function ToolCallGroup({ summary, items }: { summary: string; items: ToolCall[] }) {
  const m = useM()
  const reduced = useReducedMotion()
  const [open, setOpen] = useState(false)
  const failed = items.filter((call) => call.status === 'error').length
  return (
    <div style={{ display: 'flex', flexDirection: 'column', borderRadius: radiusBase, backgroundColor: m.panel, overflow: 'hidden' }}>
      <Base testId="tool-group-toggle" aria-label={open ? 'Hide tool activity' : 'Show tool activity'} aria-expanded={open} onClick={() => setOpen(!open)} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 34, paddingLeft: 12, paddingRight: 12, borderRadius: concentric(radiusBase, 1), hover: { backgroundColor: m.hover }, focusVisible: { outlineWidth: 2, outlineColor: m.focusRing, outlineOffset: -2 } }}>
        <text style={{ flexGrow: 1, minWidth: 0, fontSize: 12.5, lineHeight: 18, color: m.textMuted }}>{summary || `Used ${items.length} tools`}</text>
        {failed ? <text style={{ fontSize: 11.5, lineHeight: 16, color: m.danger }}>{`${failed} failed`}</text> : null}
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={12} color={m.textFaint} />
      </Base>
      {open ? items.map((call, index) => (
        <motion.div key={call.id} initial={reduced ? false : { opacity: 0, top: -offset.tooltip }} animate={{ opacity: 1, top: 0 }} transition={enter('fast', Math.min(index, stagger.maxItems - 1) * stagger.item)} style={{ position: 'relative' }}>
          <Call call={call} />
        </motion.div>
      )) : null}
    </div>
  )
}

function Call({ call }: { call: ToolCall }) {
  const m = useM()
  const reduced = useReducedMotion()
  const [open, setOpen] = useState(false)
  const elapsed = call.startedAt && call.finishedAt ? Math.max(0, Date.parse(call.finishedAt) - Date.parse(call.startedAt)) / 1000 : undefined
  const input = call.input ? Object.entries(call.input).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value, null, 2)] as const) : [['target', call.detail] as const]
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <Base testId={`tool-${call.id}`} aria-label={call.title ?? `${call.name} ${call.detail}`} aria-expanded={open} onClick={() => setOpen(!open)} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40, paddingLeft: 12, paddingRight: 12, borderRadius: concentric(radiusBase, 1), hover: { backgroundColor: m.hover }, focusVisible: { outlineWidth: 2, outlineColor: m.focusRing, outlineOffset: -2 } }}>
        <text style={{ flexGrow: 1, minWidth: 0, fontSize: 12.5, lineHeight: 18, color: m.textUi, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{call.title ?? `${call.name} ${call.detail === call.name ? '' : call.detail}`.trim()}</text>
        {elapsed !== undefined && Number.isFinite(elapsed) ? <text style={{ fontSize: 11.5, lineHeight: 16, color: m.textFaint, fontFamily: font.mono }}>{`${elapsed.toFixed(1)}s`}</text> : null}
        {call.status === 'running' ? <Dot color={m.accent} size={6} pulse /> : <Icon name={call.status === 'error' ? 'info' : 'check'} size={13} color={call.status === 'error' ? m.danger : m.success} />}
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={12} color={m.textFaint} />
      </Base>
      {open ? (
        <motion.div initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={enter('fast')} style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingLeft: 12, paddingRight: 12, paddingBottom: 14 }}>
          <ToolDetail title="Input" text={JSON.stringify(call.input ?? { target: call.detail }, null, 2)}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {input.map(([key, value]) => (
                <div key={key} style={{ display: 'flex', flexDirection: 'row', gap: 12 }}>
                  <text style={{ width: 72, flexShrink: 0, fontSize: 11.5, lineHeight: 18, color: m.textMuted, fontFamily: font.mono }}>{key}</text>
                  <text style={{ flexGrow: 1, minWidth: 0, fontSize: 12, lineHeight: 18, color: m.textUi, fontFamily: font.mono }}>{value ?? 'null'}</text>
                </div>
              ))}
            </div>
          </ToolDetail>
          <ToolDetail title="Output" text={call.output ?? call.error}>
            <text testId={`tool-output-${call.id}`} style={{ fontSize: 12, lineHeight: 18, color: call.status === 'error' ? m.danger : m.textUi, fontFamily: font.mono }}>{call.output ?? call.error ?? (call.status === 'running' ? 'Waiting for a result…' : 'No output recorded')}</text>
          </ToolDetail>
        </motion.div>
      ) : call.error ? <text style={{ paddingLeft: 12, paddingRight: 12, paddingBottom: 10, fontSize: 12, lineHeight: 17, color: m.danger, lineClamp: 2 }}>{call.error}</text> : null}
    </div>
  )
}

export function ToolDetail({ title, text, children }: { title: string; text?: string; children: React.ReactNode }) {
  const m = useM()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <text style={{ fontSize: 11.5, lineHeight: 16, color: m.textMuted }}>{title}</text>
        {text ? <Button title={`Copy ${title.toLowerCase()}`} onPress={() => { if (copyText(text)) setCopied(true) }} style={{ width: 22, height: 20, minHeight: 20, paddingLeft: 0, paddingRight: 0 }}><Icon name={copied ? 'check' : 'copy'} size={12} color={copied ? m.success : m.textFaint} /></Button> : null}
      </div>
      <Scroll style={{ maxHeight: 220, borderRadius: radiusBase, backgroundColor: m.codeBg }} padding={{ left: 12, right: 12, top: 10, bottom: 10 }}>{children}</Scroll>
    </div>
  )
}
