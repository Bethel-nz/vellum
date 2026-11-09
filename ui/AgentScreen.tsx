import { useEffect, useMemo, useRef, useState } from 'react'
import { useGpuixRequired, useWindowSize, type ImgInstance, type KeyEvent, type PublicInstance } from '@gpuix/react'
import { Alert, Button, Dot, Icon, Label } from '../components'
import { useAgent } from '../components/AgentContext'
import type { BrowserSession } from '../core/capture'
import type { BrowserKey, BrowserPlacement } from '../core/browser-types'
import { browserPoint, type BrowserFrame } from '../core/browser-stream'
import { browserKeyboardKey } from '../core/browser-input'
import type { StreamMouseInput } from '../core/stream-protocol'
import { heldBrowserButton, lastBrowserFrame, releaseBrowserInput, sendBrowserInput, setBrowserDemand, watchBrowser, type BrowserViewState } from '../core/browser-view'
import { browserCommand, releaseBrowserControl, requestBrowserControl, validateBrowser } from '../core/browser-runtime'
import { appIsActive } from '../core/dock'
import { isMac } from '../core/platform'
import { useM } from './kit'
import { concentric, elevation, font, radiusBase, radiusXl } from './theme'

const clock = (total: number) => `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`

/** The recording badge: a pulsing red dot and the elapsed time, mm:ss. */
function Rec({ startedAt, recording }: { startedAt?: number; recording: boolean }) {
  const m = useM()
  const base = useRef(0)
  if (recording) base.current = Math.max(base.current, startedAt ? Math.floor((Date.now() - startedAt) / 1000) : base.current)
  else base.current = 0
  const [secs, setSecs] = useState(base.current)
  useEffect(() => { setSecs(base.current); if (!recording) return; const timer = setInterval(() => setSecs(base.current + Math.floor((Date.now() - (startedAt ?? Date.now() - base.current * 1000)) / 1000)), 500); return () => clearInterval(timer) }, [recording, startedAt])
  if (!recording) return null
  return <div testId="browser-rec" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 8, paddingRight: 9, height: 21, borderRadius: 11, backgroundColor: `${m.danger}1f`, borderWidth: 1, borderColor: m.danger }}>
    <Dot color={m.danger} size={6} pulse />
    <text style={{ fontSize: 10.5, lineHeight: 14, fontFamily: font.mono, color: m.danger }}>{clock(secs)}</text>
  </div>
}

