import { useEffect, useRef, useState } from 'react'
import { useGpuixRequired, type EventPayload, type ImgInstance, type KeyEvent, type PublicInstance } from '@gpuix/react'
import { Button, closedByOutsidePress, Icon, Label, Menu, Meta } from '../components'
import { bootMobile, clearMobileEvents, liveMobile, mobileDevices, mobileSDK, onMobileActivity, recordMobileEvent, registerMobileHost, setLiveMobile, type MobileDevice, type MobileDriver, type MobileFrame, type MobileStartOptions } from '../core/mobile'
import { readSettings, updateSettings } from '../core/store'
import { Edge } from './FilePreview'
import { useM } from './kit'

const blank = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const phases = { started: 'began', moved: 'changed', ended: 'ended', cancelled: 'ended' } as const
// The phone's own colours, the same in every theme: titanium rim, black glass, side buttons.
const body = '#0b0b0c'
const rim = '#3a3a3d'
const sideButton = '#2c2c2f'
/** What a press on the screen hands the window while the finger is down (app.tsx covers it). */
export type PhoneCapture = { move: (event: EventPayload) => void; up: (event: EventPayload) => void }
const clamp = (v: number) => Math.min(1, Math.max(0, v))

/** One simulator for the window. Changing notes never remounts or reconnects it. */
export function MobileView({ radius, onClose, onLeave, onResize, onCapture, onMouseMove }: {
  radius: number
  /** A press on the pane's left edge: app.tsx follows the drag (a double click resets). */
  onResize: (x: number, reset: boolean) => void
  onClose: () => void
  onLeave: () => void
  /** While a finger is down: the window takes every move and the lift, so a swipe that leaves the screen keeps going and nothing else selects. */
  onCapture: (capture: PhoneCapture | undefined) => void
  /** Moves over the pane, for app.tsx's active pane (moves don't bubble past a handler). */
  onMouseMove?: (event: EventPayload) => void
}) {
  const m = useM()
  const renderer = useGpuixRequired()
  const image = useRef<ImgInstance>(null)
  const screen = useRef<PublicInstance>(null)
  const driver = useRef<MobileDriver | null>(null)
  const connecting = useRef(false)
  const generation = useRef(0)
  const abort = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  const down = useRef(false)
  const point = useRef({ x: 0.5, y: 0.5 })
  const lastFrame = useRef<MobileFrame | null>(null)
  const [devices, setDevices] = useState<MobileDevice[]>([])
  const [selected, setSelected] = useState(readSettings().mobileDevice ?? '')
  const [menu, setMenu] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('stopped')
  const [error, setError] = useState('')
  // The stream's pixels (2× the phone's points): the phone is drawn no larger than its own size.
  const [dimensions, setDimensions] = useState({ width: 804, height: 1748 })
  const [agentBusy, setAgentBusy] = useState(false)
  const [room, setRoom] = useState({ width: 320, height: 650 })
  const [hasFrame, setHasFrame] = useState(false)
  const device = devices.find((item) => item.udid === selected)

  async function refresh(signal?: AbortSignal) {
    setLoading(true)
    try {
      const all = await mobileDevices(signal)
      if (!mounted.current || signal?.aborted) return
      setDevices(all)
      setSelected((previous) => all.some((item) => item.udid === previous) ? previous : (all[0]?.udid ?? ''))
      setError('')
    } catch (e) {
      if (mounted.current && !signal?.aborted) setError((e as Error).message)
    } finally { if (mounted.current && !signal?.aborted) setLoading(false) }
  }

  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    void refresh(controller.signal)
    const quiet = onMobileActivity(setAgentBusy)
    return () => {
      mounted.current = false
      generation.current++
      controller.abort()
      abort.current?.abort()
      forget()
      driver.current?.stop()
      driver.current = null
      quiet()
      onCapture(undefined)
    }
  }, [])

  /** Agents lose the phone with the view. */
  function forget() {
    if (liveMobile()?.driver === driver.current) setLiveMobile(undefined)
  }

  function disconnect() {
    generation.current++
    abort.current?.abort()
    forget()
    driver.current?.stop()
    driver.current = null
    down.current = false
    lastFrame.current = null
    clearMobileEvents()
    image.current?.setImage(Buffer.from(blank.split(',')[1]!, 'base64'))
    setHasFrame(false)
    setBusy(false)
    setStatus('stopped')
  }

  async function connect(options: MobileStartOptions = {}) {
    if (connecting.current) throw new Error('The phone is already connecting.')
    connecting.current = true
    try {
      const request = generation.current
      const all = await mobileDevices()
      if (!mounted.current || request !== generation.current) throw new Error('The connection was cancelled.')
      const target = all.find((item) => item.udid === (options.udid ?? selected)) ?? (!options.udid ? all[0] : undefined)
      if (!target) throw new Error('The selected simulator is unavailable.')
      if (driver.current?.udid === target.udid && options.fps === undefined && options.scale === undefined && options.helperDir === undefined) return
      disconnect()
      setDevices(all)
      setSelected(target.udid)
      const current = ++generation.current
      const controller = new AbortController()
      abort.current = controller
      setBusy(true)
      setError('')
      setStatus(target.state === 'Booted' ? 'starting' : 'booting')
      updateSettings({ mobileDevice: target.udid })
      try {
        const sdk = mobileSDK()
        if (target.state !== 'Booted') await bootMobile(target.udid, controller.signal)
        if (!mounted.current || current !== generation.current) throw new Error('The connection was cancelled.')
        setDevices((all) => all.map((item) => item.udid === target.udid ? { ...item, state: 'Booted' } : item))
        setStatus('starting')
        const started = await sdk.Driver.start({ ...options, udid: target.udid }, (event) => {
          if (!mounted.current || current !== generation.current) return
          recordMobileEvent(event)
          if (event.type === 'frame') {
            const previous = lastFrame.current
            lastFrame.current = event
            image.current?.setImagePixels(event.width, event.height, event.data, { format: 'bgra' })
            if (!previous || previous.width !== event.width || previous.height !== event.height) {
              setDimensions({ width: event.width, height: event.height })
              setHasFrame(true)
            }
          } else if (event.type === 'state') setStatus(event.state)
        })
        if (!mounted.current || current !== generation.current) { started.stop(); throw new Error('The connection was cancelled.') }
        driver.current = started
        setLiveMobile({ driver: started, device: { ...target, state: 'Booted' } })
        setStatus(started.state)
      } catch (e) {
        if (mounted.current && current === generation.current) { setStatus('stopped'); setError((e as Error).message) }
        throw e
      } finally { if (mounted.current && current === generation.current) setBusy(false) }
    } finally { connecting.current = false }
  }

  useEffect(() => registerMobileHost({ connect, disconnect }))

  function input(action: (current: MobileDriver) => void) {
    if (!driver.current) return
    try { action(driver.current) } catch (e) { setError((e as Error).message) }
  }

  function normal(event: EventPayload) {
    const bounds = screen.current && renderer.getElementBounds?.(screen.current.id)
    if (!bounds?.width || !bounds.height) return point.current
    return point.current = { x: clamp(((event.x ?? bounds.x) - bounds.x) / bounds.width), y: clamp(((event.y ?? bounds.y) - bounds.y) / bounds.height) }
  }

  /** Take a press that isn't a touch, so it selects nothing until the lift. */
  function hold(event: EventPayload) {
    if (event.pressedButton !== undefined && event.pressedButton !== 0) return
    renderer.clearSelection?.()
    const done = () => { renderer.clearSelection?.(); onCapture(undefined) }
    onCapture({ move: (moved) => { renderer.clearSelection?.(); if (moved.pressedButton !== undefined && moved.pressedButton !== 0) done() }, up: done })
  }

  function release(event?: EventPayload) {
    if (!down.current) return
    down.current = false
    onCapture(undefined)
    const p = event ? normal(event) : point.current
    input((current) => current.pointer('up', p.x, p.y))
  }

  function key(event: KeyEvent) {
    const name = (event.key ?? '').toLowerCase()
    const mods = event.modifiers
    if (mods?.cmd && name === 'escape') { event.preventDefault(); event.stopPropagation(); onLeave(); return }
    if (mods?.ctrl && name === 'tab' || mods?.cmd && (mods.shift || ['n', 't', 'k', ',', 'y', 'w'].includes(name) || /^[1-9]$/.test(name))) return
    if (!driver.current) return
    event.preventDefault()
    event.stopPropagation()
    input((current) => {
      const modifiers = [mods?.cmd && 'cmd', mods?.ctrl && 'ctrl', mods?.alt && 'alt', mods?.shift && 'shift'].filter((value): value is string => Boolean(value))
      if ((mods?.cmd || mods?.ctrl || mods?.alt) && current.keyCombo([...modifiers, name])) return
      if (current.key(name)) return
      if (event.keyChar && !mods?.cmd && !mods?.ctrl) current.text(event.keyChar)
    })
  }

  const ratio = dimensions.width / dimensions.height
  // The phone fits the pane, never past its own size in points. The bezel and corner follow its
  // width the way an iPhone's do (a ~14 pt bezel and a ~55 pt display corner at 402 pt).
  const fit = (bezel: number) => Math.max(1, Math.min(room.width - 32 - bezel * 2 - 8, (room.height - 24 - bezel * 2) * ratio, dimensions.width / 2))
  const bezel = Math.round(Math.min(16, Math.max(8, fit(14) * 0.034)))
  const screenWidth = fit(bezel)
  const screenHeight = screenWidth / ratio
  const corner = screenWidth * 0.137
  const connected = Boolean(driver.current)
  const caption = error ? 'Couldn’t connect' : agentBusy ? 'An agent is using the phone' : status === 'live' ? 'Connected' : status === 'input-displaced' ? 'Click the screen to take control' : status === 'restarting' ? 'Reconnecting…' : status === 'booting' ? 'Booting simulator…' : status === 'starting' ? 'Connecting…' : 'Disconnected'
  /** A hardware button down the phone's side, `at` and `length` as shares of its height. */
  const side = (edge: 'left' | 'right', at: number, length: number) => <div style={{ position: 'absolute', [edge]: 0, top: bezel + screenHeight * at, width: 4, height: screenHeight * length, borderRadius: 2, backgroundColor: sideButton }} />

  return <div testId="mobile-view" onMouseMove={onMouseMove} style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, backgroundColor: m.pane, borderRadius: radius, borderWidth: 1, borderColor: m.border, overflow: 'hidden', position: 'relative' }}>
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, height: 46, paddingLeft: 10, paddingRight: 12, flexShrink: 0, borderBottomWidth: 1, borderColor: m.border }}>
      <div style={{ position: 'relative', flexGrow: 1, minWidth: 0 }}>
        <Button onPress={() => setMenu((open) => !open && !closedByOutsidePress('mobile-device'))} disabled={busy} testId="mobile-device" title="Choose a simulator" style={{ width: '100%', justifyContent: 'flex-start', height: 28, minWidth: 0 }}>
          <text style={{ fontSize: 12.5, fontWeight: 500, color: m.textUi, flexGrow: 1, minWidth: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{device?.name ?? 'iPhone'}</text>
          <Icon name="chevronDown" size={12} color={m.textMuted} />
        </Button>
        <Menu open={menu} onClose={() => setMenu(false)} width={290} closeKey="mobile-device" testId="mobile-devices" items={[
          ...devices.map((item) => ({ label: item.name, hint: item.runtime.split('.iOS-')[1]?.replaceAll('-', '.') ?? '', checked: item.udid === selected, testId: `mobile-device-${item.udid}`, onSelect: () => { disconnect(); setSelected(item.udid); updateSettings({ mobileDevice: item.udid }) } })),
          { kind: 'separator' },
          { label: 'Refresh devices', icon: 'refresh', disabled: loading, testId: 'mobile-refresh', onSelect: () => void refresh() },
          { label: 'Close mobile view', icon: 'x', testId: 'mobile-close', onSelect: onClose },
        ]} />
      </div>
      <Button onPress={() => connected ? disconnect() : void connect().catch((e) => setError((e as Error).message))} disabled={!device || busy} testId="mobile-connect" variant={connected ? 'quiet' : 'solid'}><Label variant={connected ? 'quiet' : 'solid'}>{busy ? 'Starting…' : connected ? 'Disconnect' : device?.state === 'Booted' ? 'Connect' : 'Boot'}</Label></Button>
    </div>
    <div
      // A press anywhere else in the pane (the margin, the frame) is the pane's too: GPUIX would
      // start a text selection there and carry it into the note, so the window cover takes the
      // drag and nothing gets selected.
      onMouseDown={(event) => { if (!down.current) hold(event) }}
      onLayout={(event) => { const width = Math.round(event.width ?? 0); const height = Math.round(event.height ?? 0); if (width > 0 && height > 0) setRoom((previous) => previous.width === width && previous.height === height ? previous : { width, height }) }} style={{ flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
      <div style={{ position: 'relative', width: screenWidth + bezel * 2 + 8, height: screenHeight + bezel * 2, flexShrink: 0 }}>
        {side('left', 0.17, 0.045)}
        {side('left', 0.25, 0.075)}
        {side('left', 0.34, 0.075)}
        {side('right', 0.27, 0.11)}
        <div testId="mobile-frame" style={{ position: 'absolute', top: 0, bottom: 0, left: 3, right: 3, padding: bezel - 1.5, borderRadius: corner + bezel, backgroundColor: body, borderWidth: 1.5, borderColor: agentBusy ? m.focusRing : rim, overflow: 'hidden' }}>
          <div
            ref={screen}
            testId="mobile-screen"
            tabIndex={0}
            aria-label="Simulator screen"
            onMouseDown={(event) => {
              if (event.pressedButton !== undefined && event.pressedButton !== 0) return
              if (!driver.current) return hold(event)
              if (screen.current) renderer.focusElement?.(screen.current.id)
              // A touch is the phone's: no text selection starts here or carries on into the note.
              renderer.clearSelection?.()
              const p = normal(event)
              down.current = true
              const mods = { alt: event.modifiers?.alt, shift: event.modifiers?.shift }
              input((current) => current.pointer('down', p.x, p.y, mods))
              onCapture({
                move: (moved) => {
                  if (moved.pressedButton !== undefined && moved.pressedButton !== 0) return release(moved)
                  if (!down.current) return
                  const q = normal(moved)
                  input((current) => current.pointer('move', q.x, q.y, { alt: moved.modifiers?.alt, shift: moved.modifiers?.shift }))
                },
                up: release,
              })
            }}
            onMouseUp={release}
            onBlur={() => release()}
            onKeyDown={key}
            onScroll={(event) => {
              const phase = phases[event.touchPhase as keyof typeof phases]
              const bounds = screen.current && renderer.getElementBounds?.(screen.current.id)
              if (!event.precise || !phase || !bounds?.width || !bounds.height) return
              const p = normal(event)
              input((current) => current.scroll(phase, p.x, p.y, (event.deltaX ?? 0) / bounds.width, (event.deltaY ?? 0) / bounds.height))
            }}
            style={{ position: 'relative', width: '100%', height: '100%', borderRadius: corner, overflow: 'hidden', backgroundColor: m.rootTint, cursor: connected ? 'pointer' : 'default', focusVisible: { outlineWidth: 2, outlineColor: m.focusRing }, keyboardFocusDim: false }}
          >
            {/* Rounded itself: a parent's corner clips its children square. */}
            <img ref={image} src={blank} objectFit="contain" style={{ width: '100%', height: '100%', borderRadius: corner }} />
            {!hasFrame ? <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, pointerEvents: 'none' }}>
              <Icon name="phone" size={26} color={m.textFaint} />
              <text style={{ fontSize: 12, lineHeight: 18, color: m.textMuted, textAlign: 'center' }}>{error || (busy ? caption : !devices.length && !loading ? 'Install an iOS runtime in Xcode, then refresh.' : 'Choose a simulator and connect. It stays here as you switch notes.')}</text>
            </div> : null}
          </div>
        </div>
      </div>
    </div>
    {/* The phone's buttons, in one pill. */}
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, paddingTop: 4, paddingBottom: 12, paddingLeft: 10, paddingRight: 10, flexShrink: 0 }}>
      <div testId="mobile-controls" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 2, padding: 3, borderRadius: 999, backgroundColor: m.chipBg, borderWidth: 1, borderColor: m.border }}>
        {([
          ['home', 'home', 'Home', () => input((current) => current.button('home'))],
          ['switcher', 'switcher', 'App switcher', () => input((current) => current.button('home', 2))],
          ['lock', 'lock', 'Lock', () => input((current) => current.button('side'))],
        ] as const).map(([id, icon, title, press]) => (
          <Button key={id} onPress={press} disabled={!connected} testId={`mobile-${id}`} title={title} style={{ width: 32, height: 28, borderRadius: 999, paddingLeft: 0, paddingRight: 0 }}><Icon name={icon} size={15} color={m.textUi} /></Button>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
        <Meta color={error ? m.danger : agentBusy ? m.textUi : m.textMuted}>{caption}</Meta>
        <text style={{ fontSize: 10.5, lineHeight: 15, color: m.textFaint, textAlign: 'center' }}>⌥ drag to pinch · ⌘Esc returns to note</text>
      </div>
    </div>
    <Edge testId="mobile-edge" left={0} onPress={(e) => onResize(e.x ?? 0, e.clickCount === 2)} />
  </div>
}
