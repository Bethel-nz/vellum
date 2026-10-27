import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'motion/react'
import { getElementAtPoint, getElementBounds, getElementSelector, isElementGrabbable } from 'react-grab/primitives'
import type { Capture, CaptureSnapshot, SavedCapture } from '../../core/capture'
import { animations, assets, downloadAssets, extract, observeAnimations, sample, type Selection } from './extract'
import { worker, type CaptureSettings, type ContentMessage, type PageScreenshot, type PageScreenshotResult, type SnapshotResult, type SnapshotStateResult } from './messages'
import { CapturePanel, type CaptureOptions } from './ui/CapturePanel'
import { loadFonts, setAppearance, type Appearance } from './ui/appearance'
import { shadowStyles } from './ui/styles'
import { copyAnnotations } from './copy'
import overlayStyles from './overlay.css?inline'
import { inlineStyle, readStyles, styleProperties, type StyleField, type StyleChange } from './ui/element-controls'

if (!document.querySelector('[data-vellum-capture]')) install()

function install() {
  const host = document.createElement('div')
  host.setAttribute('data-vellum-capture', '')
  host.setAttribute('data-react-grab-ignore', '')
  host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important;'
  const shadow = host.attachShadow({ mode: 'closed' })
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(`${shadowStyles}\n${overlayStyles}`)
  shadow.adoptedStyleSheets = [sheet]
  const surface = document.createElement('div')
  surface.className = 'vellum-ui'
  surface.dataset.theme = 'dark'
  const layer = document.createElement('div')
  layer.className = 'vellum-layer'
  const mount = document.createElement('div')
  mount.className = 'vellum-mount'
  surface.append(layer, mount)
  shadow.append(surface)
  document.documentElement.append(host)
  void loadFonts()
  const root = createRoot(mount)
  let bridgeConfig = { url: 'http://127.0.0.1', port: 47470 }
  void worker<CaptureSettings>({ type: 'settings' }).then((saved) => { bridgeConfig = { url: saved.url, port: saved.port }; render() }).catch(() => {})
  const selections: Selection[] = []
  let undoSelection: Selection[] | undefined
  let hovered: Element | null = null
  const toolbarId = crypto.randomUUID()
  let presenceTimer: ReturnType<typeof setInterval> | undefined
  const reportPresence = (open: boolean) => { void worker({ type: 'toolbar-presence', toolbarId, open }).catch(() => {}) }
  addEventListener('pagehide', () => { clearInterval(presenceTimer); reportPresence(false) })
  let enabled = false
  let recording = false
  let recordDuration = 2
  let capturing = false
  let message = ''
  let failed = false
  let picking = true
  let toolsOpen = false
  let activeRef: string | null = null
  let markersHidden = false
  let originalVisible = false
  let sendingRef: string | undefined
  const previews = new Map<Element, Map<string, StyleChange>>()
  const ready = new Set<string>()
  const fittedOutlines = new Set<string>()
  const pinPositions = new Map<string, { x: number; y: number }>()
  function anchorFor(selection: Selection) {
    const box = getElementBounds(selection.element)
    const point = pinPositions.get(selection.ref) ?? { x: box.x + scrollX, y: box.y + box.height + scrollY }
    return { x: point.x - scrollX, y: point.y - scrollY }
  }
  const snapshots = new Map<string, CaptureSnapshot[]>()
  const pageScreenshots: PageScreenshot[] = []
  const comments = new Map<string, Array<{ id: string; text: string }>>()
  const motionChanges = new Map<string, Map<string, { before: string; after: string }>>()
  const frameAnimations = new Map<Animation, { currentTime: CSSNumberish | null; state: AnimationPlayState; rate: number }>()
  const savedTiming = new Map<Animation, OptionalEffectTiming>()
  let sampledReplay: Animation | undefined
  let sampledPosition = 0
  const labelFor = (element: Element) => element.id ? `#${element.id}` : element.getAttribute('aria-label') || element.getAttribute('name') || element.tagName.toLowerCase()
  const hasContent = (selection: Selection) => Boolean(selection.note.trim() || comments.get(selection.ref)?.length || snapshots.get(selection.ref)?.length || previews.get(selection.element)?.size || motionChanges.get(selection.ref)?.size || selection.recorded.length)
  const activeSelection = () => selections.find((selection) => selection.ref === activeRef)
  function activate(ref: string | null, tools = false) {
    activeRef = ref; toolsOpen = tools; picking = false; hovered = null; render(); draw()
  }
  function restorePreview(element: Element) {
    const style = inlineStyle(element)
    for (const [property, change] of previews.get(element) ?? []) {
      if (change.inline) style?.setProperty(property, change.inline, change.priority)
      else style?.removeProperty(property)
    }
  }
  function viewOriginal(show: boolean) {
    if (show === originalVisible) return
    originalVisible = show
    for (const { element } of selections) {
      const changes = previews.get(element) ?? new Map<string, StyleChange>()
      if (show) restorePreview(element)
      else for (const [property, change] of changes) inlineStyle(element)?.setProperty(property, change.after, 'important')
    }
    draw()
  }
  function clearSampledReplay() {
    if (sampledReplay) {
      savedAnimations.delete(sampledReplay)
      sampledReplay.cancel()
      sampledReplay = undefined
    }
    sampledPosition = 0
  }
  function sampledFrames(selection: Selection) {
    const sampled = [...selection.recorded].reverse().find((animation) => animation.origin === 'sampled' && animation.samples?.length)
    if (!sampled?.samples?.length) return
    const rows = sampled.samples
    const first = Number(rows[0]?.t ?? 0)
    const last = Number(rows.at(-1)?.t ?? sampled.timing?.duration ?? 1000)
    const duration = Math.max(1, last - first)
    let previousOffset = 0
    const keyframes: Keyframe[] = rows.map((row, index) => {
      const offset = index === rows.length - 1 ? 1 : Math.max(previousOffset, Math.min(1, (Number(row.t ?? index) - first) / duration))
      previousOffset = offset
      return {
        offset,
        transform: `matrix(${row.a ?? 1}, ${row.b ?? 0}, ${row.c ?? 0}, ${row.d ?? 1}, ${row.tx ?? 0}, ${row.ty ?? 0})`,
        opacity: String(row.opacity ?? 1),
        ...(typeof row.sw === 'number' && Number.isFinite(row.sw) && row.sw > 0 ? { width: `${row.sw}px` } : {}),
        ...(typeof row.sh === 'number' && Number.isFinite(row.sh) && row.sh > 0 ? { height: `${row.sh}px` } : {}),
      }
    })
    return { keyframes, duration }
  }
  function previewSampledFrame(selection: Selection, progress: number, play = false) {
    const sampled = sampledFrames(selection)
    if (!sampled) return false
    clearSampledReplay()
    sampledPosition = progress * 100
    sampledReplay = selection.element.animate(sampled.keyframes, { duration: sampled.duration, easing: 'linear', fill: 'forwards' })
    if (play) sampledReplay.play()
    else { sampledReplay.pause(); sampledReplay.currentTime = progress * sampled.duration }
    return true
  }
  function editStyle(field: StyleField, value: string) {
    clearSampledReplay()
    const selection = activeSelection()
    if (!selection) return
    const property = styleProperties[field]
    const style = inlineStyle(selection.element)
    if (!style || !property || !CSS.supports(property, value)) return
    viewOriginal(false)
    let changes = previews.get(selection.element)
    if (!changes) { changes = new Map(); previews.set(selection.element, changes) }
    const before = changes.get(property) ?? { before: getComputedStyle(selection.element).getPropertyValue(property), after: value, inline: style.getPropertyValue(property), priority: style.getPropertyPriority(property) }
    changes.set(property, { ...before, after: value })
    style.setProperty(property, value, 'important')
    render(); draw()
  }
  let appearanceTimer: ReturnType<typeof setInterval> | undefined
  let returnFocus: HTMLElement | null = null
  let options: CaptureOptions = { triggers: true, frames: false, listeners: false }
  const savedAnimations = new Map<Animation, { currentTime: CSSNumberish | null; state: AnimationPlayState; rate: number }>()

  const status = (text: string, error = false) => { message = text; failed = error; render() }
  function saveAnimation(animation: Animation, states = savedAnimations) {
    if (!states.has(animation)) states.set(animation, { currentTime: animation.currentTime, state: animation.playState, rate: animation.playbackRate })
  }
  function restoreAnimationStates(states: typeof savedAnimations) {
    for (const [animation, saved] of states) {
      animation.playbackRate = saved.rate
      try {
        animation.currentTime = saved.currentTime
        if (saved.state === 'running') animation.play()
        else if (saved.state === 'paused') animation.pause()
      } catch { /* The selected element may have left the page. */ }
    }
    states.clear()
  }
  function restoreAnimations() {
    restoreAnimationStates(frameAnimations)
    for (const [animation, timing] of savedTiming) { try { animation.effect?.updateTiming(timing) } catch { /* The animation may have been removed. */ } }
    savedTiming.clear()
    restoreAnimationStates(savedAnimations)
  }
  const currentAnimations = () => activeSelection()?.element.getAnimations({ subtree: true }) ?? []
  function seek(element: Element, progress: number, states = savedAnimations) {
    for (const animation of element.getAnimations({ subtree: true })) {
      saveAnimation(animation, states)
      const timing = animation.effect?.getTiming()
      const duration = Number(timing?.duration)
      if (!Number.isFinite(duration)) continue
      animation.pause()
      animation.currentTime = Number(timing?.delay ?? 0) + duration * Math.min(.99999, progress)
    }
  }
  let trackingFrame = 0
  const trackedTargets: Array<{ element: Element; selection?: Selection; outline: HTMLDivElement; pin?: HTMLButtonElement; geometry?: string }> = []
  function updateGeometry() {
    for (const target of trackedTargets) {
      if (!target.element.isConnected) {
        target.outline.hidden = true
        if (target.pin) target.pin.hidden = true
        continue
      }
      const box = getElementBounds(target.element)
      const shape = target.selection && fittedOutlines.has(target.selection.ref) ? getComputedStyle(target.element) : undefined
      const radii = shape ? [shape.borderTopLeftRadius, shape.borderTopRightRadius, shape.borderBottomRightRadius, shape.borderBottomLeftRadius] : ['8px', '8px', '8px', '8px']
      const geometry = [box.x, box.y, box.width, box.height, ...radii].join(',')
      if (target.geometry === geometry) continue
      target.geometry = geometry
      target.outline.hidden = false
      Object.assign(target.outline.style, {
        left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px`,
        borderTopLeftRadius: radii[0], borderTopRightRadius: radii[1], borderBottomRightRadius: radii[2], borderBottomLeftRadius: radii[3],
      })
      if (target.pin && target.selection) {
        const point = pinPositions.get(target.selection.ref) ?? { x: box.x + scrollX, y: box.y + box.height + scrollY }
        const x = point.x - scrollX
        const y = point.y - scrollY
        target.pin.hidden = x < 0 || x > innerWidth || y < 0 || y > innerHeight
        Object.assign(target.pin.style, { left: `${Math.max(4, Math.min(innerWidth - 32, x - 4))}px`, top: `${Math.max(4, Math.min(innerHeight - 32, y - 24))}px` })
      }
    }
  }
  function trackGeometry() {
    if (!enabled) return
    updateGeometry()
    trackingFrame = requestAnimationFrame(trackGeometry)
  }
  function draw() {
    layer.replaceChildren()
    trackedTargets.length = 0
    if (!enabled || recording || markersHidden) return
    const targets = [
      ...selections.map((selection) => ({ element: selection.element, selection })),
      ...(picking && hovered && !selections.some((selection) => selection.element === hovered) ? [{ element: hovered, selection: undefined }] : []),
    ]
    for (const target of targets) {
      const outline = document.createElement('div')
      outline.className = `vellum-outline${target.selection ? ' vellum-outline-locked' : ''}`
      layer.append(outline)
      let pin: HTMLButtonElement | undefined
      if (target.selection) {
        const selection = target.selection
        const number = selections.indexOf(selection) + 1
        pin = document.createElement('button')
        pin.type = 'button'; pin.className = 'vellum-annotation-pin'; pin.textContent = String(number)
        const note = selection.note || comments.get(selection.ref)?.at(-1)?.text
        pin.setAttribute('aria-label', `${labelFor(target.element)}${note ? `: ${note}` : ''}`)
        pin.setAttribute('aria-pressed', String(activeRef === selection.ref))
        pin.addEventListener('click', () => { if (!capturing && !recording) activate(selection.ref) })
        layer.append(pin)
      }
      trackedTargets.push({ ...target, outline, pin })
    }
    updateGeometry()
  }
  function render() {
    const animation = currentAnimations()[0]
    const timing = animation?.effect?.getTiming()
    const progress = animation?.effect?.getComputedTiming().progress
    const duration = Number(timing?.duration)
    const selected = activeSelection()
    const sampledProgress = sampledReplay?.effect?.getComputedTiming().progress
    const hasRecordedFrames = Boolean(selected?.recorded.some((item) => item.origin === 'sampled' && item.samples?.length))
    const sampledDuration = [...(selected?.recorded ?? [])].reverse().find((item) => item.origin === 'sampled' && item.samples?.length)?.timing?.duration
    const position = sampledProgress ?? (hasRecordedFrames ? sampledPosition / 100 : progress ?? 0)
    const playback = { playing: animation?.playState === 'running', speed: animation?.playbackRate ?? 1, position: Math.round(Number(position) * 100), duration: Number.isFinite(duration) ? duration : 1000, scrubDuration: Number(sampledDuration) || (Number.isFinite(duration) ? duration : 1000), delay: Number(timing?.delay ?? 0), easing: timing?.easing ?? 'linear', iterations: String(timing?.iterations ?? 1) }
    root.render(createElement(MotionConfig, { reducedMotion: 'user' }, createElement(CapturePanel, {
      open: enabled, selections: selections.map((selection, index) => ({ ref: selection.ref, number: index + 1, anchor: anchorFor(selection), selector: getElementSelector(selection.element), label: labelFor(selection.element), note: selection.note, ready: ready.has(selection.ref) && hasContent(selection), fitOutline: fittedOutlines.has(selection.ref), motion: animations(selection.element).length, sampled: selection.recorded.filter((animation) => animation.origin === 'sampled').length, comments: comments.get(selection.ref) ?? [], snapshots: (snapshots.get(selection.ref) ?? []).map((snapshot) => ({ id: snapshot.id, file: snapshot.image.file, image: snapshot.image.dataUrl, selector: snapshot.node.selector })), styles: readStyles(selection.element), box: getElementBounds(selection.element), changes: (previews.get(selection.element)?.size ?? 0) + (motionChanges.get(selection.ref)?.size ?? 0) })), pageScreenshots,
      activeRef, toolsOpen, markersHidden, message, error: failed, capturing, recording, options, picking, playback, recordDuration,
      bridge: bridgeConfig,
      onBridgeSettings: async (url, port) => { bridgeConfig = await worker<{ url: string; port: number }>({ type: 'bridge-settings', url, port }); render() },
      onRecordDuration: (seconds) => { recordDuration = seconds; render() },
      onPicking: () => { picking = true; activeRef = null; toolsOpen = false; hovered = null; render(); draw() },
      onActivate: activate,
      getAnchor: () => { const selection = activeSelection(); return selection ? anchorFor(selection) : null },
      onToolsOpen: (open) => { toolsOpen = open; render(); draw() },
      onClose: () => setEnabled(false), onChoose: chooseFocused, onNavigate: navigate,
      onCapture: async () => {
        const selection = activeSelection()
        if (!selection || capturing) return
        capturing = true; status('Capturing…')
        try {
          if ((snapshots.get(selection.ref)?.length ?? 0) >= 12) throw new Error('Remove a capture before adding more than 12.')
          const { snapshot } = await worker<SnapshotResult>({ type: 'snapshot', ref: selection.ref })
          const size = selections.flatMap((item) => snapshots.get(item.ref) ?? []).reduce((total, item) => total + item.image.dataUrl.length, snapshot.image.dataUrl.length)
          if (size > 20_000_000) throw new Error('Remove a capture before adding another image.')
          snapshots.set(selection.ref, [...(snapshots.get(selection.ref) ?? []), snapshot])
          status('')
        } catch (error) { status((error as Error).message || 'Couldn’t capture. Try again.', true) }
        finally { capturing = false; render() }
      },
      onPageScreenshot: async () => {
        if (capturing) return
        capturing = true; status('Capturing page…')
        try {
          if (pageScreenshots.length >= 12) throw new Error('Remove a screenshot before taking more than 12.')
          const { screenshot } = await worker<PageScreenshotResult>({ type: 'page-screenshot' })
          if (pageScreenshots.reduce((total, shot) => total + shot.image.length, screenshot.image.length) > 20_000_000) throw new Error('Remove a screenshot before adding another image.')
          pageScreenshots.push(screenshot)
          status('')
        } catch (error) { status((error as Error).message || 'Couldn’t capture. Try again.', true) }
        finally { capturing = false; render() }
      },
      onRemovePageScreenshot: (id) => { const index = pageScreenshots.findIndex((shot) => shot.id === id); if (index >= 0) pageScreenshots.splice(index, 1); render() },
      onRemoveCapture: (id) => {
        if (!activeRef) return
        snapshots.set(activeRef, (snapshots.get(activeRef) ?? []).filter((snapshot) => snapshot.id !== id))
        render()
      },
      onRemoveComment: (id) => {
        if (!activeRef) return
        comments.set(activeRef, (comments.get(activeRef) ?? []).filter((comment) => comment.id !== id))
        render(); draw()
      },
      onMarkers: () => { markersHidden = !markersHidden; render(); draw() },
      onOriginal: viewOriginal,
      onFitOutline: (fit) => {
        if (!activeRef) return
        if (fit) fittedOutlines.add(activeRef)
        else fittedOutlines.delete(activeRef)
        render(); draw()
      },
      onStyle: editStyle,
      onReset: () => {
        const selection = activeSelection()
        if (!selection) return
        restorePreview(selection.element); previews.delete(selection.element)
        motionChanges.delete(selection.ref); 
        for (const animation of currentAnimations()) {
          const timing = savedTiming.get(animation)
          if (timing) { animation.effect?.updateTiming(timing); savedTiming.delete(animation) }
          const state = savedAnimations.get(animation)
          if (state) { restoreAnimationStates(new Map([[animation, state]])); savedAnimations.delete(animation) }
        }
        toolsOpen = false; render(); draw()
      },
      onTiming: (field, value) => {
        try {
          const next = field === 'easing' ? { easing: String(value) } : { [field]: Number(value) }
          for (const animation of currentAnimations()) {
            const effect = animation.effect
            if (!effect) continue
            if (!savedTiming.has(animation)) savedTiming.set(animation, effect.getTiming())
            saveAnimation(animation)
            effect.updateTiming(next)
            const selection = activeSelection()!
            let changes = motionChanges.get(selection.ref)
            if (!changes) { changes = new Map(); motionChanges.set(selection.ref, changes) }
            const key = `animation-${field}`
            changes.set(key, { before: changes.get(key)?.before ?? String(savedTiming.get(animation)?.[field]), after: String(value) })
          }
          render()
        } catch { status('Use a valid animation value.', true) }
      },
      onUndo: undoSelection ? () => {
        for (const selection of selections) selection.element.removeAttribute('data-vellum-ref')
        selections.splice(0, selections.length, ...undoSelection!.filter((selection) => selection.element.isConnected))
        for (const selection of selections) {
          selection.element.setAttribute('data-vellum-ref', selection.ref)
          for (const [property, change] of previews.get(selection.element) ?? []) inlineStyle(selection.element)?.setProperty(property, change.after, 'important')
        }
        undoSelection = undefined
        status(''); draw()
      } : undefined,
      onDiscard: () => {
        undoSelection = selections.slice()
        clearSampledReplay()
        for (const selection of selections) { selection.element.removeAttribute('data-vellum-ref'); restorePreview(selection.element) }
        selections.length = 0; activeRef = null; toolsOpen = false; picking = true
        restoreAnimations(); status(''); draw()
      },
      onRemove: (ref) => {
        const index = selections.findIndex((selection) => selection.ref === ref)
        if (index < 0) return
        undoSelection = selections.slice()
        clearSampledReplay()
        const selection = selections[index]!
        selection.element.removeAttribute('data-vellum-ref'); restorePreview(selection.element)
        selections.splice(index, 1)
        if (activeRef === ref) { activeRef = null; toolsOpen = false }
        picking = !selections.length
        status(''); draw()
      },
      onNote: (ref, note) => { const selection = selections.find((item) => item.ref === ref); if (selection) selection.note = note; render() },
      onSave: () => {
        const selection = activeSelection()
        if (!selection) return
        const text = selection.note.trim()
        if (text) {
          comments.set(selection.ref, [...(comments.get(selection.ref) ?? []), { id: crypto.randomUUID(), text }])
          selection.note = ''
        }
        if (!comments.get(selection.ref)?.length && !snapshots.get(selection.ref)?.length && !previews.get(selection.element)?.size && !motionChanges.get(selection.ref)?.size && !selection.recorded.length) return
        ready.add(selection.ref); activeRef = null; toolsOpen = false; picking = true; status(''); draw()
      },
      onOptions: (next) => { options = next; render() },
      onPlayback: (playing) => { for (const animation of currentAnimations()) { saveAnimation(animation); if (playing) animation.play(); else animation.pause() } render() },
      onReplay: () => {
        const selection = activeSelection()
        if (!selection) return
        const sampled = selection.recorded.filter((animation) => animation.origin === 'sampled' && animation.samples?.length).at(-1)
        const gesture = [...selection.recorded].reverse().find((animation) => animation.gesture)?.gesture
        if (gesture?.events.length) {
          const playGesture = async () => {
            let previous = 0
            for (const recorded of gesture.events) {
              const delay = Math.min(250, Math.max(0, recorded.t - previous))
              if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay))
              previous = recorded.t
              let target: Element | null = null
              try { target = document.querySelector(recorded.selector) } catch { /* A stale target is skipped. */ }
              if (!target?.isConnected || host.contains(target)) continue
              const init = { bubbles: true, cancelable: true, composed: true, button: recorded.button ?? 0, buttons: recorded.buttons ?? 0, clientX: recorded.clientX ?? 0, clientY: recorded.clientY ?? 0, key: recorded.key ?? '', code: recorded.code ?? '', altKey: recorded.altKey ?? false, ctrlKey: recorded.ctrlKey ?? false, metaKey: recorded.metaKey ?? false, shiftKey: recorded.shiftKey ?? false }
              let replayed: Event
              if (recorded.type.startsWith('pointer')) replayed = new PointerEvent(recorded.type, { ...init, pointerType: recorded.pointerType ?? 'mouse' })
              else if (recorded.type.startsWith('key')) replayed = new KeyboardEvent(recorded.type, init)
              else if (recorded.type === 'wheel') replayed = new WheelEvent(recorded.type, { ...init, deltaX: recorded.deltaX ?? 0, deltaY: recorded.deltaY ?? 0 })
              else if (recorded.type === 'focusin') replayed = new FocusEvent(recorded.type, init)
              else if (recorded.type === 'input' || recorded.type === 'change') replayed = new Event(recorded.type, init)
              else replayed = new MouseEvent(recorded.type, init)
              target.dispatchEvent(replayed)
            }
          }
          let hasReplayTarget = false
          for (const event of gesture.events) {
            try { if (document.querySelector(event.selector)?.isConnected) { hasReplayTarget = true; break } } catch { /* Try the next recorded target. */ }
          }
          if (hasReplayTarget) {
            clearSampledReplay()
            sampledPosition = 0
            const rows = sampled?.samples ?? []
            const first = rows[0]
            const last = rows.at(-1)
            const box = selection.element.getBoundingClientRect()
            const matches = (row?: Record<string, number>) => Boolean(row && ['x', 'y', 'w', 'h'].every((key) => typeof row[key] !== 'number' || Math.abs(row[key]! - ({ x: box.x, y: box.y, w: box.width, h: box.height }[key as 'x' | 'y' | 'w' | 'h'])) < 3))
            let lastChangeAt = 0
            for (let index = 1; index < rows.length; index++) {
              const previous = rows[index - 1]!
              if (Object.entries(rows[index]!).some(([key, value]) => key !== 't' && Math.abs(value - (previous[key] ?? value)) > .5)) lastChangeAt = Number(rows[index]!.t ?? 0)
            }
            const settleMs = Math.min(5000, lastChangeAt + 180)
            const alreadyAtEnd = Boolean(last && matches(last) && !matches(first))
            if (alreadyAtEnd) {
              void (async () => {
                await playGesture()
                await new Promise((resolve) => window.setTimeout(resolve, settleMs))
                if (enabled && selections.includes(selection)) await playGesture()
              })()
            } else void playGesture()
            status(`Replaying ${gesture.events.length} captured events.`)
            render(); draw()
            return
          }
        }
        if (sampled?.samples?.length) {
          previewSampledFrame(selection, 0, true)
          render()
          return
        }
        const current = currentAnimations()
        if (!current.length) { status('Record an interaction before replaying it.'); return }
        for (const animation of current) { saveAnimation(animation); animation.currentTime = 0; animation.play() }
        render(); draw()
      },
      onSpeed: (speed) => { for (const animation of currentAnimations()) { saveAnimation(animation); animation.playbackRate = speed } render() },
      onSeek: (progress) => { const selection = activeSelection(); if (selection && !previewSampledFrame(selection, progress)) seek(selection.element, progress); render(); draw() },
      onRecord: () => { clearSampledReplay(); void recordInteraction() }, onSend: () => { void send() },
      onCopy: async () => {
        try { await copyAnnotations(makeCapture([...selections])); status('') }
        catch (error) { status((error as Error).message || 'Couldn’t copy the annotations. Try again.', true); throw error }
      },
    })))
  }
  function choose(element: Element, point?: { x: number; y: number }) {
    if (element.ownerDocument !== document) { status('Open the embedded frame as a page, then select its elements.', true); return }
    const existing = selections.find((selection) => selection.element === element)
    if (existing) { activate(existing.ref); return }
    if (selections.length >= 12) { status('Send this capture before selecting more than 12 elements.', true); return }
    const ref = `e${selections.length + 1}-${crypto.randomUUID().slice(0, 8)}`
    element.setAttribute('data-vellum-ref', ref)
    const box = getElementBounds(element)
    pinPositions.set(ref, { x: (point?.x ?? box.x) + scrollX, y: (point?.y ?? box.y + box.height) + scrollY })
    selections.push({ element, ref, note: '', recorded: [] })
    activeRef = ref; toolsOpen = false
    hovered = null
    picking = false
    status('')
    draw()
  }
  function chooseFocused() {
    const focused = returnFocus && returnFocus !== document.body && returnFocus !== document.documentElement ? returnFocus : null
    const element = focused || [...document.querySelectorAll('main, [role="main"], h1, button, a[href], article')].find((candidate) => !host.contains(candidate) && isElementGrabbable(candidate))
    if (element) { choose(element); element.scrollIntoView({ block: 'nearest' }) }
    else status('Use Tab to focus an element on the page, then open capture again.', true)
  }
  function navigate(direction: 'parent' | 'child' | 'previous' | 'next') {
    const selection = activeSelection() ?? selections.at(-1)
    const current = selection?.element ?? hovered
    if (!current) { chooseFocused(); return }
    const next = direction === 'parent' ? current.parentElement : direction === 'child' ? current.firstElementChild : direction === 'previous' ? current.previousElementSibling : current.nextElementSibling
    if (!next || next === document.documentElement || next === host || !isElementGrabbable(next)) { status('No element in that direction. Try another direction.'); return }
    if (!selection) { choose(next); return }
    if (selections.some((item) => item !== selection && item.element === next)) { status('That element is already selected.'); return }
    selection.element.removeAttribute('data-vellum-ref')
    clearSampledReplay()
    restorePreview(selection.element)
    previews.delete(selection.element)
    motionChanges.delete(selection.ref)
    selection.element = next
    selection.recorded = []
    const box = getElementBounds(next)
    pinPositions.set(selection.ref, { x: box.x + scrollX, y: box.y + box.height + scrollY })
    next.setAttribute('data-vellum-ref', selection.ref)
    hovered = null
    activeRef = selection.ref
    status('')
    draw()
  }
  async function appearance() {
    try { const result = await worker<{ material: Appearance }>({ type: 'appearance' }); setAppearance(surface, result.material || 'dark') } catch { /* The neutral dark material remains available while the app is closed. */ }
  }
  function setEnabled(next: boolean) {
    if ((capturing || recording) && !next) return
    if (next && !enabled) returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    enabled = next
    clearInterval(presenceTimer)
    reportPresence(next)
    if (next) presenceTimer = setInterval(() => reportPresence(true), 15_000)
    cancelAnimationFrame(trackingFrame)
    if (next) trackingFrame = requestAnimationFrame(trackGeometry)
    if (next) { picking = true; viewOriginal(false) }
    clearInterval(appearanceTimer)
    if (next) { void appearance(); appearanceTimer = setInterval(() => { void appearance() }, 3000) }
    else { hovered = null; toolsOpen = false; activeRef = null; clearSampledReplay(); restoreAnimations(); viewOriginal(true); returnFocus?.focus({ preventScroll: true }) }
    status('')
    draw()
  }
  function isPanelEvent(event: Event) { return event.composedPath().includes(host) }
  document.addEventListener('pointermove', (event) => {
    if (!enabled || !picking || recording || capturing || isPanelEvent(event)) return
    hovered = getElementAtPoint(event.clientX, event.clientY, { filter: (candidate) => candidate !== host && !host.contains(candidate) && isElementGrabbable(candidate) })
    draw()
  }, true)
  document.addEventListener('click', (event) => {
    if (!enabled || (!picking && !event.shiftKey) || recording || capturing || isPanelEvent(event)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    const target = getElementAtPoint(event.clientX, event.clientY, { filter: (candidate) => candidate !== host && !host.contains(candidate) && isElementGrabbable(candidate) })
    if (target) { choose(target, { x: event.clientX, y: event.clientY }); if (event.shiftKey) { picking = true; render(); draw() } }
  }, true)
  document.addEventListener('keydown', (event) => {
    if (!enabled) return
    if (isPanelEvent(event)) return
    if (recording || capturing) return
    if (event.key === 'Escape') { event.preventDefault(); setEnabled(false); return }
    if (event.key === 'Enter' && picking) { event.preventDefault(); event.stopImmediatePropagation(); if (hovered) choose(hovered); else chooseFocused(); return }
    const directions = { ArrowUp: 'parent', ArrowDown: 'child', ArrowLeft: 'previous', ArrowRight: 'next' } as const
    const direction = directions[event.key as keyof typeof directions]
    if (!direction) return
    event.preventDefault()
    event.stopImmediatePropagation()
    navigate(direction)
  }, true)
  const updateLayout = () => { draw(); if (activeRef) render() }
  window.addEventListener('scroll', updateLayout, true)
  window.addEventListener('resize', updateLayout)
  async function recordInteraction() {
    const selection = activeSelection()
    if (recording || !selection) return
    recording = true
    status('Interact with the selected element to start recording.')
    draw()
    const duration = recordDuration * 1000
    const gesture: NonNullable<Capture['elements'][number]['animations'][number]['gesture']> = { events: [] }
    let motionPromise: ReturnType<typeof observeAnimations> | undefined
    let sampledPromise: ReturnType<typeof sample> | undefined
    const eventTypes = ['pointerover', 'pointermove', 'pointerdown', 'pointerup', 'mouseover', 'mousemove', 'mousedown', 'mouseup', 'click', 'focusin', 'keydown', 'keyup', 'input', 'change', 'wheel']
    const capturedGesture = await new Promise<boolean>((resolve) => {
      let started = false
      let pointerActive = false
      let keyActive = false
      let lastMove = 0
      let quietTimer = 0
      const removeListeners = () => { for (const type of eventTypes) document.removeEventListener(type, onEvent, true) }
      const finish = () => { clearTimeout(quietTimer); clearTimeout(timeout); removeListeners(); resolve(gesture.events.length > 0) }
      const finishAfterQuiet = (delay: number) => { clearTimeout(quietTimer); quietTimer = window.setTimeout(finish, delay) }
      const onEvent = (event: Event) => {
        if (isPanelEvent(event)) return
        const target = event.composedPath().find((item): item is Element => item instanceof Element && !host.contains(item))
        if (!target || !(target === selection.element || selection.element.contains(target))) return
        const now = performance.now()
        if ((event.type === 'pointermove' || event.type === 'mousemove') && now - lastMove < 50) return
        if (event.type === 'pointermove' || event.type === 'mousemove') lastMove = now
        if (!started) {
          started = true
          motionPromise = observeAnimations(selection.element, duration)
          sampledPromise = sample(selection.element, duration, gesture)
          status(`Recording ${recordDuration} seconds of motion…`)
        }
        const selector = getElementSelector(target)
        const entry: NonNullable<typeof gesture.events[number]> = { type: event.type, selector, t: Math.round(now - (gestureStart ?? now)) }
        if (event instanceof PointerEvent) Object.assign(entry, { pointerType: event.pointerType, button: event.button, buttons: event.buttons, clientX: Math.round(event.clientX), clientY: Math.round(event.clientY), altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey })
        else if (event instanceof MouseEvent) Object.assign(entry, { button: event.button, buttons: event.buttons, clientX: Math.round(event.clientX), clientY: Math.round(event.clientY), altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey })
        else if (event instanceof KeyboardEvent) Object.assign(entry, { key: event.key, code: event.code, altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey })
        else if (event instanceof WheelEvent) Object.assign(entry, { clientX: Math.round(event.clientX), clientY: Math.round(event.clientY), deltaX: Math.round(event.deltaX), deltaY: Math.round(event.deltaY), altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey })
        if (gesture.events.length < 64) gesture.events.push(entry)
        if (event.type === 'pointerdown' || event.type === 'mousedown') pointerActive = true
        if (event.type === 'pointerup' || event.type === 'mouseup' || event.type === 'click') { pointerActive = false; finishAfterQuiet(120) }
        else if (event.type === 'keydown') keyActive = true
        else if (event.type === 'keyup') { keyActive = false; finishAfterQuiet(120) }
        else finishAfterQuiet(pointerActive || keyActive ? 1500 : 900)
      }
      let gestureStart: number | undefined
      const timeout = window.setTimeout(() => { removeListeners(); resolve(gesture.events.length > 0) }, 15000)
      gestureStart = performance.now()
      for (const type of eventTypes) document.addEventListener(type, onEvent, true)
    })
    if (!capturedGesture || !enabled || !motionPromise || !sampledPromise) { recording = false; status('No interaction recorded. Select Record next interaction to try again.'); return }
    const [motion, sampled] = await Promise.all([motionPromise, sampledPromise])
    selection.recorded.push(...motion, ...sampled)
    recording = false
    status('Motion recorded. Sampled motion is marked as inferred.')
    draw()
  }
  async function makeCapture(selected: Selection[]): Promise<Capture> {
    return { version: 1, id: crypto.randomUUID(), createdAt: new Date().toISOString(), page: { url: location.href, title: document.title, viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio } }, elements: await Promise.all(selected.map((selection) => {
      const changes = [...(previews.get(selection.element) ?? []), ...(motionChanges.get(selection.ref) ?? [])].map(([property, change]) => `- ${property}: ${change.before} → ${change.after}`)
      const note = [...(comments.get(selection.ref) ?? []).map((comment) => comment.text), selection.note, changes.length ? `Apply these changes to the owning source styles or animation (use the captured viewport as context):\n${changes.join('\n')}` : ''].filter(Boolean).join('\n\n')
      const saved = snapshots.get(selection.ref) ?? []
      return extract({ ...selection, note }).then((node) => ({ ...node, snapshots: saved }))
    })), assets: assets(selected) }
  }
  async function send() {
    const pending = selections.filter((selection) => ready.has(selection.ref) && hasContent(selection))
    if (capturing || recording || !pending.length) return
    clearSampledReplay()
    capturing = true; toolsOpen = false; activeRef = null
    viewOriginal(false)
    try {
      for (let index = 0; index < pending.length; index++) {
        const selection = pending[index]!
        sendingRef = selection.ref
        status(`Sending ${index + 1} of ${pending.length}…`)
        await worker<SavedCapture>({ type: 'capture', ref: selection.ref, mode: 'queue', ...options })
        selection.element.removeAttribute('data-vellum-ref')
        restorePreview(selection.element); previews.delete(selection.element)
        selections.splice(selections.indexOf(selection), 1); ready.delete(selection.ref)
        snapshots.delete(selection.ref); comments.delete(selection.ref); motionChanges.delete(selection.ref); fittedOutlines.delete(selection.ref); pinPositions.delete(selection.ref)
        draw()
      }
      undoSelection = undefined
      restoreAnimations(); hovered = null; picking = true
      status('Queued')
    } catch { status('Couldn’t send. Click the check to retry.', true) }
    finally { capturing = false; sendingRef = undefined; render(); draw() }
  }
  chrome.runtime.onMessage.addListener((message: ContentMessage, _sender, reply) => {
    const handle = async () => {
      switch (message.type) {
        case 'snapshot-state': {
          const selection = selections.find((item) => item.ref === message.ref)
          if (!selection?.element.isConnected) throw new Error('Select the element again.')
          for (const animation of selection.element.getAnimations({ subtree: true })) { saveAnimation(animation, frameAnimations); animation.pause() }
          await new Promise(requestAnimationFrame)
          const node = await extract(selection)
          if (!selection.element.isConnected) throw new Error('Select the element again.')
          const bounds = selection.element.getBoundingClientRect()
          // Chrome screenshot clips use document coordinates, including the page's scroll offset.
          node.box = { x: bounds.x + scrollX, y: bounds.y + scrollY, w: bounds.width, h: bounds.height }
          return { node } satisfies SnapshotStateResult
        }
        case 'ping': return true
        case 'toggle': setEnabled(!enabled); return true
        case 'visibility': host.style.setProperty('visibility', message.hidden ? 'hidden' : 'visible', 'important'); await new Promise(requestAnimationFrame); return true
        case 'extract': {
          const selected = message.ref ? selections.filter((selection) => selection.ref === message.ref) : selections
          if (!selected.length) throw new Error('Select an element before sending.')
          const capture = await makeCapture(selected)
          return { capture, scroll: { x: scrollX, y: scrollY }, files: [...await downloadAssets(capture), ...selected.flatMap((selection) => (snapshots.get(selection.ref) ?? []).map((snapshot) => ({ name: snapshot.image.file, mime: snapshot.image.mime, data: snapshot.image.dataUrl.slice(snapshot.image.dataUrl.indexOf(',') + 1) })))] }
        }
        case 'seek': {
          const selection = selections.find((item) => item.ref === message.ref)
          if (!selection) throw new Error('Select the element again before capturing motion.')
          seek(selection.element, message.progress, frameAnimations)
          await new Promise(requestAnimationFrame)
          if (selection.element.ownerDocument !== document) throw new Error('Open the embedded frame as a page, then capture its elements.')
          const box = getElementBounds(selection.element)
          return { x: box.x + scrollX, y: box.y + scrollY, w: box.width, h: box.height }
        }
        case 'restore-animations': restoreAnimationStates(frameAnimations); render(); return true
        case 'trigger-read': { const selection = selections.find((item) => item.ref === message.ref); return selection ? animations(selection.element, message.trigger) : [] }
        case 'captured': return true
        case 'capture-error': if (sendingRef) status('Couldn’t send. Click the check to retry.', true); return true
      }
    }
    handle().then(reply, (error) => reply({ error: String(error?.message ?? error) }))
    return true
  })
  render()
}
