// A press-to-confirm pill. Width reveals each face; text and corners never scale.
// Pending/result faces follow real callbacks. No elevation, blur, rotation or spring physics.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useGpuixRequired, type PublicInstance } from '@gpuix/react'
import { motion } from './spring'
import { Button as Base } from '@gpuix/react/button'
import { Dot } from './Dot'
import { Icon } from './Icon'
import { enter, spring, tween, useReducedMotion } from './motion'
import { useM } from './theme'

export type ConfirmMorphState = 'idle' | 'confirming' | 'pending' | 'done' | 'error'
type Props = {
  label: string
  prompt: string
  confirmLabel?: string
  pendingLabel?: string
  doneLabel?: string
  errorLabel?: string
  onConfirm: () => unknown
  onUndo?: () => unknown
  onCancel?: () => void
  onStateChange?: (state: ConfirmMorphState) => void
  defaultState?: ConfirmMorphState
  /** Only for a confirmation deliberately opened by the user's close action. */
  autoFocus?: boolean
  confirmTimeout?: number
  resultTimeout?: number
  testId?: string
}
const ARM_MS = 280
const HEIGHT = 32

export function ConfirmMorph({ label, prompt, confirmLabel = 'Confirm', pendingLabel = 'Thinking…', doneLabel = 'Done', errorLabel = 'Couldn’t finish', onConfirm, onUndo, onCancel, onStateChange, defaultState = 'idle', autoFocus = false, confirmTimeout = 6000, resultTimeout = 5000, testId = 'confirm-morph' }: Props) {
  const m = useM()
  const renderer = useGpuixRequired()
  const reduced = useReducedMotion()
  const [state, setState] = useState<ConfirmMorphState>(defaultState)
  const stateRef = useRef(state)
  const root = useRef<PublicInstance>(null)
  const primary = useRef<PublicInstance>(null)
  const secondary = useRef<PublicInstance>(null)
  const sizers = useRef(new Map<string, PublicInstance>())
  const [sizes, setSizes] = useState<Record<string, number>>({})
  const [hover, setHover] = useState(false)
  const armedAt = useRef(Date.now())
  const focusWanted = useRef(autoFocus)
  const run = useRef(0)
  const working = useRef(false)
  const mounted = useRef(true)
  const callbacks = useRef({ onConfirm, onUndo, onCancel, onStateChange })
  callbacks.current = { onConfirm, onUndo, onCancel, onStateChange }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; run.current++ } }, [])

  const move = useCallback((next: ConfirmMorphState) => {
    const focused = renderer.getFocusedElementId?.()
    if (focused && [root.current?.id, primary.current?.id, secondary.current?.id].includes(focused)) focusWanted.current = true
    if (next === 'confirming') armedAt.current = Date.now()
    stateRef.current = next
    setState(next)
    callbacks.current.onStateChange?.(next)
  }, [renderer])
  const cancel = useCallback(() => {
    if (working.current) return
    move('idle')
    callbacks.current.onCancel?.()
  }, [move])
  const perform = async (undo = false) => {
    if (working.current) return
    working.current = true
    const token = ++run.current
    try {
      const result = undo ? callbacks.current.onUndo?.() : callbacks.current.onConfirm()
      if (result instanceof Promise) { move('pending'); await result }
      if (!mounted.current || token !== run.current) return
      working.current = false
      move(undo ? 'idle' : 'done')
    } catch {
      if (!mounted.current || token !== run.current) return
      working.current = false
      move('error')
    }
  }
  useEffect(() => {
    if (!focusWanted.current) return
    focusWanted.current = false
    const timer = setTimeout(() => {
      // Async completion only moves focus if it still belongs to this control.
      const target = state === 'pending' || (state === 'done' && !onUndo) ? root.current : primary.current
      if (target) renderer.focusElement?.(target.id)
    }, 32)
    return () => clearTimeout(timer)
  }, [state, onUndo, renderer])
  const timeout = state === 'confirming' ? confirmTimeout : state === 'done' || state === 'error' ? resultTimeout : 0
  useEffect(() => {
    if (!timeout || hover) return
    const timer = setTimeout(() => state === 'confirming' ? cancel() : move('idle'), timeout)
    return () => clearTimeout(timer)
  }, [timeout, hover, cancel, move, state])

  const words = { label, prompt, confirmLabel, pendingLabel, doneLabel, errorLabel, cancel: 'Cancel', undo: 'Undo', retry: 'Retry' }
  const wordKey = JSON.stringify(words)
  useEffect(() => {
    if (!wordKey) return
    const timer = setTimeout(() => {
      const next: Record<string, number> = {}
      for (const [key, node] of sizers.current) {
        const box = renderer.getElementBounds?.(node.id)
        if (box?.width) next[key] = box.width
      }
      setSizes(next)
    }, 32)
    return () => clearTimeout(timer)
  }, [wordKey, renderer])
  const widthOf = (key: keyof typeof words) => sizes[key] ?? words[key].length * 6.3
  const promptWidth = Math.min(192, widthOf('prompt'))
  const idleWidth = widthOf('label') + 56
  const widths = {
    idle: idleWidth,
    confirming: promptWidth + widthOf('cancel') + widthOf('confirmLabel') + 80,
    pending: widthOf('pendingLabel') + 48,
    done: widthOf('doneLabel') + 52 + (onUndo ? widthOf('undo') + 30 : 0),
    error: widthOf('errorLabel') + widthOf('retry') + 78,
  }
  const ask = () => move('confirming')
  const answer = () => { if (Date.now() - armedAt.current >= ARM_MS) void perform() }
  const buttonStyle = { height: 24, paddingLeft: 12, paddingRight: 12, borderRadius: 12, display: 'flex' as const, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, flexShrink: 0, hover: { backgroundColor: m.hover }, active: { backgroundColor: m.pressed }, focusVisible: { backgroundColor: m.selected } }
  const textStyle = { fontSize: 12.5, lineHeight: 18, fontWeight: 500 as const, whiteSpace: 'nowrap' as const }
  return (
    // biome-ignore lint/a11y/useSemanticElements: GPUIX exposes native groups through div; fieldset is not a host element.
    <div ref={root} testId={testId} role="group" aria-label={state === 'confirming' ? prompt : label} aria-busy={state === 'pending'} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onMouseDownOutside={() => { if (stateRef.current === 'confirming') cancel() }} onKeyDown={(event) => {
      if (event.key !== 'escape' || state === 'pending') return
      event.preventDefault()
      event.stopPropagation()
      if (state === 'confirming') cancel(); else move('idle')
    }} style={{ position: 'relative', alignSelf: 'start' }}>
      <div aria-hidden style={{ position: 'absolute', left: 0, top: 0, width: 600, opacity: 0, pointerEvents: 'none', display: 'flex', flexDirection: 'column', alignItems: 'start' }}>
        {Object.entries(words).map(([key, word]) => <text key={key} ref={(node) => { if (node) sizers.current.set(key, node); else sizers.current.delete(key) }} style={{ ...textStyle, flexShrink: 0 }}>{word}</text>)}
      </div>
      <motion.div initial={reduced ? false : { width: idleWidth }} animate={{ width: widths[state] }} transition={tween(state === 'idle' ? spring.smooth : spring.morph)} style={{ height: HEIGHT, minWidth: 0, overflow: 'hidden', borderRadius: HEIGHT / 2, backgroundColor: m.popup, borderWidth: 1, borderColor: m.borderFocused, pointerEvents: 'none' }}>
        <div style={{ height: HEIGHT - 2, display: 'flex', flexDirection: 'row', alignItems: 'center', pointerEvents: 'auto' }}>
          {state === 'idle' ? (
            <Base ref={primary} onClick={ask} testId={`${testId}-trigger`} style={{ ...buttonStyle, height: HEIGHT - 2, paddingLeft: 14, paddingRight: 16, gap: 8 }}><Icon name="x" size={16} /><text style={{ ...textStyle, color: m.text }}>{label}</text></Base>
          ) : state === 'confirming' ? (
            <>
              <motion.div key="question" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={enter('fast')} style={{ width: promptWidth + 20, paddingLeft: 12, paddingRight: 8, flexShrink: 0 }}><text style={{ ...textStyle, color: m.text, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{prompt}</text></motion.div>
              <Base ref={secondary} onClick={cancel} testId={`${testId}-cancel`} style={buttonStyle}><text style={{ ...textStyle, color: m.textMuted }}>Cancel</text></Base>
              <Base ref={primary} onClick={answer} testId={`${testId}-confirm`} style={{ ...buttonStyle, marginLeft: 2, backgroundColor: m.dangerBg }}><text style={{ ...textStyle, color: m.danger }}>{confirmLabel}</text></Base>
            </>
          ) : (
            <>
              <motion.div key={state} initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={enter('fast')} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 12, paddingRight: 12, flexShrink: 0 }}>
                {state === 'pending' ? <Dot color={m.textMuted} size={6} pulse /> : <Icon name={state === 'done' ? 'check' : 'circleX'} size={18} color={state === 'done' ? m.success : m.danger} />}
                <div role="status"><text style={{ ...textStyle, color: state === 'pending' ? m.textMuted : m.text }}>{state === 'pending' ? pendingLabel : state === 'done' ? doneLabel : errorLabel}</text></div>
              </motion.div>
              {state === 'done' && onUndo ? <Base ref={primary} onClick={() => void perform(true)} testId={`${testId}-undo`} style={buttonStyle}><text style={{ ...textStyle, color: m.text }}>Undo</text></Base> : state === 'error' ? <Base ref={primary} onClick={() => void perform()} testId={`${testId}-retry`} style={buttonStyle}><text style={{ ...textStyle, color: m.text }}>Retry</text></Base> : null}
            </>
          )}
        </div>
      </motion.div>
    </div>
  )
}