export function AgentScreen({ session, placement, width: givenWidth, quiet, onExpand, onMinimize, onReturnInline, onTakeControl, onDrivingChange, onDrag }: {
  session: BrowserSession; placement: BrowserPlacement; width?: number; quiet?: boolean; onExpand: () => void; onMinimize?: () => void; onReturnInline?: () => void;
  onTakeControl?: () => void; onDrivingChange?: (driving: boolean) => void; onDrag?: (event: { x?: number; y?: number; button?: number }) => void
}) {
  const m = useM(), renderer = useGpuixRequired(), window = useWindowSize(), agent = useAgent()
  const expanded = placement === 'expanded', floating = placement === 'floating', card = placement === 'inline'
  const key = useMemo(() => session.generation ? { noteId: session.noteId, session: session.session, generation: session.generation } : undefined, [session.noteId, session.session, session.generation])
  const current = key && validateBrowser(key)
  const streaming = Boolean(current)
  const frameRef = useRef<ImgInstance>(null), input = useRef<PublicInstance>(null)
  const dimensions = useRef<BrowserFrame | undefined>(key ? lastBrowserFrame(key) : undefined)
  const [size, setSize] = useState({ width: dimensions.current?.width ?? 1280, height: dimensions.current?.height ?? 800 })
  const [hasFrame, setHasFrame] = useState(Boolean(dimensions.current))
  const [view, setView] = useState<BrowserViewState>({ status: 'connecting' })
  const [details, setDetails] = useState(false), [control, setControl] = useState<'watch' | 'pending' | 'driving'>('watch'), [error, setError] = useState(''), [hovered, setHovered] = useState(false)
  const controlRef = useRef(control), mounted = useRef(true), loggedDeleteKey = useRef(false)
  controlRef.current = control
  const handBack = () => {
    if (key) releaseBrowserInput(key)
    void releaseBrowserControl(session.noteId)
    controlRef.current = 'watch'; setControl('watch'); onDrivingChange?.(false)
  }
  const leaveRef = useRef(handBack); leaveRef.current = handBack
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (controlRef.current !== 'watch') leaveRef.current() } }, [])
  useEffect(() => {
    if (!key || !streaming || quiet) return
    const unwatch = watchBrowser(key, {
      frame: frame => {
        if (!frameRef.current) return false
        frameRef.current.setImage(frame.data)
        dimensions.current = frame
        setHasFrame(true)
        setSize(old => old.width === frame.width && old.height === frame.height ? old : { width: frame.width, height: frame.height })
        return true
      },
      state: state => { setView(state); if (state.status === 'disconnected' && controlRef.current === 'driving') leaveRef.current() },
    })
    const demand = () => { const focused = appIsActive(); if (!focused && controlRef.current !== 'watch') leaveRef.current(); setBrowserDemand(key, { placement, visible: true, focused }) }
    demand(); const timer = setInterval(demand, 1000)
    return () => { clearInterval(timer); unwatch() }
  }, [key, streaming, placement, quiet])
  const takeControl = async () => {
    if (control === 'driving') { handBack(); return }
    setError(''); controlRef.current = 'pending'; setControl('pending'); onDrivingChange?.(true); onTakeControl?.()
    try {
      await requestBrowserControl(session.noteId)
      if (!mounted.current || (controlRef.current as string) === 'watch') { await releaseBrowserControl(session.noteId); return }
      setControl('driving'); if (input.current) renderer.focusElement?.(input.current.id)
    } catch (e) { if (mounted.current) { setError(String((e as Error).message)); handBack() } }
  }
  const toggleRecording = () => {
    const recording = session.recording
    setError('')
    void browserCommand(session.noteId, { args: ['record', recording ? 'stop' : 'start'], title: recording ? 'Stop recording' : 'Record a task' }, { signal: new AbortController().signal }).catch(e => setError(String((e as Error).message)))
  }
  const width = givenWidth ?? (expanded ? Math.max(120, Math.min(window.width - 80, (window.height - 180) * size.width / size.height)) : Math.max(120, Math.min(560, window.width - 112)))
  // The inline card is one defined box (16:10): captures letterbox into it exactly
  // like the empty state, so the card never changes shape per capture.
  const height = card ? Math.min(380, Math.round(width * 10 / 16)) : Math.min(expanded ? window.height - 180 : floating ? 260 : 380, width * size.height / size.width)
  // The screen rounds only where it is the card's whole content (concentric with the
  // card's border); inside the floating/expanded window it is a flush panel between
  // the chrome bars, and the window's own corners carry the rounding.
  const screenRadius = card ? concentric(radiusBase, 1) : 0
  const mouse = (event: { x?: number; y?: number; button?: number; clickCount?: number; deltaX?: number; deltaY?: number }, eventType: StreamMouseInput['eventType']) => {
    if (!key || controlRef.current !== 'driving' || !frameRef.current || !dimensions.current || event.x === undefined || event.y === undefined) return
    const bounds = renderer.getElementBounds?.(frameRef.current.id)
    const point = bounds && browserPoint({ x: event.x, y: event.y }, bounds, dimensions.current)
    if (!point) return
    if (eventType === 'mousePressed' || eventType === 'mouseReleased') sendBrowserInput(key, { type: 'input_mouse', eventType, ...point, button: event.button === 2 ? 'right' : event.button === 1 ? 'middle' : 'left', clickCount: event.clickCount || 1 })
    else if (eventType === 'mouseMoved') sendBrowserInput(key, { type: 'input_mouse', eventType, ...point, button: heldBrowserButton(key) })
    else if (eventType === 'mouseWheel') sendBrowserInput(key, { type: 'input_mouse', eventType, ...point, deltaX: -(event.deltaX || 0), deltaY: -(event.deltaY || 0) })
  }
  const keyboard = (event: KeyEvent, eventType: 'keyDown' | 'keyUp') => {
    if (!key || controlRef.current !== 'driving') return
    event.preventDefault(); event.stopPropagation()
    if (event.key?.toLowerCase() === 'escape') { if (eventType === 'keyDown') handBack(); return }
    if (process.platform === 'darwin' && ['backspace', 'delete'].includes(event.key ?? '') && !loggedDeleteKey.current) { loggedDeleteKey.current = true; console.info('[browser] GPUIX delete key:', event.key) }
    const value = browserKeyboardKey(event.key || '', event.keyChar), mods = event.modifiers
    sendBrowserInput(key, { type: 'input_keyboard', eventType, ...value, modifiers: (mods?.alt ? 1 : 0) | (mods?.ctrl ? 2 : 0) | (mods?.cmd ? 4 : 0) | (mods?.shift ? 8 : 0) })
    const text = event.keyChar || value.key
    if (eventType === 'keyDown' && text.length === 1 && text.charCodeAt(0) >= 32 && text.charCodeAt(0) !== 127 && !mods?.ctrl && !mods?.cmd) sendBrowserInput(key, { type: 'input_keyboard', eventType: 'char', text })
  }
  const state = current?.phase ?? session.phase
  const connecting = streaming && !quiet && view.status === 'connecting' && !dimensions.current && !session.screenshot
  const status = !streaming ? 'Last capture' : state === 'error' ? 'Needs attention' : control === 'pending' ? 'Waiting for command…' : control === 'driving' ? 'You’re driving' : view.status === 'disconnected' ? 'Reconnecting…' : view.status === 'live' ? '' : 'Connecting…'
  let origin = session.url ?? ''
  try { const url = new URL(view.url || session.url || ''); origin = url.hostname || url.href } catch {}
  const screen = <div ref={input} testId="browser-input" tabIndex={control === 'driving' ? 0 : undefined} onKeyDown={event => keyboard(event, 'keyDown')} onKeyUp={event => keyboard(event, 'keyUp')} onBlur={() => { if (key) releaseBrowserInput(key) }} onMouseDown={event => mouse(event, 'mousePressed')} onMouseUp={event => mouse(event, 'mouseReleased')} onMouseMove={event => mouse(event, 'mouseMoved')} onScroll={control === 'driving' ? event => mouse(event, 'mouseWheel') : undefined} style={{ position: 'relative', width, height, borderRadius: screenRadius, backgroundColor: m.chipBg, keyboardFocusDim: false }}>
    {session.screenshot || streaming ? (
      <img ref={frameRef} aria-label="Browser viewport" testId="browser-frame" src={session.screenshot} objectFit="contain" style={{ width: '100%', height: '100%', borderRadius: screenRadius, pointerEvents: 'none' }} />
    ) : (
      <div testId="browser-empty" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="browser" size={28} color={m.textFaint} />
      </div>
    )}
    {connecting ? <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: m.rootTint }}>
      <Dot color={m.textUi} size={8} pulse />
      <text style={{ fontSize: 12, color: m.textMuted }}>{`Connecting to ${agent.title}’s screen`}</text>
    </div> : streaming && !hasFrame && !session.screenshot ? (
      // The frame waits mounted for its first image; until one comes, the empty state covers it.
      <div testId="browser-empty" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: m.chipBg, borderRadius: screenRadius }}>
        <Icon name="browser" size={28} color={m.textFaint} />
      </div>
    ) : null}
  </div>

  // The resting card in the note: the framed viewport itself, an instant hover wash with
  // one revealed action. No caption: the frame is the content; status lives in the
  // floating frame and the expanded viewer. The one exception is failure: an error
  // throws an alert block under the frame, with the same retry as the viewer.
  if (card) return <div testId="agent-screen-inline" style={{ width, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
    <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} style={{ position: 'relative', width, height, borderRadius: radiusBase, overflow: 'hidden', borderWidth: 1, borderColor: m.border, backgroundColor: m.chipBg, boxShadow: elevation(m, 'card') }}>
      {screen}
      {/* Double-click (not while driving: that belongs to the page) floats the card. */}
      <div onMouseDown={(event) => { if ((event.clickCount ?? 1) >= 2 && control !== 'driving') onExpand() }} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: screenRadius, backgroundColor: '#00000000', hover: { backgroundColor: `${m.scrim.slice(0, 7)}2e` } }}>
        <div style={{ display: 'flex', opacity: hovered ? 1 : 0, hover: { opacity: 1 } }}>
          <Button testId="browser-open" variant="solid" onPress={onExpand} style={{ height: 26, borderRadius: 13, paddingLeft: 12, paddingRight: 13 }}><Label variant="solid">Open</Label></Button>
        </div>
      </div>
      {session.recording ? <div style={{ position: 'absolute', top: 8, right: 8 }}><Rec startedAt={session.recordStartedAt} recording /></div> : null}
    </div>
    {state === 'error' ? (
      <Alert
        inNote
        tone="danger"
        title="Browser needs attention"
        testId="browser-error"
        action={<Button testId="browser-error-retry" onPress={() => { setError(''); void browserCommand(session.noteId, { args: ['snapshot', '-i'] }, { signal: new AbortController().signal }).catch(e => setError(String((e as Error).message))) }}><Label>Retry</Label></Button>}
      >
        {session.error || 'Browser could not connect'}
      </Alert>
    ) : null}
  </div>

  return <div testId={`agent-screen-${placement}`} style={{ width: width + 2, minHeight: 0, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRadius: radiusXl, borderWidth: 1, borderColor: m.border, backgroundColor: m.pane, overflow: 'hidden', boxShadow: elevation(m, expanded ? 'sheet' : 'card') }}>
    <div style={{ height: 40, paddingLeft: expanded && isMac ? 84 : 12, paddingRight: 6, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <div testId="browser-drag" onMouseDown={onDrag} style={{ flexGrow: 1, minWidth: 0, height: 40, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 7, cursor: onDrag ? 'move' : 'default' }}>
        <text style={{ fontSize: 12.5, fontWeight: 500, color: m.text, whiteSpace: 'nowrap', flexShrink: 0 }}>{agent.title}</text>
        <Rec startedAt={session.recordStartedAt} recording={Boolean(session.recording && streaming)} />
        {origin ? <text style={{ fontSize: 10.5, color: m.textFaint, whiteSpace: 'nowrap', textOverflow: 'ellipsis', minWidth: 0 }}>{origin}</text> : null}
      </div>
      {streaming ? <Button testId="browser-record" title={session.recording ? 'Stop recording' : 'Teach a task'} onPress={toggleRecording} selected={session.recording}>
        <Dot color={session.recording ? m.danger : m.textUi} size={6} pulse={session.recording} />
        <Label muted={!session.recording}>{session.recording ? 'End' : 'Teach a task'}</Label>
      </Button> : null}
      <Button testId="browser-details" title="Browser activity" onPress={() => setDetails(!details)} selected={details}><Icon name="history" size={13} /></Button>
      {floating && onReturnInline ? <Button testId="browser-return-inline" title="Return inline" onPress={onReturnInline}><Icon name="collapseAll" size={13} /></Button> : null}
      {expanded && streaming ? <Button testId="browser-control" disabled={control === 'pending' || view.status !== 'live'} selected={control === 'driving'} onPress={() => void takeControl()}><Label>{control === 'driving' ? 'Hand back' : control === 'pending' ? 'Waiting…' : 'Take control'}</Label></Button> : null}
      <Button testId={expanded ? 'browser-viewer-close' : 'browser-open'} title={expanded ? 'Collapse' : 'Expand'} onPress={() => { if (control !== 'watch') handBack(); onExpand() }}><Icon name={expanded ? 'collapseAll' : 'expandAll'} size={13} /></Button>
      {onMinimize ? <Button testId="browser-minimize" title="Minimize Agent Screen" onPress={() => { if (control !== 'watch') handBack(); onMinimize() }}><Icon name="x" size={13} /></Button> : null}
    </div>
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {screen}
      {/* Hostname pill overlaid on the frame, after ChatGPT's cloud-browser preview:
          one dot + status/hostname, floating over the page instead of a chrome row. */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, display: 'flex', justifyContent: 'center', paddingBottom: 8, pointerEvents: 'none' }}>
        <div testId="browser-status-pill" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, height: 26, paddingLeft: 10, paddingRight: 10, borderRadius: 13, borderWidth: 1, borderColor: m.border, backgroundColor: m.popup, boxShadow: elevation(m, 'popover') }}>
          <div style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: state === 'error' ? m.danger : streaming && view.status === 'live' ? m.accent : m.textFaint }} />
          <text style={{ fontSize: 10.5, color: state === 'error' ? m.danger : m.textMuted, whiteSpace: 'nowrap' }}>{status || origin || (streaming ? 'Live' : 'Last capture')}</text>
        </div>
      </div>
    </div>
    {error || session.error ? <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 12, paddingRight: 8, paddingTop: 4, paddingBottom: 8 }}>
      <text style={{ flexGrow: 1, minWidth: 0, fontSize: 11, color: m.danger }}>{error || session.error}</text>
      {streaming && state === 'error' ? <Button testId="browser-retry" onPress={() => { void browserCommand(session.noteId, { args: ['snapshot', '-i'] }, { signal: new AbortController().signal }).catch(e => setError(String(e.message))) }}><Label>Retry</Label></Button> : null}
    </div> : null}
    {details ? <div testId="browser-activity" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, maxHeight: 190, overflowY: 'scroll', scrollbarWidth: 4 }}>
      {(session.activities ?? []).slice(-20).map(item => <div key={item.id} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}><text style={{ fontSize: 11, color: item.exitCode ? m.danger : m.textMuted }}>{item.title} · {item.summary ?? 'Running'}{item.durationMs === undefined ? '' : ` · ${(item.durationMs / 1000).toFixed(1)}s`}</text>{item.artifacts?.map(artifact => <text key={artifact.path} style={{ fontSize: 10.5, color: m.textMuted }}>{artifact.kind}: {artifact.path}</text>)}</div>)}
      {!session.activities?.length ? <text style={{ fontSize: 11, color: m.textMuted }}>No browser activity recorded.</text> : null}
    </div> : null}
  </div>
}
