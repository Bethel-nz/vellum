// Quiet tool activity: summary → calls → inputs and results, for every agent.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useIsPresent } from '@gpuix/react'
import { Button as Base } from '@gpuix/react/button'
import { displayInput, displayResult, displayTitle, envelope, record, resultSummary, valueText, compactText, wrappedTool, displayCalls } from '../core/tool-display'
import { ToolOutput } from './ToolOutput'
import { ToolValue } from './ToolValue'
import { McpMark } from '../ui/McpMark'
import type { ToolCall } from '../core/threads'
import { copyText } from '../core/platform'
import { printedFile } from '../core/printed'
import { concentric, nativeTheme, noteCard, radiusBase, radiusXl } from '../ui/theme'
import type { IconName } from '../ui/icons'
import { AnimatePresence, motion } from './spring'
import { Button } from './Button'
import { Dot } from './Dot'
import { Icon } from './Icon'
import { Scroll } from './Scroll'
import { spring, tween, useReducedMotion } from './motion'
import { useM } from './theme'

const compact = compactText
const mobileTool = (call: ToolCall) => `${call.name} ${call.title ?? ''} ${typeof call.input?.code === 'string' ? call.input.code : ''}`.match(/\b(?:vellum_)?mobile_(snapshot|tap|steps|apps|configure|notify|reset|connection|input|inspect)\b/)?.[1]


function mark(call: ToolCall): IconName {
  const name = `${call.name} ${call.title ?? ''}`.toLowerCase()
  if (wrappedTool(call)?.discovery) return 'search'
  if (mobileTool(call) || /mobile|simulator|simdriver/.test(name)) return 'phone'
  if (/bash|shell|execute|command/.test(name)) return 'terminalBox'
  if (/search|grep|glob/.test(name)) return 'search'
  if (/edit|write|patch/.test(name)) return 'pencil'
  if (/read|file/.test(name)) return 'file'
  if (/web|fetch|browser/.test(name)) return 'link'
  return 'layers'
}

function title(call: ToolCall) {
  return displayTitle(call)
}

