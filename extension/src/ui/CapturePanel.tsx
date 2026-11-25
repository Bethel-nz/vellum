import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion, type Transition } from 'motion/react'
import { IconArrowDown } from '@central-icons-react/round-outlined-radius-2-stroke-2/IconArrowDown'
import { IconArrowLeft } from '@central-icons-react/round-outlined-radius-2-stroke-2/IconArrowLeft'
import { IconArrowRight } from '@central-icons-react/round-outlined-radius-2-stroke-2/IconArrowRight'
import { IconArrowUp } from '@central-icons-react/round-outlined-radius-2-stroke-2/IconArrowUp'
import { IconChevronLeftSmall } from '@central-icons-react/round-outlined-radius-2-stroke-2/IconChevronLeftSmall'
import { IconChevronRightSmall } from '@central-icons-react/round-outlined-radius-2-stroke-2/IconChevronRightSmall'
import { IconCheckmark1 } from '@central-icons-react/round-outlined-radius-2-stroke-2/IconCheckmark1'
import { IconLayoutColumn } from '@central-icons-react/round-outlined-radius-2-stroke-2/IconLayoutColumn'
import { IconArrowWallDown } from '@central-icons-react/round-outlined-radius-2-stroke-2/IconArrowWallDown'
import { IconEyeOpen } from '@central-icons-react/round-outlined-radius-2-stroke-2/IconEyeOpen'
import { IconEyeSlash } from '@central-icons-react/round-outlined-radius-2-stroke-2/IconEyeSlash'
import { IconBezierPointer } from '@central-icons-react/round-outlined-radius-2-stroke-2/IconBezierPointer'
import { IconCamera1 } from '@central-icons-react/round-outlined-radius-2-stroke-2/IconCamera1'
import { IconSettingsSliderHor } from '@central-icons-react/round-outlined-radius-2-stroke-2/IconSettingsSliderHor'
import { IconTrashCan } from '@central-icons-react/round-outlined-radius-2-stroke-2/IconTrashCan'
import { IconArrowUndoUp } from '@central-icons-react/round-outlined-radius-2-stroke-2/IconArrowUndoUp'
import { IconCrossMedium } from '@central-icons-react/round-outlined-radius-2-stroke-2/IconCrossMedium'
import { IconSquareBehindSquare2 } from '@central-icons-react/round-outlined-radius-2-stroke-2/IconSquareBehindSquare2'
import { motionTokens } from '../arc/motion-tokens'
import { CaptureDials } from './Dials'
import type { PageScreenshot } from '../messages'
import type { MotionEdit, MotionForm, PageMotionInfo } from '../page-motion'
import type { ElementStyles, StyleField } from './element-controls'

type FoundMotion = Extract<PageMotionInfo, { found: true }>
/** Motion (via React) found on or around the element: which element it drives and the dials' values, in the source's own form. */
export type ScriptMotionView = Pick<FoundMotion, 'owner' | 'relation' | 'source' | 'editable' | 'key' | 'values'> & { form: MotionForm | 'other' }
/** `related`: recording an interaction also records what it opens or closes elsewhere on the page. */
export type CaptureOptions = { triggers: boolean; frames: boolean; listeners: boolean; related: boolean }
export type SelectedElement = { ref: string; number: number; anchor: { x: number; y: number }; selector: string; label: string; note: string; ready: boolean; fitOutline: boolean; motion: number; sampled: number; styles: ElementStyles; box: { x: number; y: number; width: number; height: number }; script?: ScriptMotionView; changes: number; comments: Array<{ id: string; text: string }>; snapshots: Array<{ id: string; file: string; image: string; selector: string }> }
export type CapturePanelProps = {
  open: boolean; selections: SelectedElement[]; activeRef: string | null; toolsOpen: boolean; markersHidden: boolean
  pageScreenshots: PageScreenshot[]
  message: string; error: boolean; capturing: boolean; recording: boolean; picking: boolean; options: CaptureOptions
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
  onMotion: (edit: MotionEdit) => void
  onTiming: (field: 'duration' | 'delay' | 'easing' | 'iterations', value: number | string) => void
  onNavigate: (direction: 'parent' | 'child' | 'previous' | 'next') => void
  onOptions: (options: CaptureOptions) => void; onPlayback: (playing: boolean) => void; onReplay: () => void
  onSpeed: (speed: number) => void; onSeek: (progress: number) => void
  getAnchor: () => { x: number; y: number } | null
  onRemoveCapture: (id: string) => void; onRemoveComment: (id: string) => void
  onCapture: () => void; onPageScreenshot: () => void; onRemovePageScreenshot: (id: string) => void; onRecord: () => void; onSend: () => void
  onCopy: () => Promise<void>
}

