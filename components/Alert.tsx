// Arc's persistent, in-flow alert. The flat surface can collapse with its content;
// elevated wrappers (such as tab attention) still close atomically.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motion, useGpuixRequired, useWindowSize, type PublicInstance } from '@gpuix/react'
import { radiusBase } from '../ui/theme'
import { Button } from './Button'
import { Icon } from './Icon'
import { duration, enter, leave, offset, spring, tween, useReducedMotion } from './motion'
import { useM } from './theme'

export type AlertTone = 'info' | 'success' | 'warning' | 'danger'
export type AlertProps = {
  title: string
  tone?: AlertTone
  children?: ReactNode
  open?: boolean
  onDismiss?: () => void
  testId?: string
}

export function Alert({ title, tone = 'info', children, open, onDismiss, testId }: AlertProps) {
  const m = useM()
  const renderer = useGpuixRequired()
  const reduced = useReducedMotion()
  const window = useWindowSize()
  const body = useRef<PublicInstance>(null)
  const [dismissed, setDismissed] = useState(false)
  const dismissCallback = useRef(onDismiss)
  dismissCallback.current = onDismiss
  const visible = open ?? !dismissed
  const [present, setPresent] = useState(visible)
  const [height, setHeight] = useState<number | undefined>(undefined)
  useEffect(() => {
    if (visible) { setPresent(true); return }
    const timer = setTimeout(() => {
      setPresent(false)
      if (open === undefined) dismissCallback.current?.()
    }, reduced ? 0 : duration.exit * 1000)
    return () => clearTimeout(timer)
  }, [visible, reduced, open])
  // biome-ignore lint/correctness/useExhaustiveDependencies: Content and window changes require a fresh native layout measurement.
  useEffect(() => {
    if (!present) return
    const timer = setTimeout(() => {
      const box = body.current && renderer.getElementBounds?.(body.current.id)
      if (box?.height) setHeight((before) => before === box.height ? before : box.height)
    }, 32)
    return () => clearTimeout(timer)
  }, [title, children, window.width, present, renderer])
  if (!visible && (!present || reduced)) return null
  const color = { info: m.blue, success: m.success, warning: m.warning, danger: m.danger }[tone]
  const icon = { info: 'info', success: 'check', warning: 'warning', danger: 'circleX' } as const
  const details = typeof children === 'string' ? children : undefined
  return (
    <motion.div initial={reduced ? false : { opacity: 0 }} animate={{ opacity: visible ? 1 : 0, ...(height === undefined ? {} : { height: visible ? height : 0 }) }} transition={visible ? tween(spring.smooth) : leave()} style={{ display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
      <div ref={body} testId={testId} role={tone === 'danger' ? 'alert' : 'status'} style={{ display: 'flex', flexDirection: 'row', alignItems: 'start', gap: 12, padding: 16, flexShrink: 0, borderWidth: 1, borderColor: m.border, borderRadius: radiusBase, backgroundColor: m.panel }}>
        <motion.div key={tone} initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={enter('fast')} style={{ width: 18, height: 18, marginTop: 1, flexShrink: 0, pointerEvents: 'none' }}><Icon name={icon[tone]} size={18} color={color} /></motion.div>
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0, gap: 4 }}>
          <motion.div key={title} initial={reduced ? false : { opacity: 0, top: offset.tooltip }} animate={{ opacity: 1, top: 0 }} transition={enter()} style={{ position: 'relative', pointerEvents: 'none' }}>
            <text style={{ fontSize: 13, lineHeight: 19, fontWeight: 500, color: tone === 'danger' ? m.danger : m.text }}>{title}</text>
          </motion.div>
          {details ? <motion.div key={details} initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={enter()}><text style={{ fontSize: 12, lineHeight: 18, color: m.textMuted }}>{details}</text></motion.div> : children}
        </div>
        {onDismiss ? <Button title={`Dismiss: ${title}`} testId={testId ? `${testId}-dismiss` : 'alert-dismiss'} onPress={() => open === undefined ? setDismissed(true) : onDismiss()} style={{ width: 28, height: 28, minHeight: 28, paddingLeft: 0, paddingRight: 0, marginTop: -5, marginRight: -6, marginBottom: -5, borderRadius: 14 }}><Icon name="x" size={16} color={m.textFaint} /></Button> : null}
      </div>
    </motion.div>
  )
}
