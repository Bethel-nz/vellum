import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion, type Transition } from 'motion/react'
import { IconArrowDown } from '@central-icons-react/round-outlined-radius-2-stroke-2/IconArrowDown'
import { IconArrowLeft } from '@central-icons-react/round-outlined-radius-2-stroke-2/IconArrowLeft'
import { IconArrowRight } from '@central-icons-react/round-outlined-radius-2-stroke-2/IconArrowRight'
import { IconArrowUp } from '@central-icons-react/round-outlined-radius-2-stroke-2/IconArrowUp'
import { IconCheckmark1 } from '@central-icons-react/round-outlined-radius-2-stroke-2/IconCheckmark1'
import { IconLayoutColumn } from '@central-icons-react/round-outlined-radius-2-stroke-2/IconLayoutColumn'
import { IconArrowWallDown } from '@central-icons-react/round-outlined-radius-2-stroke-2/IconArrowWallDown'
import { IconEyeOpen } from '@central-icons-react/round-outlined-radius-2-stroke-2/IconEyeOpen'
import { IconEyeSlash } from '@central-icons-react/round-outlined-radius-2-stroke-2/IconEyeSlash'
import { IconDotGrid2x3 } from '@central-icons-react/round-outlined-radius-2-stroke-2/IconDotGrid2x3'
import { IconCursor1 } from '@central-icons-react/round-outlined-radius-2-stroke-2/IconCursor1'
import { IconCamera1 } from '@central-icons-react/round-outlined-radius-2-stroke-2/IconCamera1'
import { IconSettingsGear2 } from '@central-icons-react/round-outlined-radius-2-stroke-2/IconSettingsGear2'
import { IconSettingsSliderHor } from '@central-icons-react/round-outlined-radius-2-stroke-2/IconSettingsSliderHor'
import { IconTrashCan } from '@central-icons-react/round-outlined-radius-2-stroke-2/IconTrashCan'
import { IconArrowUndoUp } from '@central-icons-react/round-outlined-radius-2-stroke-2/IconArrowUndoUp'
import { IconCrossMedium } from '@central-icons-react/round-outlined-radius-2-stroke-2/IconCrossMedium'
import { motionTokens } from '../arc/motion-tokens'
import { CaptureDials } from './Dials'
import type { PageScreenshot } from '../messages'
import type { ElementStyles, StyleField } from './element-controls'

export type CaptureOptions = { triggers: boolean; frames: boolean; listeners: boolean }
export type SelectedElement = { ref: string; number: number; anchor: { x: number; y: number }; selector: string; label: string; note: string; ready: boolean; fitOutline: boolean; motion: number; sampled: number; styles: ElementStyles; box: { x: number; y: number; width: number; height: number }; changes: number; comments: Array<{ id: string; text: string }>; snapshots: Array<{ id: string; file: string; image: string; selector: string }> }
export type CapturePanelProps = {
  open: boolean; selections: SelectedElement[]; activeRef: string | null; toolsOpen: boolean; markersHidden: boolean
  pageScreenshots: PageScreenshot[]
  message: string; error: boolean; capturing: boolean; recording: boolean; picking: boolean; options: CaptureOptions
  bridge: { url: string; port: number }; onBridgeSettings: (url: string, port: number) => Promise<void>
  recordDuration: number; onRecordDuration: (seconds: number) => void
  playback: { playing: boolean; speed: number; position: number; duration: number; scrubDuration: number; delay: number; easing: string; iterations: string }
  onUndo?: () => void
  onToolsOpen: (open: boolean) => void
  onClose: () => void; onChoose: () => void; onPicking: () => void
  onRemove: (ref: string) => void; onNote: (ref: string, note: string) => void
  onActivate: (ref: string | null, tools?: boolean) => void; onSave: () => void; onDiscard: () => void
  onFitOutline: (fit: boolean) => void
  onMarkers: () => void; onOriginal: (show: boolean) => void
  onStyle: (field: StyleField, value: string) => void; onReset: () => void
  onTiming: (field: 'duration' | 'delay' | 'easing' | 'iterations', value: number | string) => void
  onNavigate: (direction: 'parent' | 'child' | 'previous' | 'next') => void
  onOptions: (options: CaptureOptions) => void; onPlayback: (playing: boolean) => void; onReplay: () => void
  onSpeed: (speed: number) => void; onSeek: (progress: number) => void
  getAnchor: () => { x: number; y: number } | null
  onRemoveCapture: (id: string) => void; onRemoveComment: (id: string) => void
  onCapture: () => void; onPageScreenshot: () => void; onRemovePageScreenshot: (id: string) => void; onRecord: () => void; onSend: () => void
  onCopy: () => Promise<void>
}

