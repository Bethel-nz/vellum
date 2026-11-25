import { useLayoutEffect, useRef } from 'react'
import { createDialKit, createDialRoot } from 'dialkit/vanilla'
import type { TransitionConfig } from 'dialkit/vanilla'
import type { CapturePanelProps, ScriptMotionView, SelectedElement } from './CapturePanel'
import type { MotionEdit } from '../page-motion'
import type { StyleField } from './element-controls'

type Bezier = [number, number, number, number]

function easePoints(value: string): Bezier {
  const match = value.match(/^cubic-bezier\(\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*\)$/)
  if (match) return [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])]
  const presets: Record<string, Bezier> = { linear: [0, 0, 1, 1], ease: [.25, .1, .25, 1], 'ease-in': [.42, 0, 1, 1], 'ease-out': [0, 0, .58, 1], 'ease-in-out': [.42, 0, .58, 1] }
  return presets[value] ?? presets.ease!
}

function easing(value: string, duration: number): TransitionConfig {
  return { type: 'easing', duration: Math.max(.01, duration / 1000), ease: easePoints(value) }
}

function cssEasing(points: Bezier) { return `cubic-bezier(${points.join(', ')})` }

type Slider = [number, number, number, number]
type SelectConfig = { type: 'select'; default: string; options: Array<{ value: string; label: string }> }
/** GSAP's named eases. A site's own (`back.out(1.7)`, or `custom` for a CustomEase) is offered first. */
const GSAP_EASES = ['none', ...['power1', 'power2', 'power3', 'power4', 'back', 'elastic', 'bounce', 'circ', 'expo', 'sine'].flatMap((name) => [`${name}.in`, `${name}.out`, `${name}.inOut`])]
const slider = (value: number, min: number, max: number, step: number): Slider => [value, Math.min(min, value), Math.max(max, value * 2), step]

/** Sliders in the transition's own form, so an edit reads back as the code the site wrote. */
function motionDials(script: ScriptMotionView) {
  const value = (key: string, fallback: number) => { const found = script.values[key]; return typeof found === 'number' ? found : fallback }
  if (script.form === 'duration') return { duration: slider(value('duration', .8), .05, 3, .01), bounce: slider(value('bounce', .3), 0, 1, .01) }
  if (script.form === 'visualDuration') return { visualDuration: slider(value('visualDuration', .3), .05, 3, .01), bounce: slider(value('bounce', .3), 0, 1, .01) }
  if (script.form === 'physics') return { stiffness: slider(value('stiffness', 100), 1, 1000, 1), damping: slider(value('damping', 10), 0, 100, .5), mass: slider(value('mass', 1), .1, 10, .1) }
  if (script.form === 'gsap') {
    const current = typeof script.values.ease === 'string' ? script.values.ease : 'power1.out'
    // Labels are the exact names: a plain string option is title-cased, and ease names are code.
    const names = GSAP_EASES.includes(current) ? GSAP_EASES : [current, ...GSAP_EASES]
    return { duration: slider(value('duration', .5), .05, 5, .01), ease: { type: 'select', default: current, options: names.map((name) => ({ value: name, label: name })) } satisfies SelectConfig }
  }
  const ease = script.values.ease
  return { curve: { type: 'easing', duration: Math.max(.01, value('duration', .3)), ease: (Array.isArray(ease) && ease.length === 4 ? ease : [0, 0, .58, 1]) as Bezier } satisfies TransitionConfig }
}

/** The same folder as plain values, for setValues. */
function motionValues(script: ScriptMotionView) {
  return Object.fromEntries(Object.entries(motionDials(script)).map(([key, dial]) => [key, Array.isArray(dial) ? dial[0] : (dial as { type: string; default?: string }).type === 'select' ? (dial as SelectConfig).default : dial]))
}

function motionEdit(script: ScriptMotionView, values: Record<string, unknown>): MotionEdit | null {
  if (script.form === 'other') return null
  if (script.form === 'gsap') return typeof values.duration === 'number' && typeof values.ease === 'string' ? { form: 'gsap', values: { duration: values.duration, ease: values.ease } } : null
  if (script.form === 'tween') {
    const curve = values.curve as TransitionConfig | undefined
    return curve?.type === 'easing' ? { form: 'tween', values: { duration: curve.duration, ease: [...curve.ease] } } : null
  }
  const numbers = Object.fromEntries(Object.entries(values).filter((entry): entry is [string, number] => typeof entry[1] === 'number'))
  return { form: script.form, values: numbers }
}

