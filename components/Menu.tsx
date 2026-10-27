// A dropdown menu, after arc's dropdown-menu and Glass's account menu.
//
// Motion (arc): the panel arrives from the trigger side (opacity + 5px offset, `fast` on the enter
// curve), rows follow with a 35ms stagger capped at four, and one highlight glides between rows on
// the snappy curve. The keyboard moves the highlight instantly.
//
// Close is instant: no AnimatePresence exit. An exit phase keeps the panel mounted for a fade,
// and the elevation shadow outlives the background fade — a dark pane ghosting over the desktop
// (the reason the context card removes itself straight out; macOS closes menus instantly too).
//
// Render it inside a `position: relative` wrapper next to its trigger; it anchors to that wrapper.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { DismissableLayer, type KeyEvent, type PublicInstance } from '@gpuix/react'
import { motion } from './spring'
import { FloatingLayer } from '@gpuix/react/floating'
import { Button as Base } from '@gpuix/react/button'
import { concentric, elevation, radiusBase } from '../ui/theme'
import { Lifted } from './Lifted'
import { PopoverBackdrop } from './PopoverBackdrop'
import type { IconName } from '../ui/icons'
import { Icon } from './Icon'
import { Kbd } from './Kbd'
import { duration, ease, offset, spring, stagger, tween } from './motion'
import { useM } from './theme'

export type MenuItem =
  | {
      kind?: 'item'
      label: string
      onSelect: () => void
      icon?: IconName
      /** A colour dot instead of an icon (accounts). */
      dot?: string
      /** An image file instead of an icon (an app's own icon); '' while it loads. */
      image?: string
      hint?: string
      shortcut?: string
      checked?: boolean
      destructive?: boolean
      disabled?: boolean
      testId?: string
    }
  | { kind: 'separator' }
  | { kind: 'label'; label: string }

const ROW = 28
const SEPARATOR = 9
const LABEL = 24
const PAD = 5

const heightOf = (it: MenuItem) => (it.kind === 'separator' ? SEPARATOR : it.kind === 'label' ? LABEL : ROW)
const selectable = (it: MenuItem) => (it.kind ?? 'item') === 'item' && !(it as { disabled?: boolean }).disabled

/** Search inputs use their native submit event to choose the keyboard-highlighted item. */
type MenuHeader = ReactNode | ((submit: () => void) => ReactNode)

let outsideCloseAt = 0
let outsideCloseKey: string | null = null
/**
 * True right after a menu closed on a press outside it. A press on the menu's own trigger is
 * outside it too: the menu closes on mouse-down, then the trigger's click would open it again.
 * Triggers check their own key so a second click closes the menu — and one menu closing doesn't
 * eat the click that opens another trigger (that used to need a second click).
 */
export const closedByOutsidePress = (key?: string) => {
  const hit = Date.now() - outsideCloseAt < 250 && (outsideCloseKey === null || key === undefined || key === outsideCloseKey)
  // It answers once, for the press that closed the menu: a quick click after that opens it
  // again (ten rapid clicks used to leave it in the wrong state; scripts/check-motion.ts).
  if (hit) outsideCloseAt = 0
  return hit
}
/** For popovers that aren't a Menu but close the same way (the context card). */
export const markOutsideClose = (key?: string) => {
  outsideCloseAt = Date.now()
  outsideCloseKey = key ?? null
}

export function Menu({
  open,
  onClose,
  items,
  header,
  width = 240,
  side = 'bottom',
  align = 'start',
  testId,
  closeKey,
}: {
  open: boolean
  onClose: () => void
  items: MenuItem[]
  header?: MenuHeader
  width?: number
  side?: 'top' | 'bottom'
  align?: 'start' | 'end'
  testId?: string
  /** Identifies this menu in the outside-press guard (Status bar keys: mode / model). */
  closeKey?: string
}) {
  if (!open) return null
  return <MenuPanel key="menu" onClose={onClose} items={items} header={header} width={width} side={side} align={align} testId={testId} closeKey={closeKey} />
}