export function CapturePanel(props: CapturePanelProps) {
  const composer = useRef<HTMLDivElement>(null)
  const toolbar = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const inputMeasure = useRef<HTMLTextAreaElement>(null)
  const settingsButton = useRef<HTMLButtonElement>(null)
  const connectionSettingsButton = useRef<HTMLButtonElement>(null)
  const controlsId = useId()
  const connectionControlsId = useId()
  const capturePreviewId = useId()
  const [expandedCaptureId, setExpandedCaptureId] = useState<string | null>(null)
  const [pageGalleryOpen, setPageGalleryOpen] = useState(false)
  const [expandedPageScreenshotId, setExpandedPageScreenshotId] = useState<string | null>(null)
  const [connectionSettingsOpen, setConnectionSettingsOpen] = useState(false)
  const [bridgeUrl, setBridgeUrl] = useState(props.bridge.url)
  const [bridgePort, setBridgePort] = useState(String(props.bridge.port))
  const [bridgeStatus, setBridgeStatus] = useState('')
  const [multiline, setMultiline] = useState(false)
  const [dragPosition, setDragPosition] = useState<{ ref: string; x: number; y: number } | null>(null)
  const dragOffset = useRef<{ pointerId: number; x: number; y: number; startX: number; startY: number; moved: boolean } | null>(null)
  const reduced = useReducedMotion()
  const panelTransition: Transition = { duration: reduced ? .12 : .2, ease: [...motionTokens.ease.enter] }
  const menuTransition: Transition = reduced ? { duration: motionTokens.duration.instant } : {
    default: motionTokens.spring.smooth,
    opacity: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.enter] },
  }
  const menuExitTransition: Transition = { duration: reduced ? motionTokens.duration.instant : .13, ease: [...motionTokens.ease.standard] }
  const controlsTransition: Transition = reduced ? { duration: 0 } : {
    ...motionTokens.spring.smooth,
    delay: props.toolsOpen ? 0 : .06,
  }
  const controlsContentTransition: Transition = reduced ? { duration: motionTokens.duration.instant } : props.toolsOpen
    ? { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.standard], delay: .12 }
    : { duration: .1, ease: [...motionTokens.ease.standard] }
  const active = props.selections.find((selection) => selection.ref === props.activeRef)
  const canSave = Boolean(active && (active.note.trim() || active.comments.length || active.snapshots.length || active.changes || active.sampled))
  const count = props.selections.filter((selection) => selection.ready).length
  useEffect(() => {
    if (active && !props.picking) input.current?.focus({ preventScroll: true })
  }, [active?.ref, props.picking])
  useEffect(() => {
    if (!active || props.picking || props.recording) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const node = composer.current
      if (!node) return
      // Document events from our closed shadow root expose the host, not inner controls.
      // Keep toolbar/settings interactions inside the same annotation session.
      const root = node.getRootNode()
      const surface = root instanceof ShadowRoot ? root.host : node.closest('.vellum-snapshot') ?? node
      if (event.composedPath().includes(surface)) return
      props.onActivate(null)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [active?.ref, props.picking, props.recording, props.onActivate])
  useEffect(() => {
    setBridgeUrl(props.bridge.url)
    setBridgePort(String(props.bridge.port))
  }, [props.bridge.url, props.bridge.port])
  useLayoutEffect(() => {
    const node = input.current
    const measure = inputMeasure.current
    if (!node || !measure) return
    const resize = () => {
      // Measure wrapping at the compact width, even after the editor expands.
      // Otherwise the wider text area can collapse and reopen on every resize.
      measure.style.height = '0px'
      const style = getComputedStyle(measure)
      const line = Number.parseFloat(style.lineHeight) || 24
      const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom)
      setMultiline(measure.scrollHeight > line + padding + 1)
      node.style.height = '0px'
      node.style.height = `${Math.min(180, node.scrollHeight)}px`
    }
    resize()
    let width = node.getBoundingClientRect().width
    const observer = new ResizeObserver(() => {
      const next = node.getBoundingClientRect().width
      if (next !== width) { width = next; resize() }
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [active?.note, active?.ref])
  useLayoutEffect(() => {
    const node = composer.current
    if (!node || !active) return
    let geometry = ''
    const place = () => {
      const anchor = props.getAnchor()
      if (!anchor) return
      const width = node.getBoundingClientRect().width
      const x = Math.max(12, Math.min(innerWidth - width - 12, dragPosition?.ref === active.ref ? dragPosition.x : anchor.x + 16))
      const y = Math.max(76, Math.min(innerHeight - 360, dragPosition?.ref === active.ref ? dragPosition.y : anchor.y + 16))
      const rowHeight = node.querySelector('.vellum-comment-row')?.getBoundingClientRect().height ?? 48
      const next = [x, y, innerHeight, rowHeight].join(',')
      if (next === geometry) return
      geometry = next
      node.style.left = `${x}px`; node.style.top = `${y}px`
      node.style.setProperty('--vellum-editor-room', `${Math.max(100, innerHeight - y - 12)}px`)
      node.style.setProperty('--vellum-comment-height', `${rowHeight}px`)
    }
    place()
    const observer = new ResizeObserver(place)
    const row = node.querySelector('.vellum-comment-row')
    if (row) observer.observe(row)
    const resize = () => place()
    window.addEventListener('scroll', resize, true)
    window.addEventListener('resize', resize)
    return () => { observer.disconnect(); window.removeEventListener('scroll', resize, true); window.removeEventListener('resize', resize) }
  }, [active?.ref, active?.selector, props.picking, props.recording, dragPosition?.ref, dragPosition?.x, dragPosition?.y])
  const closeEditor = () => { props.onActivate(null); toolbar.current?.querySelector<HTMLButtonElement>('button')?.focus() }
  const label = props.capturing ? props.message || 'Sending…' : props.recording ? props.message : props.error ? props.message : count ? `Annotating · ${count}` : props.picking ? 'Pick an element' : 'Annotating'
  return <AnimatePresence>{props.open ? <div className="vellum-snapshot" onKeyDown={(event) => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    if (connectionSettingsOpen) { setConnectionSettingsOpen(false); connectionSettingsButton.current?.focus() }
    else if (props.toolsOpen) { props.onToolsOpen(false); settingsButton.current?.focus() }
    else if (active) closeEditor()
    else props.onClose()
  }}>
    <div className="vellum-toolbar-cluster">
    <motion.div ref={toolbar} className="vellum-toolbar" role="toolbar" aria-label="Annotation tools" initial={{ opacity: 0, y: reduced ? 0 : -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={panelTransition}>
      <IconDotGrid2x3 size={15} className="vellum-toolbar-grip" aria-hidden="true" />
      <span className="vellum-pick-label" role="status" title={props.message || undefined}>{label}</span>
      <button type="button" className="vellum-tool-button" aria-label="Select an element" title="Select an element" aria-pressed={props.picking} disabled={props.capturing || props.recording} onClick={props.onPicking}><IconCursor1 size={18} /></button>
      <button type="button" className="vellum-tool-button" aria-label="Capture page screenshot" title="Capture page screenshot" disabled={props.capturing || props.recording} aria-expanded={pageGalleryOpen} onClick={() => { setPageGalleryOpen(true); props.onPageScreenshot() }}><IconCamera1 size={18} /></button>
      <button type="button" className="vellum-tool-button" aria-label={props.markersHidden ? 'Show markers' : 'Hide markers'} title={props.markersHidden ? 'Show markers' : 'Hide markers'} aria-pressed={props.markersHidden} onClick={props.onMarkers}>{props.markersHidden ? <IconEyeOpen size={18} /> : <IconEyeSlash size={18} />}</button>
      <button type="button" className="vellum-tool-button" aria-label="Hold to view original" title="Hold to view original" disabled={!props.selections.some((selection) => selection.changes)} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); props.onOriginal(true) }} onPointerUp={() => props.onOriginal(false)} onPointerCancel={() => props.onOriginal(false)} onLostPointerCapture={() => props.onOriginal(false)} onKeyDown={(event) => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); props.onOriginal(true) } }} onKeyUp={() => props.onOriginal(false)} onBlur={() => props.onOriginal(false)}><IconLayoutColumn size={18} /></button>
      <button type="button" className="vellum-tool-button" aria-label="Discard annotations" title="Discard annotations" disabled={!props.selections.length || props.capturing || props.recording} onClick={props.onDiscard}><IconTrashCan size={18} /></button>
      {props.onUndo ? <button type="button" className="vellum-tool-button" aria-label="Undo removal" title="Undo removal" onClick={props.onUndo}><IconArrowUndoUp size={18} /></button> : null}
      <button type="button" className="vellum-tool-button vellum-send" aria-label="Send annotations" title="Send annotations to the queue" disabled={!count || props.capturing || props.recording} onClick={props.onSend}><IconCheckmark1 size={19} /></button>
      <button ref={connectionSettingsButton} type="button" className="vellum-tool-button" aria-label="Connection settings" title="Connection settings" aria-expanded={connectionSettingsOpen} aria-controls={connectionControlsId} onClick={() => { setConnectionSettingsOpen(!connectionSettingsOpen); setBridgeStatus('') }}><IconSettingsGear2 size={18} /></button>
      <button type="button" className="vellum-tool-button" aria-label="Close Snapshot" title="Close Snapshot (Esc)" disabled={props.capturing || props.recording} onClick={props.onClose}><IconCrossMedium size={18} /></button>

    </motion.div>
    <AnimatePresence initial={false}>{connectionSettingsOpen ? <motion.div key="connection-settings" id={connectionControlsId} className="vellum-connection-bar" role="group" aria-label="Vellum connection settings" initial={{ opacity: 0, y: reduced ? 0 : -5, scale: reduced ? 1 : .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: reduced ? 0 : -2.5, scale: reduced ? 1 : .98, transition: menuExitTransition }} style={{ transformOrigin: 'calc(100% - 62px) top' }} transition={menuTransition}>
      <label>URL<input type="url" value={bridgeUrl} placeholder="http://127.0.0.1" onChange={(event) => { setBridgeUrl(event.target.value); setBridgeStatus('') }} /></label>
      <label>Port<input type="number" min={1} max={65535} step={1} value={bridgePort} onChange={(event) => { setBridgePort(event.target.value); setBridgeStatus('') }} /></label>
      <button type="button" className="vellum-tool-button vellum-connection-save" aria-label="Save connection settings" title="Save" onClick={() => { void props.onBridgeSettings(bridgeUrl, Number(bridgePort)).then(() => setBridgeStatus('Saved')).catch((error) => setBridgeStatus((error as Error).message)) }}><IconCheckmark1 size={17} /></button>
      {bridgeStatus ? <span role="status">{bridgeStatus}</span> : null}
    </motion.div> : null}</AnimatePresence>
    </div>
    {props.error ? <span className="vellum-sr-only" role="alert">{props.message}</span> : null}
    <AnimatePresence>{active && !props.picking && !props.recording ? <motion.div key={active.ref} ref={composer} className="vellum-annotation-popover" role="dialog" aria-label={`Annotation ${active.number} on ${active.label}`} onPointerDown={(event) => {
      if ((event.target as HTMLElement).closest('button, textarea, input, select, a, [contenteditable="true"], .vellum-controls-reveal, .vellum-capture-stack')) return
      const rect = composer.current?.getBoundingClientRect()
      if (!rect) return
      dragOffset.current = { pointerId: event.pointerId, x: event.clientX - rect.left, y: event.clientY - rect.top, startX: event.clientX, startY: event.clientY, moved: false }
      event.currentTarget.setPointerCapture(event.pointerId)
    }} onPointerMove={(event) => {
      const offset = dragOffset.current
      if (!offset || offset.pointerId !== event.pointerId) return
      if (!offset.moved && Math.hypot(event.clientX - offset.startX, event.clientY - offset.startY) < 4) return
      offset.moved = true
      event.preventDefault()
      setDragPosition({ ref: active.ref, x: event.clientX - offset.x, y: event.clientY - offset.y })
    }} onPointerUp={() => { dragOffset.current = null }} onPointerCancel={() => { dragOffset.current = null }} initial={{ opacity: 0, y: reduced ? 0 : 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={panelTransition}>
      <motion.div layout="size" className="vellum-comment-row" data-multiline={multiline} transition={reduced ? { duration: 0 } : motionTokens.spring.morph}>
        <button ref={settingsButton} type="button" className="vellum-tool-button" aria-label={props.toolsOpen ? 'Hide element controls' : 'Show element controls'} title="Styles and animation" aria-expanded={props.toolsOpen} aria-controls={controlsId} disabled={props.capturing} onClick={() => props.onToolsOpen(!props.toolsOpen)}><IconSettingsSliderHor size={18} /></button>
        <textarea ref={input} className="vellum-comment-input" aria-label="Comment" placeholder="Add a comment…" value={active.note} rows={1} disabled={props.capturing} onChange={(event) => props.onNote(active.ref, event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); props.onSave() } }} />
        <textarea ref={inputMeasure} className="vellum-comment-measure" aria-hidden="true" inert tabIndex={-1} value={active.note} rows={1} readOnly />
        <button type="button" className="vellum-tool-button vellum-comment-save" aria-label="Save annotation" title="Save annotation" disabled={props.capturing || !canSave} onClick={props.onSave}>
          <IconArrowUp size={18} />
        </button>
      </motion.div>
      <motion.div id={controlsId} className="vellum-controls-reveal" inert={!props.toolsOpen || props.capturing} aria-hidden={!props.toolsOpen} initial={false} animate={{ height: props.toolsOpen ? 'auto' : 0, marginTop: props.toolsOpen ? 10 : 0 }} style={{ pointerEvents: props.toolsOpen ? 'auto' : 'none' }} transition={controlsTransition}>
        <motion.div className="vellum-settings-popover" initial={false} animate={{ opacity: props.toolsOpen ? 1 : 0 }} transition={controlsContentTransition}>
          <nav className="vellum-inspector-navigation" aria-label="Select related element"><span title={active.selector}>{active.label}</span>{([['parent', IconArrowUp], ['child', IconArrowDown], ['previous', IconArrowLeft], ['next', IconArrowRight]] as const).map(([direction, Icon]) => <button type="button" className="vellum-tool-button" key={direction} aria-label={`Select ${direction} element`} title={`Select ${direction} element`} disabled={props.capturing} onClick={() => props.onNavigate(direction)}><Icon size={15} /></button>)}</nav>
          <div className="vellum-inspector-scroll"><CaptureDials key={`${active.ref}:${active.selector}:${props.playback.scrubDuration}`} {...props} selection={active} /></div>
          <div className="vellum-inspector-footer"><button type="button" className="vellum-text-button" disabled={!active.changes || props.capturing} onClick={props.onReset}>Reset</button><span>{active.changes ? `${active.changes} changes` : ''}</span><button type="button" className="vellum-tool-button" aria-label="Capture selected element" title="Capture selected element" disabled={props.capturing} onClick={props.onCapture}><IconCamera1 size={17} /></button></div>
        </motion.div>
      </motion.div>
      {active.comments.length ? <div className="vellum-comment-stack" aria-label="Saved comments">{active.comments.map((comment) => <div className="vellum-comment-actions" key={comment.id}>
        <div className="vellum-saved-comment"><p>{comment.text}</p></div>
        <button type="button" className="vellum-tool-button" aria-label="Remove saved comment" title="Remove saved comment" disabled={props.capturing} onClick={() => props.onRemoveComment(comment.id)}><IconTrashCan size={14} /></button>
      </div>)}</div> : null}
      {active.snapshots.length ? <>
        <AnimatePresence initial={false}>{active.snapshots.filter((snapshot) => snapshot.id === expandedCaptureId).map((snapshot) => <motion.div key={snapshot.id} id={`${capturePreviewId}-${snapshot.id}`} className="vellum-expanded-capture" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={reduced ? { duration: 0 } : motionTokens.spring.smooth}>
          <div className="vellum-expanded-capture-inner"><img src={snapshot.image} alt={`Expanded capture ${active.snapshots.findIndex((item) => item.id === snapshot.id) + 1}: ${snapshot.selector}`} /><a className="vellum-capture-download" href={snapshot.image} download={snapshot.file} aria-label="IconArrowWallDown annotated element screenshot" title="IconArrowWallDown screenshot"><IconArrowWallDown size={15} /></a></div>
        </motion.div>)}</AnimatePresence>
        <div className="vellum-capture-stack" aria-label="Saved captures">{active.snapshots.map((snapshot, index) => <figure className="vellum-capture-item" key={snapshot.id}>
          <button type="button" className="vellum-capture-thumbnail" aria-label={`${expandedCaptureId === snapshot.id ? 'Collapse' : 'Expand'} capture ${index + 1}`} aria-expanded={expandedCaptureId === snapshot.id} aria-controls={`${capturePreviewId}-${snapshot.id}`} onClick={() => setExpandedCaptureId((current) => current === snapshot.id ? null : snapshot.id)}><img src={snapshot.image} alt={`Capture ${index + 1}: ${snapshot.selector}`} /></button>
          <figcaption><span>Capture {index + 1}</span><button type="button" className="vellum-tool-button" aria-label={`Remove capture ${index + 1}`} title={`Remove capture ${index + 1}`} disabled={props.capturing} onClick={() => { props.onRemoveCapture(snapshot.id); if (expandedCaptureId === snapshot.id) setExpandedCaptureId(null) }}><IconCrossMedium size={13} /></button></figcaption>
        </figure>)}</div>
      </> : null}
    </motion.div> : null}</AnimatePresence>
    <AnimatePresence initial={false}>{pageGalleryOpen ? <motion.section className="vellum-page-captures" aria-label="Page screenshots" initial={{ opacity: 0, y: reduced ? 0 : 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduced ? 0 : 12 }} transition={reduced ? { duration: 0 } : motionTokens.spring.smooth}>
      <div className="vellum-page-captures-heading"><span>Page screenshots</span><button type="button" className="vellum-tool-button" aria-label="Close page screenshots" title="Close page screenshots" onClick={() => setPageGalleryOpen(false)}><IconCrossMedium size={15} /></button></div>
      <AnimatePresence initial={false}>{props.pageScreenshots.filter((shot) => shot.id === expandedPageScreenshotId).map((shot, index) => <motion.div key={shot.id} className="vellum-page-capture-expanded" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={reduced ? { duration: 0 } : motionTokens.spring.smooth}><img src={shot.image} alt={`Expanded page screenshot ${index + 1}`} /><a className="vellum-capture-download" href={shot.image} download={`vellum-page-${index + 1}.png`} aria-label={`IconArrowWallDown page screenshot ${index + 1}`} title="IconArrowWallDown screenshot"><IconArrowWallDown size={15} /></a></motion.div>)}</AnimatePresence>
      <div className="vellum-page-capture-strip" role="list" aria-label="Captured page screenshots">
        {props.pageScreenshots.map((shot, index) => <figure className="vellum-page-capture-item" role="listitem" key={shot.id}>
          <button type="button" className="vellum-capture-thumbnail" aria-label={`${expandedPageScreenshotId === shot.id ? 'Collapse' : 'Expand'} page screenshot ${index + 1}`} aria-expanded={expandedPageScreenshotId === shot.id} onClick={() => setExpandedPageScreenshotId((current) => current === shot.id ? null : shot.id)}><img src={shot.image} alt={`Page screenshot ${index + 1}`} /></button>
          <figcaption><span>Screenshot {index + 1}</span><button type="button" className="vellum-tool-button" aria-label={`Remove page screenshot ${index + 1}`} title={`Remove page screenshot ${index + 1}`} onClick={() => { props.onRemovePageScreenshot(shot.id); if (expandedPageScreenshotId === shot.id) setExpandedPageScreenshotId(null) }}><IconCrossMedium size={13} /></button></figcaption>
        </figure>)}
        {!props.pageScreenshots.length ? <span className="vellum-page-captures-empty">Your screenshots will appear here.</span> : null}
      </div>
    </motion.section> : null}</AnimatePresence>
  </div> : null}</AnimatePresence>
}