export function CaptureDials(props: CapturePanelProps & { selection: SelectedElement }) {
  const host = useRef<HTMLDivElement>(null)
  const scrubSeconds = Math.max(.01, props.playback.scrubDuration / 1000)
  const synchronize = useRef<((next: CapturePanelProps) => void) | null>(null)
  const current = useRef(props)
  current.current = props
  useLayoutEffect(() => {
    const surface = host.current!.closest<HTMLElement>('.vellum-ui')!
    const styles = props.selection.styles
    const number = (key: StyleField) => Number.parseFloat(styles[key]) || 0
    const px = (key: StyleField, max = 200): [number, number, number, number] => [number(key), key.startsWith('margin') ? -200 : 0, Math.max(max, number(key) * 2), 1]
    // Motion found on or around the element gets its own sliders; the CSS playback and timing
    // controls stay only where the element has CSS or Web Animations for them to drive.
    const script = props.selection.script?.editable ? props.selection.script : undefined
    const motionFolder = script?.form === 'tween' || script?.form === 'gsap' ? 'tween' : 'spring'
    const cssMotion = !props.selection.script || props.selection.motion > 0
    const kit = createDialKit(props.selection.label, {
      design: {
        _collapsed: true,
        outline: { _collapsed: true, fitOutlineToShape: props.selection.fitOutline },
        colors: {
          _collapsed: true,
          color: { type: 'color', default: styles.color }, background: { type: 'color', default: styles.background }, opacity: [number('opacity'), 0, 1, .01],
        },
        shape: { _collapsed: true, borderColor: { type: 'color', default: styles.borderColor }, borderWidth: px('borderWidth', 24), borderRadius: px('borderRadius') },
        typography: { _collapsed: true, font: { type: 'text', default: styles.font }, fontSize: px('fontSize', 120), fontWeight: { type: 'select', default: styles.fontWeight, options: ['100', '200', '300', '400', '500', '600', '700', '800', '900'] } },
        size: { _collapsed: true, width: px('width', 1600), height: px('height', 1200) },
        spacing: { _collapsed: true, paddingTop: px('paddingTop'), paddingRight: px('paddingRight'), paddingBottom: px('paddingBottom'), paddingLeft: px('paddingLeft'), marginTop: px('marginTop'), marginRight: px('marginRight'), marginBottom: px('marginBottom'), marginLeft: px('marginLeft') },
      },
      animation: {
        _collapsed: !script,
        ...(script ? { [motionFolder]: motionDials(script) } : {}),
        ...(cssMotion ? {
          playback: { _collapsed: true, playing: props.playback.playing, speed: [props.playback.speed, .1, 3, .1] },
          timing: {
            _collapsed: true,
            easing: easing(props.playback.easing, props.playback.duration),
            delay: [props.playback.delay, -2000, Math.max(5000, props.playback.delay * 2), 10],
            iterations: { type: 'select', default: props.playback.iterations, options: ['1', '2', '3', '5', '10', { value: 'Infinity', label: 'Loop' }] },
          },
        } : {}),
        frames: { _collapsed: true, progress: [scrubSeconds * props.playback.position / 100, 0, scrubSeconds, .01] },
        recording: { _collapsed: true, seconds: [props.recordDuration, 1, 60, 1] },
        restart: { type: 'action', label: 'Replay' }, record: { type: 'action', label: 'Record' },
      },
      capture: { _collapsed: true, hoverAndFocus: props.options.triggers, animationFrames: props.options.frames, eventHandlers: props.options.listeners, relatedElements: props.options.related },
    }, { onAction: (action) => {
      if (action === 'animation.record') current.current.onRecord()
      if (action === 'animation.restart') current.current.onReplay()
    } })
    let applying = false
    synchronize.current = (next) => {
      const nextScript = next.selections.find((selection) => selection.ref === next.activeRef)?.script
      applying = true
      try {
        // The animation folder's shape depends on what the element has, which the inferred type can't follow.
        kit.setValues({
          design: { outline: { fitOutlineToShape: next.selections.find((selection) => selection.ref === next.activeRef)?.fitOutline ?? false } },
          animation: {
            ...(cssMotion ? {
              playback: { playing: next.playback.playing, speed: next.playback.speed },
              timing: { easing: easing(next.playback.easing, next.playback.duration), delay: next.playback.delay, iterations: next.playback.iterations },
            } : {}),
            ...(script && nextScript?.editable && nextScript.form === script.form ? { [motionFolder]: motionValues(nextScript) } : {}),
            frames: { progress: Math.max(.01, next.playback.scrubDuration / 1000) * next.playback.position / 100 },
            recording: { seconds: next.recordDuration },
          },
          capture: { hoverAndFocus: next.options.triggers, animationFrames: next.options.frames, eventHandlers: next.options.listeners, relatedElements: next.options.related },
        } as Parameters<typeof kit.setValues>[0])
      } finally { applying = false }
    }
    let previous = kit.getValues()
    const stop = kit.subscribe((values) => {
      const before = previous
      previous = values
      if (applying) return
      if (values.design.outline.fitOutlineToShape !== before.design.outline.fitOutlineToShape) current.current.onFitOutline(values.design.outline.fitOutlineToShape)
      for (const group of ['colors', 'shape', 'typography', 'size', 'spacing'] as const) {
        for (const [key, value] of Object.entries(values.design[group])) {
          if (key === '_collapsed' || value === (before.design[group] as Record<string, unknown>)[key]) continue
          const css = typeof value === 'number' && key !== 'opacity' ? `${value}px` : String(value)
          current.current.onStyle(key as StyleField, css)
        }
      }
      if (values.capture.hoverAndFocus !== before.capture.hoverAndFocus || values.capture.animationFrames !== before.capture.animationFrames || values.capture.eventHandlers !== before.capture.eventHandlers || values.capture.relatedElements !== before.capture.relatedElements) current.current.onOptions({ triggers: values.capture.hoverAndFocus, frames: values.capture.animationFrames, listeners: values.capture.eventHandlers, related: values.capture.relatedElements })
      const animation = values.animation as Record<string, any>
      const previousAnimation = before.animation as Record<string, any>
      if (script) {
        const folder = animation[motionFolder] as Record<string, unknown>
        const previousFolder = previousAnimation[motionFolder] as Record<string, unknown>
        if (Object.keys(folder).some((key) => key !== '_collapsed' && folder[key] !== previousFolder[key])) {
          const edit = motionEdit(script, folder)
          if (edit) current.current.onMotion(edit)
        }
      }
      if (!cssMotion) {
        if (values.animation.frames.progress !== before.animation.frames.progress) current.current.onSeek(values.animation.frames.progress / Math.max(.01, current.current.playback.scrubDuration / 1000))
        if (values.animation.recording.seconds !== before.animation.recording.seconds) current.current.onRecordDuration(values.animation.recording.seconds)
        return
      }
      if (animation.playback.playing !== previousAnimation.playback.playing) current.current.onPlayback(animation.playback.playing)
      if (animation.playback.speed !== previousAnimation.playback.speed) current.current.onSpeed(animation.playback.speed)
      if (values.animation.frames.progress !== before.animation.frames.progress) current.current.onSeek(values.animation.frames.progress / Math.max(.01, current.current.playback.scrubDuration / 1000))
      if (values.animation.recording.seconds !== before.animation.recording.seconds) current.current.onRecordDuration(values.animation.recording.seconds)
      const timing = animation.timing
      const oldTiming = previousAnimation.timing
      if (timing.easing !== oldTiming.easing && timing.easing.type === 'easing') {
        current.current.onTiming('easing', cssEasing(timing.easing.ease))
        if (timing.easing.duration !== oldTiming.easing.duration) current.current.onTiming('duration', Math.round(timing.easing.duration * 1000))
      }
      if (timing.delay !== oldTiming.delay) current.current.onTiming('delay', timing.delay)
      if (timing.iterations !== oldTiming.iterations) current.current.onTiming('iterations', timing.iterations)
    }, false)
    const theme = () => surface.dataset.theme === 'light' ? 'light' as const : 'dark' as const
    const editor = createDialRoot({ target: host.current!, mode: 'inline', theme: theme(), productionEnabled: true })
    // DialKit closes a dropdown on a document pointerdown whose target is outside it. From inside Snapshot's
    // shadow root that target is the shadow host, so every press on an option read as outside: the list
    // closed before the option's click and no choice was ever made. Presses inside a list stop here.
    const keepDropdown = (event: PointerEvent) => { if ((event.target as Element | null)?.closest?.('.dialkit-select-dropdown, .dialkit-preset-dropdown, .dialkit-shortcuts-dropdown')) event.stopPropagation() }
    host.current!.addEventListener('pointerdown', keepDropdown)
    const observer = new MutationObserver(() => editor.element.dataset.theme = theme())
    observer.observe(surface, { attributes: true, attributeFilter: ['data-theme'] })
    const target = host.current!
    return () => { target.removeEventListener('pointerdown', keepDropdown); synchronize.current = null; observer.disconnect(); stop(); editor.destroy(); kit.destroy() }
  }, [props.selection.ref])
  useLayoutEffect(() => { synchronize.current?.(props) }, [JSON.stringify(props.selection.script?.values ?? null), props.selection.fitOutline, props.playback.playing, props.playback.speed, props.playback.position, props.playback.duration, props.playback.scrubDuration, props.playback.delay, props.playback.easing, props.playback.iterations, props.recordDuration, props.options.triggers, props.options.frames, props.options.listeners, props.options.related])
  return <div className="vellum-dial-editor" inert={props.capturing || props.recording} ref={host} />
}
