// Arc's expanding pill, using the same width tween as the tab strip. The icon keeps its
// inset while the label is revealed by clipping; the native button owns every press.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motion, useGpuixRequired, type EventPayload, type KeyEvent, type PublicInstance } from '@gpuix/react'
import { Button as Base } from '@gpuix/react/button'
import { enter, leave, spring, tween, useReducedMotion } from './motion'
import { useM } from './theme'

export type ExpandingButtonGroupItem = {
  id: string
  label: string
  detail?: string
  icon: ReactNode
  ariaLabel?: string
  onPress: () => void
  selected?: boolean
  disabled?: boolean
  popover?: ReactNode
}

// The status bar keeps its 28px outer height. Arc's 3px surround and fixed icon inset
// leave a 22px inner pill, matching the rest of Vellum's compact controls.
const height = 22
const inset = 4
const iconSize = 14
const gap = 5
const end = 8
const hysteresis = 4

export function ExpandingButtonGroup({ label, items, defaultExpanded, testId }: { label: string; items: ExpandingButtonGroupItem[]; defaultExpanded?: string; testId?: string }) {
  const m = useM()
  const renderer = useGpuixRequired()
  const buttons = useRef(new Map<string, PublicInstance>())
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const mouseFocus = useRef<number | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [focused, setFocused] = useState<string | null>(null)
  const rest = items.find((item) => item.id === defaultExpanded)?.id ?? items.find((item) => !item.disabled)?.id
  const selected = items.find((item) => item.selected)?.id
  const expanded = selected ?? hover ?? focused ?? rest

  useEffect(() => {
    // Native div buttons don't consistently emit focus/blur for Tab or focusElement.
    // Read focus without moving it, and avoid treating a mouse press as keyboard intent.
    const timer = setInterval(() => {
      const id = renderer.getFocusedElementId?.()
      const next = id && id !== mouseFocus.current ? [...buttons.current].find(([, node]) => node.id === id)?.[0] ?? null : null
      setFocused((current) => current === next ? current : next)
    }, 100)
    return () => clearInterval(timer)
  }, [renderer])

  const move = (event: EventPayload) => {
    if (event.x === undefined || event.y === undefined) return
    const { x, y } = event
    const before = pointer.current
    // Layout can move a neighbour beneath a stationary pointer. Only actual pointer travel
    // changes the expansion, with a small inset to keep boundaries from trading places.
    if (before && Math.abs(before.x - x) < 1 && Math.abs(before.y - y) < 1) return
    pointer.current = { x, y }
    for (const [id, node] of buttons.current) {
      const box = renderer.getElementBounds?.(node.id)
      if (!box || x < box.x || x > box.x + box.width || y < box.y || y > box.y + box.height) continue
      if (id === hover || (hover && (x < box.x + hysteresis || x > box.x + box.width - hysteresis))) return
      setHover(id)
      return
    }
  }
  const navigate = (event: KeyEvent, id: string) => {
    mouseFocus.current = null
    const index = items.findIndex((item) => item.id === id)
    const next = event.key === 'home' ? 0 : event.key === 'end' ? items.length - 1 : event.key === 'right' ? (index + 1) % items.length : event.key === 'left' ? (index + items.length - 1) % items.length : -1
    const button = items[next] && buttons.current.get(items[next].id)
    if (!button) return
    event.preventDefault()
    setHover(null)
    setFocused(items[next].id)
    renderer.focusElement?.(button.id)
  }
  return (
    <div testId={testId} role="toolbar" aria-label={label} onMouseMove={move} onMouseLeave={() => { pointer.current = null; setHover(null) }} style={{ position: 'relative', display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 2, padding: 2, flexShrink: 0, borderWidth: 1, borderColor: m.border, borderRadius: 14, backgroundColor: m.panel, userSelect: 'none' }}>
      {items.map((item) => (
        <div key={item.id} style={{ position: 'relative' }}>
          <ExpandingItem item={item} expanded={expanded === item.id} />
          {/* GPUIX motion nodes consume native presses even inside a button. Keep the
              actual button above the animated visual, with the same live bounds. */}
          <Base
            ref={(node) => { if (node) buttons.current.set(item.id, node); else buttons.current.delete(item.id) }}
            testId={item.id}
            aria-label={item.ariaLabel ?? item.label}
            aria-disabled={item.disabled}
            aria-expanded={item.selected}
            disabled={item.disabled}
            focusableWhenDisabled
            onMouseDown={() => { mouseFocus.current = buttons.current.get(item.id)?.id ?? null }}
            onMouseMove={move}
            onFocus={() => { if (mouseFocus.current !== buttons.current.get(item.id)?.id) setFocused(item.id) }}
            onBlur={() => setFocused((current) => current === item.id ? null : current)}
            onKeyDown={(event) => navigate(event, item.id)}
            onClick={item.onPress}
            style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: height / 2, cursor: item.disabled ? 'default' : 'pointer', active: item.disabled ? undefined : { backgroundColor: m.pressed }, focusVisible: { outlineWidth: 2, outlineColor: m.focusRing, outlineOffset: -2 } }}
          >
            <text aria-hidden style={{ opacity: 0, pointerEvents: 'none', fontSize: 12, whiteSpace: 'nowrap' }}>{item.detail ? `${item.label} ${item.detail}` : item.label}</text>
          </Base>
          {item.popover}
        </div>
      ))}
    </div>
  )
}

