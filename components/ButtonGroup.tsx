// Arc's joined surface, translated to GPUIX: one measured hover wash, hairline dividers,
// native buttons and sibling popup anchors. No transforms or spring physics.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useGpuixRequired, type KeyEvent, type PublicInstance } from '@gpuix/react'
import { motion } from './spring'
import { Button as Base } from '@gpuix/react/button'
import { FloatingLayer } from '@gpuix/react/floating'
import { controlRadius } from './Button'
import { HoverWash, type WashBox } from './HoverWash'
import { enter, offset, wash } from './motion'
import { Kbd } from './Kbd'
import { tooltipDelay } from './Tooltip'
import { useM } from './theme'

export type ButtonGroupItem = {
  id: string
  label: string
  content: ReactNode
  onPress: () => void
  selected?: boolean
  disabled?: boolean
  shortcut?: string
  popover?: ReactNode
}

export function ButtonGroup({ label, items, testId, height = 28 }: { label: string; items: ButtonGroupItem[]; testId?: string; height?: number }) {
  const m = useM()
  const renderer = useGpuixRequired()
  const root = useRef<PublicInstance>(null)
  const buttons = useRef(new Map<string, PublicInstance>())
  const [hover, setHover] = useState<string | null>(null)
  const [focused, setFocused] = useState<string | null>(null)
  const [pressed, setPressed] = useState<string | null>(null)
  const [tip, setTip] = useState<string | null>(null)
  const [box, setBox] = useState<WashBox | null>(null)
  const selected = items.find((item) => item.selected)?.id
  const active = hover ?? pressed ?? selected ?? focused
  useEffect(() => {
    setTip(null)
    if (!hover || selected) return
    const timer = setTimeout(() => setTip(hover), tooltipDelay)
    return () => clearTimeout(timer)
  }, [hover, selected])
  const labels = items.map((item) => item.label).join('|')
  const measure = useCallback((id: string | null | undefined) => {
    const button = id ? buttons.current.get(id) : undefined
    const outer = root.current && renderer.getElementBounds?.(root.current.id)
    const inner = button && renderer.getElementBounds?.(button.id)
    if (!outer || !inner) return
    const next = { left: inner.x - outer.x + 2, top: 3, width: inner.width - 4, height: height - 6 }
    setBox((before) => before && Object.keys(next).every((key) => before[key as keyof WashBox] === next[key as keyof WashBox]) ? before : next)
  }, [height, renderer])
  useEffect(() => {
    if (!active || !labels) { setBox(null); return }
    // Wait for the native layout, including a model label that has just changed.
    const timer = setTimeout(() => measure(active), 32)
    return () => clearTimeout(timer)
  }, [active, measure, labels])
  const move = (e: KeyEvent, id: string) => {
    const enabled = items.filter((item) => !item.disabled)
    const index = enabled.findIndex((item) => item.id === id)
    const next = e.key === 'home' ? 0 : e.key === 'end' ? enabled.length - 1 : e.key === 'right' ? (index + 1) % enabled.length : e.key === 'left' ? (index + enabled.length - 1) % enabled.length : -1
    const target = enabled[next]
    if (!target) return
    e.preventDefault()
    const button = buttons.current.get(target.id)
    if (button) renderer.focusElement?.(button.id)
  }
  return (
    <div ref={root} testId={testId} role="toolbar" aria-label={label} onMouseLeave={() => { setHover(null); setPressed(null) }} style={{ position: 'relative', display: 'flex', flexDirection: 'row', alignItems: 'center', height, borderWidth: 1, borderColor: m.borderFocused, borderRadius: controlRadius + 1, backgroundColor: m.panel, userSelect: 'none' }}>
      <HoverWash box={box} pressed={Boolean(pressed)} radius={controlRadius - 2} />
      {items.map((item, i) => (
        <div key={item.id} style={{ position: 'relative' }}>
          {i > 0 ? <motion.div initial={false} animate={{ opacity: active === item.id || active === items[i - 1]?.id ? 0 : 1 }} transition={wash()} style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 1, backgroundColor: m.borderFocused, pointerEvents: 'none' }} /> : null}
            <Base
              ref={(node) => { if (node) buttons.current.set(item.id, node); else buttons.current.delete(item.id) }}
              testId={item.id}
              aria-label={item.label}
              disabled={item.disabled}
              onClick={() => { setTip(null); item.onPress() }}
              onMouseEnter={() => { if (!item.disabled) { setHover(item.id); measure(item.id) } }}
              onMouseDown={() => setPressed(item.id)}
              onMouseUp={() => setPressed(null)}
              onFocus={() => { setFocused(item.id); measure(item.id) }}
              onBlur={() => setFocused(null)}
              onKeyDown={(e) => move(e, item.id)}
              style={{ position: 'relative', display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minWidth: height + 2, height: height - 2, paddingLeft: 9, paddingRight: 9, borderRadius: controlRadius, cursor: 'pointer', opacity: item.disabled ? 0.45 : 1, focusVisible: { outlineWidth: 2, outlineColor: m.focusRing, outlineOffset: -2 } }}
            >
              {item.content}
            </Base>
          {tip === item.id && !selected ? (
            <FloatingLayer side="top" align="center" sideOffset={6} style={{ borderRadius: controlRadius, backgroundColor: '#00000000', pointerEvents: 'none' }}>
              <motion.div initial={{ opacity: 0, top: offset.tooltip }} animate={{ opacity: 1, top: 0 }} transition={enter('fast')} style={{ position: 'relative', display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 8, paddingRight: 8, height: 24, borderRadius: controlRadius, borderWidth: 1, borderColor: m.border, backgroundColor: m.popup, pointerEvents: 'none' }}>
                <text style={{ fontSize: 12, lineHeight: 16, color: m.textUi }}>{item.label}</text>
                {item.shortcut ? <Kbd>{item.shortcut}</Kbd> : null}
              </motion.div>
            </FloatingLayer>
          ) : null}
          {item.popover}
        </div>
      ))}
    </div>
  )
}