function MenuPanel({ onClose, items, header, width, side, align, testId }: { onClose: () => void; items: MenuItem[]; header?: MenuHeader; width: number; side: 'top' | 'bottom'; align: 'start' | 'end'; testId?: string; closeKey?: string }) {
  const m = useM()
  const panel = useRef<PublicInstance>(null)
  const [active, setActive] = useState(-1)
  const [glide, setGlide] = useState(false)
  const [headerHeight, setHeaderHeight] = useState(0)

  const tops: number[] = []
  let y = PAD + headerHeight
  for (const it of items) {
    tops.push(y)
    y += heightOf(it)
  }

  const move = (step: number) => {
    if (!items.some(selectable)) return
    let i = active
    for (let n = 0; n < items.length; n++) {
      i = (i + step + items.length) % items.length
      if (selectable(items[i]!)) break
    }
    setGlide(false)
    setActive(i)
  }
  const pick = (i: number) => {
    const it = items[i]
    if (!it || !selectable(it)) return
    onClose()
    ;(it as { onSelect: () => void }).onSelect()
  }
  const onKeyDown = (e: KeyEvent) => {
    if (e.key === 'down' || (e.modifiers?.ctrl && e.key === 'n')) {
      e.preventDefault()
      move(1)
    } else if (e.key === 'up' || (e.modifiers?.ctrl && e.key === 'p')) {
      e.preventDefault()
      move(-1)
    } else if (e.key === 'enter' || e.key === 'space') {
      e.preventDefault()
      pick(active)
    }
  }
  useEffect(() => setActive(-1), [items.length])

  const hi = items[active]
  const danger = hi && (hi.kind ?? 'item') === 'item' && (hi as { destructive?: boolean }).destructive
  const from = side === 'bottom' ? -offset.menu : offset.menu
  const rows = items.filter((it) => (it.kind ?? 'item') === 'item').length
  let row = 0
  return (
    <DismissableLayer onEscapeKeyDown={onClose} initialFocus={() => panel.current?.id ?? null}>
      {/* The native anchored surface needs its own radius as well as the painted panel. */}
      <FloatingLayer side={side} align={align} sideOffset={6} style={{ width, borderRadius: radiusBase + PAD, backgroundColor: '#00000000' }}>
        <PopoverBackdrop onClose={onClose} testId={testId ? `${testId}-backdrop` : undefined} />
        {/* The plain div owns focus, keys and outside clicks; motion.div only animates. */}
        <div ref={panel} role="menu" testId={testId} tabIndex={0} onKeyDown={onKeyDown} onMouseLeave={() => setActive(-1)} style={{ position: 'relative', keyboardFocusDim: false }}>
        <Lifted
          initial={{ opacity: 0, top: from }}
          animate={{ opacity: 1, top: 0 }}
          transition={tween({ duration: duration.fast, ease: ease.enter })}
          shadow={elevation(m, 'popover')}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            pointerEvents: 'none',
            backgroundColor: m.popup,
            borderRadius: concentric(radiusBase + PAD, 0),
            borderWidth: 1,
            borderColor: m.border,
          }}
        />
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', padding: PAD }}>
          {/* One highlight for every row: glides for the pointer, jumps for the keyboard. */}
          <motion.div
            initial={false}
            animate={{ top: tops[active] ?? tops[0] ?? PAD, opacity: active >= 0 ? 1 : 0 }}
            transition={tween(glide ? spring.snappy : { duration: 0 })}
            style={{ position: 'absolute', left: PAD, right: PAD, height: ROW, borderRadius: concentric(radiusBase + PAD, PAD), backgroundColor: danger ? m.dangerBg : m.popupHover, pointerEvents: 'none' }}
          />
          {header ? (
            <div onLayout={(e) => setHeaderHeight(e.height ?? 0)} style={{ display: 'flex', flexDirection: 'column' }}>
              {typeof header === 'function' ? header(() => pick(active < 0 ? items.findIndex(selectable) : active)) : header}
            </div>
          ) : null}
          {items.map((it, i) => {
            if (it.kind === 'separator') return <div key={`sep-${i}`} style={{ height: SEPARATOR, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}><div style={{ height: 1, marginLeft: -PAD, marginRight: -PAD, backgroundColor: m.border }} /></div>
            if (it.kind === 'label')
              return (
                <div key={`label-${i}`} style={{ height: LABEL, display: 'flex', alignItems: 'center', paddingLeft: 9 }}>
                  <text style={{ fontSize: 11.5, lineHeight: 14, color: m.textMuted, fontWeight: 500 }}>{it.label}</text>
                </div>
              )
            const n = row++
            const color = it.disabled ? m.textFaint : it.destructive ? m.danger : m.textUi
            return (
              <div key={it.testId ?? it.label} style={{ position: 'relative', height: ROW }}>
              <motion.div
                initial={{ opacity: 0, top: from * 0.4 }}
                animate={{ opacity: 1, top: 0 }}
                // Rows arrive from the trigger outward: top-down below it, bottom-up above it.
                transition={tween({ duration: duration.standard, ease: ease.enter, delay: Math.min(side === 'top' ? rows - 1 - n : n, stagger.maxItems - 1) * stagger.item })}
                style={{ position: 'absolute', left: 0, right: 0, height: ROW, pointerEvents: 'none' }}
              >
                <div style={{ height: ROW, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 9, paddingLeft: 9, paddingRight: 8 }}>
                {it.image !== undefined ? (
                  // An app's own icon (Open in); an empty slot keeps the row aligned while it loads.
                  it.image ? <img src={it.image} style={{ width: 18, height: 18, marginLeft: -2, marginRight: -2 }} objectFit="contain" /> : <div style={{ width: 14 }} />
                ) : it.dot ? (
                  <div style={{ width: 14, display: 'flex', justifyContent: 'center' }}>
                    <div style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: it.dot }} />
                  </div>
                ) : it.icon ? (
                  <Icon name={it.icon} size={14} color={it.destructive ? m.danger : m.textMuted} />
                ) : null}
                {/* The label keeps its width; a hint too long for the row is the one that's cut short. */}
                <text style={{ flexShrink: 0, fontSize: 13, lineHeight: 16, color, whiteSpace: 'nowrap' }}>{it.label}</text>
                <div style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'row', justifyContent: 'flex-end' }}>
                  {it.hint ? <text style={{ minWidth: 0, fontSize: 11.5, lineHeight: 14, color: m.textFaint, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{it.hint}</text> : null}
                </div>
                {it.shortcut ? <Kbd>{it.shortcut}</Kbd> : null}
                {it.checked ? <Icon name="check" size={13} color={m.text} /> : null}
                </div>
              </motion.div>
              <Base testId={it.testId} aria-label={it.label} disabled={it.disabled} onClick={() => pick(i)} onMouseEnter={() => { if (selectable(it)) { setGlide(active >= 0); setActive(i) } }} onKeyDown={(event) => { if (event.key === 'enter' || event.key === 'space') event.stopPropagation() }} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, cursor: it.disabled ? 'default' : 'pointer', borderRadius: radiusBase }} />
              </div>
            )
          })}
        </div>
        </div>
      </FloatingLayer>
    </DismissableLayer>
  )
}