function ExpandingItem({ item, expanded }: { item: ExpandingButtonGroupItem; expanded: boolean }) {
  const m = useM()
  const renderer = useGpuixRequired()
  useReducedMotion()
  const sizer = useRef<PublicInstance>(null)
  const [measured, setMeasured] = useState(0)
  const label = item.detail ? `${item.label}  ${item.detail}` : item.label
  useEffect(() => {
    if (!label) { setMeasured(0); return }
    const timer = setTimeout(() => {
      const box = sizer.current && renderer.getElementBounds?.(sizer.current.id)
      if (box?.width) setMeasured((before) => Math.abs(before - box.width) < 0.5 ? before : box.width)
    }, 32)
    return () => clearTimeout(timer)
  }, [label, renderer])
  const textWidth = measured || label.length * 6
  const width = expanded ? inset + iconSize + gap + textWidth + end : height
  return (
    <>
      {/* A fixed-width measuring row keeps the label's intrinsic width outside the clip. */}
      <div aria-hidden style={{ position: 'absolute', left: 0, top: 0, width: 600, opacity: 0, pointerEvents: 'none', display: 'flex', flexDirection: 'row' }}>
        <text ref={sizer} style={{ flexShrink: 0, fontSize: 12, lineHeight: 16, fontWeight: 500, whiteSpace: 'nowrap' }}>{label}</text>
      </div>
      <motion.div initial={false} animate={{ width }} transition={tween(measured ? spring.morph : { duration: 0 })} style={{ position: 'relative', height, minWidth: height, overflow: 'hidden', borderRadius: height / 2, pointerEvents: 'none', opacity: item.disabled ? 0.5 : 1, backgroundColor: expanded ? m.selected : '#00000000' }}>
        <div style={{ position: 'absolute', left: inset, top: (height - iconSize) / 2, width: iconSize, height: iconSize, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{item.icon}</div>
        <motion.div initial={false} animate={{ opacity: expanded ? 1 : 0, left: inset + iconSize + (expanded ? gap : 0) }} transition={expanded ? enter() : leave('instant')} style={{ position: 'absolute', top: 3, width: textWidth, height: 16, pointerEvents: 'none' }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}><text style={{ fontSize: 12, lineHeight: 16, fontWeight: 500, color: m.textUi, whiteSpace: 'nowrap', flexShrink: 0 }}>{item.label}</text>{item.detail ? <text style={{ fontSize: 12, lineHeight: 16, color: m.textMuted, whiteSpace: 'nowrap', flexShrink: 0 }}>{item.detail}</text> : null}</div>
        </motion.div>
      </motion.div>
    </>
  )
}
