import { useLayoutEffect, useRef } from 'react'
import { createDialKit, createDialRoot } from 'dialkit/vanilla'
import type { TransitionConfig } from 'dialkit/vanilla'
import type { CapturePanelProps, SelectedElement } from './CapturePanel'
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
    const kit = createDialKit(props.selection.label, {
      design: {
        outline: { fitOutlineToShape: props.selection.fitOutline },
        colors: {
          color: { type: 'color', default: styles.color }, background: { type: 'color', default: styles.background }, opacity: [number('opacity'), 0, 1, .01],
        },
        shape: { borderColor: { type: 'color', default: styles.borderColor }, borderWidth: px('borderWidth', 24), borderRadius: px('borderRadius') },
        typography: { _collapsed: true, font: { type: 'text', default: styles.font }, fontSize: px('fontSize', 120), fontWeight: { type: 'select', default: styles.fontWeight, options: ['100', '200', '300', '400', '500', '600', '700', '800', '900'] } },
        size: { width: px('width', 1600), height: px('height', 1200) },
        spacing: { _collapsed: true, paddingTop: px('paddingTop'), paddingRight: px('paddingRight'), paddingBottom: px('paddingBottom'), paddingLeft: px('paddingLeft'), marginTop: px('marginTop'), marginRight: px('marginRight'), marginBottom: px('marginBottom'), marginLeft: px('marginLeft') },
      },
      animation: {
        playback: { playing: props.playback.playing, speed: [props.playback.speed, .1, 3, .1] },
        timing: {
          easing: easing(props.playback.easing, props.playback.duration),
          delay: [props.playback.delay, -2000, Math.max(5000, props.playback.delay * 2), 10],
          iterations: { type: 'select', default: props.playback.iterations, options: ['1', '2', '3', '5', '10', { value: 'Infinity', label: 'Loop' }] },
        },
        frames: { progress: [scrubSeconds * props.playback.position / 100, 0, scrubSeconds, .01] },
        recording: { seconds: [props.recordDuration, 1, 60, 1] },
        restart: { type: 'action', label: 'Replay animation' }, record: { type: 'action', label: 'Record next interaction' },
      },
      capture: { _collapsed: true, hoverAndFocus: props.options.triggers, animationFrames: props.options.frames, eventHandlers: props.options.listeners },
    }, { onAction: (action) => {
      if (action === 'animation.record') current.current.onRecord()
      if (action === 'animation.restart') current.current.onReplay()
    } })
    let applying = false
    synchronize.current = (next) => {
      applying = true
      try {
        kit.setValues({
          design: { outline: { fitOutlineToShape: next.selections.find((selection) => selection.ref === next.activeRef)?.fitOutline ?? false } },
          animation: {
            playback: { playing: next.playback.playing, speed: next.playback.speed },
            timing: { easing: easing(next.playback.easing, next.playback.duration), delay: next.playback.delay, iterations: next.playback.iterations },
            frames: { progress: Math.max(.01, next.playback.scrubDuration / 1000) * next.playback.position / 100 },
            recording: { seconds: next.recordDuration },
          },
          capture: { hoverAndFocus: next.options.triggers, animationFrames: next.options.frames, eventHandlers: next.options.listeners },
        })
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
      if (values.capture.hoverAndFocus !== before.capture.hoverAndFocus || values.capture.animationFrames !== before.capture.animationFrames || values.capture.eventHandlers !== before.capture.eventHandlers) current.current.onOptions({ triggers: values.capture.hoverAndFocus, frames: values.capture.animationFrames, listeners: values.capture.eventHandlers })
      if (values.animation.playback.playing !== before.animation.playback.playing) current.current.onPlayback(values.animation.playback.playing)
      if (values.animation.playback.speed !== before.animation.playback.speed) current.current.onSpeed(values.animation.playback.speed)
      if (values.animation.frames.progress !== before.animation.frames.progress) current.current.onSeek(values.animation.frames.progress / Math.max(.01, current.current.playback.scrubDuration / 1000))
      if (values.animation.recording.seconds !== before.animation.recording.seconds) current.current.onRecordDuration(values.animation.recording.seconds)
      const timing = values.animation.timing
      const oldTiming = before.animation.timing
      if (timing.easing !== oldTiming.easing && timing.easing.type === 'easing') {
        current.current.onTiming('easing', cssEasing(timing.easing.ease))
        if (timing.easing.duration !== oldTiming.easing.duration) current.current.onTiming('duration', Math.round(timing.easing.duration * 1000))
      }
      if (timing.delay !== oldTiming.delay) current.current.onTiming('delay', timing.delay)
      if (timing.iterations !== oldTiming.iterations) current.current.onTiming('iterations', timing.iterations)
    }, false)
    const theme = () => surface.dataset.theme === 'light' ? 'light' as const : 'dark' as const
    const editor = createDialRoot({ target: host.current!, mode: 'inline', theme: theme(), productionEnabled: true })
    const observer = new MutationObserver(() => editor.element.dataset.theme = theme())
    observer.observe(surface, { attributes: true, attributeFilter: ['data-theme'] })
    return () => { synchronize.current = null; observer.disconnect(); stop(); editor.destroy(); kit.destroy() }
  }, [props.selection.ref])
  useLayoutEffect(() => { synchronize.current?.(props) }, [props.selection.fitOutline, props.playback.playing, props.playback.speed, props.playback.position, props.playback.duration, props.playback.scrubDuration, props.playback.delay, props.playback.easing, props.playback.iterations, props.recordDuration, props.options.triggers, props.options.frames, props.options.listeners])
  return <div className="vellum-dial-editor" inert={props.capturing || props.recording} ref={host} />
}