function elapsed(call: ToolCall) {
  if (!call.startedAt || !call.finishedAt) return
  const ms = Date.parse(call.finishedAt) - Date.parse(call.startedAt)
  if (!Number.isFinite(ms) || ms < 0) return
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.floor(ms % 60_000 / 1000)}s`
}

/**
 * Opens and closes on the same height spring. Once it lands the height lets go, so nested
 * disclosures grow the list naturally; a held height spring would lag behind them and clip.
 */
function FlowReveal({ children, testId }: { children: ReactNode; testId?: string }) {
  const reduced = useReducedMotion()
  const present = useIsPresent()
  const [height, setHeight] = useState(0)
  const [landed, setLanded] = useState(reduced)
  return <motion.div initial={reduced ? false : { height: 0, opacity: 0 }} animate={landed ? { opacity: 1 } : { height, opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={tween(spring.smooth)} onMotionComplete={() => { if (height) setLanded(true) }} style={{ overflow: 'hidden', flexShrink: 0, pointerEvents: 'none' }}>
    <div testId={testId} onLayout={(event) => { const next = Math.ceil(event.height ?? 0); setHeight((previous) => previous === next ? previous : next) }} style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, pointerEvents: present ? 'auto' : 'none' }}>{children}</div>
  </motion.div>
}

/** Measured native height, animated by Vellum's spring, with no focus change. */
function Reveal({ children, testId, flow = false }: { children: ReactNode; testId?: string; flow?: boolean }) {
  const reduced = useReducedMotion()
  const present = useIsPresent()
  const [height, setHeight] = useState(0)
  // The outer list must follow its nested disclosures naturally; a second height spring
  // would lag behind their growth and clip the result while they open.
  if (flow) return <FlowReveal testId={testId}>{children}</FlowReveal>
  return <motion.div initial={reduced ? false : { height: 0, opacity: 0 }} animate={{ height, opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={tween(spring.smooth)} style={{ position: 'relative', overflow: 'hidden', flexShrink: 0, pointerEvents: 'none' }}>
    <div testId={testId} onLayout={(event) => { const next = Math.ceil(event.height ?? 0); setHeight((previous) => previous === next ? previous : next) }} style={{ position: 'absolute', top: 0, left: 0, right: 0, display: 'flex', flexDirection: 'column', pointerEvents: present ? 'auto' : 'none' }}>{children}</div>
  </motion.div>
}

export function ToolCallGroup({ summary, items: rawItems, thinking, testId = 'tool-group', onInspect }: { summary: string; items: ToolCall[]; thinking?: string; testId?: string; onInspect?: () => void }) {
  const m = useM()
  const [open, setOpen] = useState(false)
  const [hot, setHot] = useState(false)
  const items = useMemo(() => displayCalls(rawItems), [rawItems])
  const failed = items.filter((call) => call.status === 'error').length
  const running = items.filter((call) => call.status === 'running').length
  const marks = [...new Set(items.map(mark))].slice(0, 3)
  const label = items.length ? `${running ? 'Using' : 'Used'} ${items.length} ${items.length === 1 ? 'tool' : 'tools'}` : summary || 'Thinking'
  // A pure-thinking group has nothing behind a dropdown, so it renders as a static
  // status row: same marks and label, no chevron, no toggle.
  const expandable = items.length > 0
  // Collapsed it is one quiet row in the note's rhythm; the framed surface is only for the details.
  // 1px of padding stands where the frame's border draws, so the row stays put and nothing
  // overflows the clip (an overflow there scrolls). The row keeps one shape
  // open or closed, so no corner changes while the details grow or shrink.
  return <div testId={testId} style={{ position: 'relative', display: 'flex', flexDirection: 'column', borderRadius: radiusXl, padding: 1, overflow: 'hidden', minWidth: 0 }}>
    {/* The frame fades with the details it holds, on their spring, so closing reads as one fade, not a pop at the end. */}
    <motion.div initial={false} animate={{ opacity: open ? 1 : 0 }} transition={tween(spring.smooth)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, ...noteCard(m), pointerEvents: 'none' }} />
    {expandable ? (
    <Base testId="tool-group-toggle" aria-label={`${open ? 'Hide' : 'Show'} tool activity`} aria-expanded={open} onClick={() => { if (!open) onInspect?.(); setOpen((value) => !value) }} onMouseEnter={() => setHot(true)} onMouseLeave={() => setHot(false)} style={{ position: 'relative', display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: concentric(radiusXl, 1), minHeight: 28, paddingLeft: 9, paddingRight: 9, focusVisible: { outlineWidth: 2, outlineColor: m.focusRing, outlineOffset: -2 } }}>
      {/* Open, the wash is a row like the ones below it: inset 4px, with their smaller corners. */}
      <motion.div initial={false} animate={{ top: open ? 4 : 0, left: open ? 4 : 0, right: open ? 4 : 0, bottom: open ? 2 : 0, borderRadius: open ? concentric(radiusXl, 5) : concentric(radiusXl, 1) }} transition={tween(spring.smooth)} style={{ position: 'absolute', backgroundColor: hot ? m.hover : '#00000000', pointerEvents: 'none' }} />
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        {(marks.length ? marks : ['bulb' as const]).map((name) => <Icon key={name} name={name} size={14} color={m.textMuted} />)}
      </div>
      <text style={{ flexGrow: 1, minWidth: 0, fontSize: 12.5, lineHeight: 18, color: m.textMuted }}>{label}</text>
      {running ? <Dot color={m.accent} size={5} pulse /> : null}
      {failed ? <text style={{ fontSize: 11.5, lineHeight: 16, color: m.danger }}>{`${failed} failed`}</text> : null}
      <Icon name={open ? 'chevronUp' : 'chevronDown'} size={13} color={m.textMuted} />
    </Base>
    ) : (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 28, paddingLeft: 9, paddingRight: 9 }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        {(marks.length ? marks : ['bulb' as const]).map((name) => <Icon key={name} name={name} size={14} color={m.textMuted} />)}
      </div>
      <text style={{ flexGrow: 1, minWidth: 0, fontSize: 12.5, lineHeight: 18, color: m.textMuted }}>{label}</text>
    </div>
    )}
    {expandable ? <AnimatePresence initial={false}>{open ? <Reveal key="calls" testId={`${testId}-calls`} flow>
      <div style={{ display: 'flex', flexDirection: 'column', borderTopWidth: 1, borderColor: m.border, padding: 4 }}>
        {thinking ? <Thinking /> : null}
        {items.map((call) => <Call key={call.id} call={call} />)}
      </div>
    </Reveal> : null}</AnimatePresence> : null}
  </div>
}

// A status line, not a toggle: thought text stays out of the note (see showThoughts
// in blocks.tsx), so there is nothing behind a dropdown to justify one.
function Thinking() {
  const m = useM()
  return <div testId="tool-thinking" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36, paddingLeft: 8, paddingRight: 8 }}>
    <Icon name="bulb" size={15} color={m.textMuted} /><text style={{ flexGrow: 1, fontSize: 12.5, color: m.textMuted }}>Thinking</text>
  </div>
}

function Call({ call }: { call: ToolCall }) {
  const m = useM()
  const [open, setOpen] = useState(false)
  const duration = elapsed(call)
  const input = displayInput(call)
  const inputText = valueText(input)
  const runner: { code?: string; output?: string } | undefined = useMemo(() => call.runner ?? wrappedTool(call), [call.runner, call.arguments, call.input])
  const [showCode, setShowCode] = useState(false)
  const error = call.error || (call.status === 'error' ? call.output : undefined)
  return <div testId={`tool-row-${call.id}`} style={{ display: 'flex', flexDirection: 'column' }}>
    <Base testId={`tool-${call.id}`} aria-label={title(call)} aria-expanded={open} onClick={() => setOpen((value) => !value)} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40, paddingLeft: 8, paddingRight: 8, borderRadius: concentric(radiusXl, 5), hover: { backgroundColor: m.hover }, focusVisible: { outlineWidth: 2, outlineColor: m.focusRing, outlineOffset: -2 } }}>
      {call.definition?.source ? <McpMark name={call.definition.source.name} url={call.definition.source.url} size={15} /> : <Icon name={mark(call)} size={15} color={m.textMuted} />}
      <text style={{ flexGrow: 1, minWidth: 0, fontSize: 12.5, lineHeight: 18, color: m.textUi, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{title(call)}</text>
      <text style={{ flexShrink: 0, fontSize: 11, lineHeight: 16, color: m.textMuted }}>{[resultSummary(call), duration].filter(Boolean).join(' · ')}</text>
      {call.status === 'running' ? <Dot color={m.accent} size={6} pulse /> : <Icon name={call.status === 'error' ? 'circleX' : 'check'} size={14} color={call.status === 'error' ? m.danger : m.success} />}
      <Icon name={open ? 'chevronUp' : 'chevronDown'} size={12} color={m.textMuted} />
    </Base>
    {!open && error ? <text style={{ paddingLeft: 33, paddingRight: 34, paddingBottom: 9, fontSize: 12, lineHeight: 17, color: m.textMuted, lineClamp: 2 }}>{compact(error)}</text> : null}
    <AnimatePresence initial={false}>{open ? <Reveal key="details" testId={`tool-details-${call.id}`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingLeft: 33, paddingRight: 8, paddingTop: 4, paddingBottom: 16 }}>
        {record(input) && !Object.keys(input).length ? null : <ToolDetail title="Input" text={inputText} testId={`tool-input-scroll-${call.id}`}>
          <ToolValue testId={`tool-input-${call.id}`} value={input} schema={call.definition?.inputSchema} />
        </ToolDetail>}
        {runner ? <>
          <Button testId={`tool-source-${call.id}`} onPress={() => setShowCode(value => !value)} style={{ alignSelf: 'start', paddingLeft: 0 }}><Icon name={showCode ? 'chevronUp' : 'terminalBox'} size={12} /><text style={{ fontSize: 11.5, color: m.textMuted }}>{showCode ? 'Hide code' : 'View code'}</text></Button>
          {showCode ? <>
            <ToolDetail title="Code" text={runner.code} testId={`tool-source-code-${call.id}`}><code code={runner.code || ''} language="typescript" theme={nativeTheme(m)} /></ToolDetail>
            {runner.output ? <ToolDetail title="Runner output" text={runner.output} testId={`tool-runner-output-${call.id}`} virtual><ToolOutput value={runner.output} testId={`tool-runner-output-${call.id}`} /></ToolDetail> : null}
          </> : null}
        </> : null}
        <Result call={call} />
      </div>
    </Reveal> : null}</AnimatePresence>
  </div>
}

function Result({ call }: { call: ToolCall }) {
  const m = useM()
  const [rawView, setRawView] = useState(false)
  const output = useMemo(() => displayResult(call), [call.output, call.result, call.error])
  const wrapped = envelope(output.value), value = wrapped ? wrapped.value : output.value
  const structured = record(value) || Array.isArray(value) || typeof value === 'number' || typeof value === 'boolean' || value === null
  const command = call.input?.command
  const file = typeof command === 'string' ? printedFile(command) : undefined
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
    <ToolDetail title="Output" text={output.raw} testId={`tool-output-scroll-${call.id}`} virtual>
      <div testId={`tool-output-${call.id}`} style={{ display: 'flex', flexDirection: 'column' }}>
        <ToolOutput testId={`tool-output-scroll-${call.id}`} value={rawView ? output.raw ?? '' : value === undefined && call.status === 'running' ? 'Waiting for a result…' : value} raw={rawView} schema={call.definition?.outputSchema} title={!rawView ? wrapped?.title ?? output.caption : undefined} path={!rawView ? file : undefined} extra={!rawView ? output.extra : undefined} attachments={!rawView ? output.attachments : undefined} />
      </div>
    </ToolDetail>
    {structured || output.attachments.length ? <Button testId={`tool-output-raw-${call.id}`} onPress={() => setRawView(value => !value)} style={{ alignSelf: 'start', paddingLeft: 0 }}><text style={{ fontSize: 11.5, color: m.textMuted }}>{rawView ? 'Formatted view' : 'View raw output'}</text></Button> : null}
  </div>
}

export function ToolDetail({ title, text, children, testId, virtual = false }: { title: string; text?: string; children?: ReactNode; testId?: string; virtual?: boolean }) {
  const m = useM()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <text style={{ fontSize: 11.5, lineHeight: 16, color: m.textMuted }}>{title}</text>
      {text ? <Button testId={testId ? `${testId}-copy` : undefined} title={`Copy ${title.toLowerCase()}`} onPress={() => { if (copyText(text)) setCopied(true) }} style={{ width: 24, height: 20, minHeight: 20, paddingLeft: 0, paddingRight: 0 }}><Icon name={copied ? 'check' : 'copy'} size={13} color={copied ? m.success : m.textMuted} /></Button> : null}
    </div>
    {virtual ? <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, borderRadius: radiusBase, backgroundColor: m.codeBg, overflow: 'hidden' }}>{children}</div> : <Scroll testId={testId} style={{ maxHeight: 260, borderRadius: radiusBase, backgroundColor: m.codeBg }} padding={{ left: 12, right: 12, top: 10, bottom: 10 }}>{children}</Scroll>}
  </div>
}