function motionNote(script: ScriptMotionView) {
  const where = script.relation === 'self' ? 'this element' : `${script.relation === 'parent' ? 'its parent' : script.relation === 'ancestor' ? 'a container' : 'an element inside'}, ${script.owner}`
  const kind = script.form === 'tween' ? 'Tween' : 'Spring'
  if (!script.editable) return `Motion animates ${where}. Its transition is set inside animate or a variant, which Snapshot can't edit yet. Leave a note instead.`
  return `${kind} from Motion on ${where}${script.source === 'default' ? ', using Motion’s default' : ''}. Edits apply to its next move. Replay runs one now.`
}

export function CapturePanel(props: CapturePanelProps) {
  const composer = useRef<HTMLDivElement>(null)
  const toolbar = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const inputMeasure = useRef<HTMLTextAreaElement>(null)
  const settingsButton = useRef<HTMLButtonElement>(null)
  const controlsId = useId()
  const capturePreviewId = useId()
  const [expandedCaptureId, setExpandedCaptureId] = useState<string | null>(null)
  const [pageGalleryOpen, setPageGalleryOpen] = useState(false)
  const [expandedPageScreenshotId, setExpandedPageScreenshotId] = useState<string | null>(null)
  const [multiline, setMultiline] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied'>('idle')
  useEffect(() => {
    if (copyState !== 'copied') return
    const timer = setTimeout(() => setCopyState('idle'), 1800)
    return () => clearTimeout(timer)
  }, [copyState])
  const dragPosition = useRef<{ ref: string; x: number; y: number } | null>(null)
  const placeComposer = useRef<() => void>(() => {})
  const dragOffset = useRef<{ pointerId: number; x: number; y: number; startX: number; startY: number; moved: boolean } | null>(null)
  const reduced = useReducedMotion()
  const panelTransition: Transition = { duration: reduced ? .12 : .2, ease: [...motionTokens.ease.enter] }
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
  const hasWork = props.selections.some((selection) => selection.ready || selection.note.trim() || selection.comments.length || selection.changes || selection.snapshots.length || selection.sampled)
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
  useLayoutEffect(() => {
    const node = input.current
    const measure = inputMeasure.current
    if (!node || !measure) return
    const resize = () => {
      // The row keeps its columns when it wraps, so the input's own width is a stable measure.
      measure.style.width = `${node.clientWidth}px`
      measure.style.height = '0px'
      const style = getComputedStyle(measure)
      const line = Number.parseFloat(style.lineHeight) || 24
      const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom)
      setMultiline(measure.scrollHeight > line + padding + 1)
      node.style.height = '0px'
      node.style.height = `${Math.min(180, node.scrollHeight)}px`
    }
    resize()
    let width = node.clientWidth, frame = 0
    const observer = new ResizeObserver(() => {
      const next = node.clientWidth
      if (next !== width) {
        width = next
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(resize)
      }
    })
    observer.observe(node)
    return () => { observer.disconnect(); cancelAnimationFrame(frame) }
  }, [active?.note, active?.ref])
  useLayoutEffect(() => {
    const node = composer.current
    if (!node || !active) return
    let geometry = ''
    const place = () => {
      const anchor = props.getAnchor()
      if (!anchor) return
      const width = node.getBoundingClientRect().width
      const x = Math.max(12, Math.min(innerWidth - width - 12, dragPosition.current?.ref === active.ref ? dragPosition.current.x : anchor.x + 16))
      // With the settings open the card travels with its element; otherwise it stays in view.
      const wanted = dragPosition.current?.ref === active.ref ? dragPosition.current.y : anchor.y + 16
      const y = props.toolsOpen ? wanted : Math.max(76, Math.min(innerHeight - 360, wanted))
      const rowHeight = node.querySelector('.vellum-comment-row')?.getBoundingClientRect().height ?? 48
      const next = [x, y, innerHeight, rowHeight].join(',')
      if (next === geometry) return
      geometry = next
      node.style.left = `${x}px`; node.style.top = `${y}px`
      node.style.setProperty('--vellum-editor-room', `${Math.max(100, innerHeight - y - 12)}px`)
      node.style.setProperty('--vellum-comment-height', `${rowHeight}px`)
    }
    placeComposer.current = place
    place()
    const observer = new ResizeObserver(place)
    observer.observe(node)
    const resize = () => place()
    window.addEventListener('scroll', resize, true)
    window.addEventListener('resize', resize)
    return () => { placeComposer.current = () => {}; observer.disconnect(); window.removeEventListener('scroll', resize, true); window.removeEventListener('resize', resize) }
  }, [active?.ref, active?.selector, props.picking, props.recording, props.toolsOpen])
  const position = active ? props.selections.findIndex((selection) => selection.ref === active.ref) : -1
  const step = (by: number) => { const next = props.selections[(position + by + props.selections.length) % props.selections.length]; if (next) props.onActivate(next.ref, props.toolsOpen) }
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`
  const summary = active ? [active.comments.length ? plural(active.comments.length, 'note') : '', active.changes ? plural(active.changes, 'edit') : ''].filter(Boolean).join(' · ') : ''
  const closeEditor = () => { props.onActivate(null); toolbar.current?.querySelector<HTMLButtonElement>('button')?.focus() }
  const label = props.capturing ? props.message || 'Sending…' : props.recording ? props.message : props.error ? props.message : ''
  return <AnimatePresence>{props.open ? <div className="vellum-snapshot" onKeyDown={(event) => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    if (props.toolsOpen) { props.onToolsOpen(false); settingsButton.current?.focus() }
    else if (active) closeEditor()
    else props.onClose()
  }}>
    <div className="vellum-toolbar-cluster">
    <motion.div ref={toolbar} className="vellum-toolbar" role="toolbar" aria-label="Annotation tools" initial={{ opacity: 0, y: reduced ? 0 : -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={panelTransition}>
      <span className="vellum-pick-label" role="status" title={props.message || undefined} hidden={!label}>{label}</span>
      <button type="button" className="vellum-tool-button" aria-label="Select an element" title="Select an element" aria-pressed={props.picking} disabled={props.capturing || props.recording} onClick={props.onPicking}><IconBezierPointer size={18} /></button>
      <button type="button" className="vellum-tool-button" aria-label="Capture page screenshot" title="Capture page screenshot" disabled={props.capturing || props.recording} aria-expanded={pageGalleryOpen} onClick={() => { setPageGalleryOpen(true); props.onPageScreenshot() }}><IconCamera1 size={18} /></button>
      <button type="button" className="vellum-tool-button" aria-label={props.markersHidden ? 'Show markers' : 'Hide markers'} title={props.markersHidden ? 'Show markers' : 'Hide markers'} aria-pressed={props.markersHidden} onClick={props.onMarkers}>{props.markersHidden ? <IconEyeOpen size={18} /> : <IconEyeSlash size={18} />}</button>
      {props.selections.some((selection) => selection.changes) ? <button type="button" className="vellum-tool-button" aria-label="Hold to view original" title="Hold to view original" disabled={!props.selections.some((selection) => selection.changes)} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); props.onOriginal(true) }} onPointerUp={() => props.onOriginal(false)} onPointerCancel={() => props.onOriginal(false)} onLostPointerCapture={() => props.onOriginal(false)} onKeyDown={(event) => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); props.onOriginal(true) } }} onKeyUp={() => props.onOriginal(false)} onBlur={() => props.onOriginal(false)}><IconLayoutColumn size={18} /></button> : null}
      {props.selections.length ? <button type="button" className="vellum-tool-button" aria-label="Discard annotations" title="Discard annotations" disabled={!props.selections.length || props.capturing || props.recording} onClick={props.onDiscard}><IconTrashCan size={18} /></button> : null}
      {props.onUndo ? <button type="button" className="vellum-tool-button" aria-label="Undo removal" title="Undo removal" onClick={props.onUndo}><IconArrowUndoUp size={18} /></button> : null}
      {hasWork ? <div className="vellum-delivery-actions" role="group" aria-label="Annotation actions">
        <button type="button" className="vellum-tool-button vellum-send" aria-label="Send annotations" title="Send annotations to the queue" disabled={!count || props.capturing || props.recording || copyState === 'copying'} onClick={props.onSend}><IconCheckmark1 size={16} /></button>
        <button type="button" className="vellum-tool-button vellum-copy" aria-label={copyState === 'copied' ? 'Annotations copied' : 'Copy all annotations'} title={copyState === 'copied' ? 'Copied' : 'Copy all annotations'} disabled={!props.selections.length || props.capturing || props.recording || copyState === 'copying'} onClick={async () => {
          setCopyState('copying')
          try { await props.onCopy(); setCopyState('copied') } catch { setCopyState('idle') }
        }}>{copyState === 'copied' ? <IconCheckmark1 size={16} /> : <IconSquareBehindSquare2 size={16} />}</button>
        <span className="vellum-sr-only" role="status">{copyState === 'copied' ? 'All annotations copied' : ''}</span>
      </div> : null}
      <button type="button" className="vellum-tool-button" aria-label="Close Snapshot" title="Close Snapshot (Esc)" disabled={props.capturing || props.recording} onClick={props.onClose}><IconCrossMedium size={18} /></button>

    </motion.div>
    </div>
    {props.error ? <span className="vellum-sr-only" role="alert">{props.message}</span> : null}
    <AnimatePresence>{active && !props.picking && !props.recording ? <motion.div key={active.ref} ref={composer} className="vellum-annotation-popover" role="dialog" aria-label={`Annotation ${active.number} on ${active.label}`} initial={{ opacity: 0, y: reduced ? 0 : 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={panelTransition}>
      <div className="vellum-annotation-header">
        <div className="vellum-annotation-heading" title={active.selector}>
          <span className="vellum-annotation-title">{active.label}</span>
          {props.selections.length > 1 ? <span className="vellum-annotation-count">{position + 1} of {props.selections.length}</span> : null}
        </div>
        {props.selections.length > 1 ? <>
          <button type="button" className="vellum-glyph-button" aria-label="Previous annotation" title="Previous annotation" disabled={props.capturing} onClick={() => step(-1)}><IconChevronLeftSmall size={16} /></button>
          <button type="button" className="vellum-glyph-button" aria-label="Next annotation" title="Next annotation" disabled={props.capturing} onClick={() => step(1)}><IconChevronRightSmall size={16} /></button>
        </> : null}
        {props.toolsOpen
          ? <button ref={settingsButton} type="button" className="vellum-done-button" aria-expanded aria-controls={controlsId} onClick={() => { props.onToolsOpen(false); input.current?.focus() }}>Done</button>
          : <button ref={settingsButton} type="button" className="vellum-glyph-button" aria-label="Show element controls" title="Styles and animation" aria-expanded={false} aria-controls={controlsId} disabled={props.capturing} onClick={() => props.onToolsOpen(true)}><IconSettingsSliderHor size={16} /></button>}
      </div>
      <motion.div id={controlsId} className="vellum-controls-reveal" inert={!props.toolsOpen || props.capturing} aria-hidden={!props.toolsOpen} initial={false} animate={{ height: props.toolsOpen ? 'auto' : 0, marginTop: props.toolsOpen ? 6 : 0 }} style={{ pointerEvents: props.toolsOpen ? 'auto' : 'none' }} transition={controlsTransition}>
        <motion.div className="vellum-settings-popover" initial={false} animate={{ opacity: props.toolsOpen ? 1 : 0 }} transition={controlsContentTransition}>
          <nav className="vellum-inspector-navigation" aria-label="Select related element" onPointerDown={(event) => {
      if (event.button !== 0 || props.capturing || (event.target as Element).closest('button')) return
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
      // Move the whole surface directly, without triggering child layout springs.
      dragPosition.current = { ref: active.ref, x: event.clientX - offset.x, y: event.clientY - offset.y }
      placeComposer.current()
    }} onPointerUp={() => { dragOffset.current = null }} onPointerCancel={() => { dragOffset.current = null }} onLostPointerCapture={() => { dragOffset.current = null }}><span>Nearby elements</span>{([['parent', IconArrowUp], ['child', IconArrowDown], ['previous', IconArrowLeft], ['next', IconArrowRight]] as const).map(([direction, Icon]) => <button type="button" className="vellum-tool-button" key={direction} aria-label={`Select ${direction} element`} title={`Select ${direction} element`} disabled={props.capturing} onClick={() => props.onNavigate(direction)}><Icon size={15} /></button>)}</nav>
          <div className="vellum-inspector-scroll">
            {active.script ? <p className="vellum-motion-note">{motionNote(active.script)}</p> : null}
            <CaptureDials key={`${active.ref}:${active.selector}:${props.playback.scrubDuration}:${active.script ? `${active.script.owner}:${active.script.form}:${active.script.editable}` : ''}`} {...props} selection={active} />
          </div>
          <div className="vellum-inspector-footer"><button type="button" className="vellum-text-button" disabled={!active.changes || props.capturing} onClick={props.onReset}>Reset</button><span>{active.changes ? `${active.changes} changes` : ''}</span><button type="button" className="vellum-tool-button" aria-label="Capture selected element" title="Capture selected element" disabled={props.capturing} onClick={props.onCapture}><IconCamera1 size={17} /></button></div>
        </motion.div>
      </motion.div>
      {!props.toolsOpen && active.comments.length ? <ul className="vellum-note-list" aria-label="Notes">{active.comments.map((comment, index) => <li key={comment.id}>
        <p>{comment.text}</p>
        <button type="button" aria-label={`Remove note ${index + 1}`} title="Remove note" disabled={props.capturing} onClick={() => props.onRemoveComment(comment.id)}><IconCrossMedium size={10} /></button>
      </li>)}</ul> : null}
      <motion.div layout="size" className="vellum-comment-row" data-multiline={multiline} hidden={props.toolsOpen} transition={reduced ? { duration: 0 } : motionTokens.spring.morph}>
        <motion.textarea layout="position" transition={reduced ? { duration: 0 } : motionTokens.spring.morph} ref={input} className="vellum-comment-input" aria-label={`Add a note on ${active.label}`} placeholder="Add a note" value={active.note} rows={1} disabled={props.capturing} onChange={(event) => props.onNote(active.ref, event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); props.onSave() } }} />
        <textarea ref={inputMeasure} className="vellum-comment-measure" aria-hidden="true" inert tabIndex={-1} value={active.note} rows={1} readOnly />
        {active.note.trim() || !summary ? null : <button type="button" className="vellum-note-meta" aria-label="Open element controls" aria-expanded={props.toolsOpen} aria-controls={controlsId} disabled={props.capturing} onClick={() => props.onToolsOpen(true)}>{summary}</button>}
        <motion.button layout="position" transition={reduced ? { duration: 0 } : motionTokens.spring.morph} type="button" className="vellum-tool-button vellum-comment-save" data-send={Boolean(active.note.trim())} aria-label={active.note.trim() ? 'Add note' : 'Save annotation'} title={active.note.trim() ? 'Add note (↵)' : 'Save annotation (↵)'} disabled={props.capturing || !canSave} onClick={props.onSave}>
          {active.note.trim() ? <IconArrowUp size={14} /> : <IconCheckmark1 size={14} />}
        </motion.button>
      </motion.div>
      {active.snapshots.length ? <>
        <AnimatePresence initial={false}>{active.snapshots.filter((snapshot) => snapshot.id === expandedCaptureId).map((snapshot) => <motion.div key={snapshot.id} id={`${capturePreviewId}-${snapshot.id}`} className="vellum-expanded-capture" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={reduced ? { duration: 0 } : motionTokens.spring.smooth}>
          <div className="vellum-expanded-capture-inner"><img src={snapshot.image} alt={`Expanded capture ${active.snapshots.findIndex((item) => item.id === snapshot.id) + 1}: ${snapshot.selector}`} /><a className="vellum-capture-download" href={snapshot.image} download={snapshot.file} aria-label="IconArrowWallDown annotated element screenshot" title="IconArrowWallDown screenshot"><IconArrowWallDown size={15} /></a></div>
        </motion.div>)}</AnimatePresence>
        <ul className="vellum-capture-stack" aria-label="Captures">{active.snapshots.map((snapshot, index) => <li className="vellum-capture-item" key={snapshot.id}>
          <button type="button" className="vellum-capture-thumbnail" aria-label={`${expandedCaptureId === snapshot.id ? 'Collapse' : 'Expand'} capture ${index + 1}`} aria-expanded={expandedCaptureId === snapshot.id} aria-controls={`${capturePreviewId}-${snapshot.id}`} onClick={() => setExpandedCaptureId((current) => current === snapshot.id ? null : snapshot.id)}><img src={snapshot.image} alt={`Capture ${index + 1}: ${snapshot.selector}`} /></button>
          <button type="button" className="vellum-capture-remove" aria-label={`Remove capture ${index + 1}`} title="Remove capture" disabled={props.capturing} onClick={() => { props.onRemoveCapture(snapshot.id); if (expandedCaptureId === snapshot.id) setExpandedCaptureId(null) }}><IconCrossMedium size={10} /></button>
        </li>)}</ul>
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
