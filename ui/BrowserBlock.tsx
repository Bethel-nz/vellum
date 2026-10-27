import { useEffect, useRef, useState } from 'react'
import { DismissableLayer, useGpuixRequired, useWindowSize, type ImgInstance, type KeyEvent, type PublicInstance } from '@gpuix/react'
import { Button, Label } from '../components'
import type { BrowserSession } from '../core/capture'
import { BrowserStream, browserPoint } from '../core/browser-stream'
import { appIsActive } from '../core/dock'
import { useM } from './kit'

export function BrowserBlock({ browser, onOpen }: { browser: BrowserSession; onOpen: () => void }) {
  return <BrowserSurface browser={browser} onOpen={onOpen} />
}

export function BrowserViewer({ browser, onClose, onTakeControl, onDrivingChange }: { browser: BrowserSession; onClose: () => void; onTakeControl: () => void; onDrivingChange: (driving: boolean) => void }) {
  const m = useM()
  const [driving, setDriving] = useState(false)
  const root = useRef<PublicInstance>(null)
  const handBack = () => { setDriving(false); onDrivingChange(false) }
  return <DismissableLayer onEscapeKeyDown={() => driving ? handBack() : onClose()} initialFocus={() => root.current?.id ?? null}>
    <div ref={root} testId="browser-viewer" tabIndex={0} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: m.pane, display: 'flex', flexDirection: 'column', keyboardFocusDim: false }}>
      <BrowserSurface browser={browser} expanded driving={driving} onDriving={() => { if (!driving) onTakeControl(); onDrivingChange(!driving); setDriving(!driving) }} onOpen={onClose} />
    </div>
  </DismissableLayer>
}

function BrowserSurface({ browser, expanded = false, driving = false, onDriving, onOpen }: { browser: BrowserSession; expanded?: boolean; driving?: boolean; onDriving?: () => void; onOpen: () => void }) {
  const m = useM()
  const window = useWindowSize()
  const renderer = useGpuixRequired()
  const image = useRef<ImgInstance>(null)
  const input = useRef<PublicInstance>(null)
  const stream = useRef<BrowserStream | undefined>(undefined)
  const dimensions = useRef({ width: 1280, height: 800 })
  const [size, setSize] = useState(dimensions.current)
  const [status, setStatus] = useState('connecting')
  const [url, setUrl] = useState(browser.url || 'Browser')
  useEffect(() => {
    const connection = new BrowserStream(browser.streamPort, (frame) => {
      image.current?.setImage(frame.data)
      if (dimensions.current.width !== frame.width || dimensions.current.height !== frame.height) { dimensions.current = { width: frame.width, height: frame.height }; setSize(dimensions.current) }
    }, (state, nextUrl) => { setStatus(state); if (nextUrl) setUrl(nextUrl) })
    stream.current = connection
    const pace = () => {
      const bounds = image.current && renderer.getElementBounds?.(image.current.id)
      const visible = bounds && bounds.y + bounds.height > 0 && bounds.y < window.height
      connection.configure(visible && appIsActive() ? expanded ? 30 : 4 : 1)
    }
    connection.configure(expanded ? 30 : 4)
    const timer = setInterval(pace, 2000)
    return () => { clearInterval(timer); connection.close(); stream.current = undefined }
  }, [browser.streamPort, expanded, renderer, window.height])
  useEffect(() => { if (driving && input.current) renderer.focusElement?.(input.current.id) }, [driving, renderer])
  const width = expanded ? Math.max(120, Math.min(window.width - 64, (window.height - 130) * size.width / size.height)) : Math.max(120, Math.min(560, window.width - 112))
  const height = Math.round(width * size.height / size.width)
  const mouse = (event: { x?: number; y?: number; button?: number; clickCount?: number; deltaX?: number; deltaY?: number }, eventType: string) => {
    if (!driving || !image.current) return
    const bounds = renderer.getElementBounds?.(image.current.id)
    if (!bounds || !bounds.width || !bounds.height || event.x === undefined || event.y === undefined) return
    const point = browserPoint({ x: event.x, y: event.y }, bounds, dimensions.current)
    stream.current?.send({ type: 'input_mouse', eventType, ...point, button: event.button === 2 ? 'right' : event.button === 1 ? 'middle' : 'left', clickCount: event.clickCount || 1, ...(eventType === 'mouseWheel' ? { deltaX: -(event.deltaX || 0), deltaY: -(event.deltaY || 0) } : {}) })
  }
  const key = (event: KeyEvent, eventType: 'keyDown' | 'keyUp') => {
    if (!driving || event.key === 'escape') return
    event.preventDefault()
    event.stopPropagation()
    const names: Record<string, string> = { enter: 'Enter', tab: 'Tab', backspace: 'Backspace', delete: 'Delete', left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown', space: ' ' }
    const value = names[event.key || ''] || event.key || ''
    const mods = event.modifiers
    stream.current?.send({ type: 'input_keyboard', eventType, key: value, modifiers: (mods?.alt ? 1 : 0) | (mods?.ctrl ? 2 : 0) | (mods?.cmd ? 4 : 0) | (mods?.shift ? 8 : 0) })
    if (eventType === 'keyDown' && (event.keyChar || value).length === 1 && !mods?.ctrl && !mods?.cmd) stream.current?.send({ type: 'input_keyboard', eventType: 'char', text: event.keyChar || value })
  }
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 10, ...(expanded ? { flexGrow: 1, padding: 20, alignItems: 'center', justifyContent: 'center' } : { borderRadius: 12, borderWidth: 1, borderColor: m.border, padding: 10 }) }}>
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, width: '100%' }}>
      <text style={{ fontSize: 11, color: status === 'live' ? m.accent : m.textMuted }}>{status === 'live' ? 'Live' : status === 'connecting' ? 'Connecting…' : 'Reconnecting…'}</text>
      <text style={{ fontSize: 12, color: m.textMuted, flexGrow: 1, minWidth: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{url}</text>
      {expanded ? <Button testId="browser-control" onPress={onDriving!} selected={driving}><Label>{driving ? "You're driving · Hand back" : 'Take control'}</Label></Button> : null}
      <Button testId={expanded ? 'browser-viewer-close' : 'browser-open'} onPress={onOpen}><Label>{expanded ? 'Done' : 'Open'}</Label></Button>
    </div>
    <div ref={input} testId="browser-input" tabIndex={driving ? 0 : undefined} onKeyDown={(event) => key(event, 'keyDown')} onKeyUp={(event) => key(event, 'keyUp')} onMouseDown={(event) => { if (driving && input.current) renderer.focusElement?.(input.current.id); mouse(event, 'mousePressed') }} onMouseUp={(event) => mouse(event, 'mouseReleased')} onMouseMove={(event) => mouse(event, 'mouseMoved')} onScroll={driving ? (event) => mouse(event, 'mouseWheel') : undefined} onClick={expanded ? undefined : onOpen} style={{ width, height, borderRadius: 8, backgroundColor: m.chipBg, keyboardFocusDim: false, cursor: driving ? 'default' : 'pointer' }}>
      <img ref={image} testId="browser-frame" src={browser.screenshot} objectFit="contain" style={{ width, height, borderRadius: 8, pointerEvents: 'none' }} />
    </div>
    {expanded && driving ? <text style={{ fontSize: 11.5, color: m.textMuted }}>The agent was asked to stop. A command already in progress may finish. Press Esc to hand control back.</text> : null}
  </div>
}
