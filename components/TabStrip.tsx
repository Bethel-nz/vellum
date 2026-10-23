// The tab strip, after Glass's tab bar and arc's sliding tabs: a 36px band in the title-bar
// colour, tabs 28px tall on a 3px inset, one raised wash that glides to the active tab on the
// enter curve (120ms). Each tab shows its account dot (or a pulse while Claude works), the
// title, an unread dot, and the time in faint mono; hovering swaps the time for a close button.
//
// Tabs size themselves (90–240px), so the wash follows measured layout, not an index.

import { useState, type ReactNode } from 'react'
import { motion } from '@gpuix/react'
import { concentric, font, radiusBase } from '../ui/theme'
import { Button } from './Button'
import { Dot } from './Dot'
import { Icon } from './Icon'
import { ease, tween } from './motion'
import { useM } from './theme'

export const stripHeight = 36
const INSET = 4
const TAB = 28
const TAB_RADIUS = concentric(radiusBase, 2)

export type StripTab = {
  id: string
  title: string
  time: string
  running?: boolean
  unread?: boolean
  /** The account colour. */
  dot?: string
}

type Slot = { x: number; width: number }

export function TabStrip({
  tabs,
  activeId,
  onPick,
  onClose,
  onNew,
  leading,
  trailing,
}: {
  tabs: StripTab[]
  activeId?: string
  onPick: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
  /** Room on the left for the traffic lights. */
  leading: number
  trailing?: ReactNode
}) {
  const m = useM()
  const [origin, setOrigin] = useState(0)
  const [slots, setSlots] = useState<Record<string, Slot>>({})
  const slot = activeId ? slots[activeId] : undefined
  const measure = (id: string) => (e: { x?: number; width?: number }) => {
    const next = { x: e.x ?? 0, width: e.width ?? 0 }
    setSlots((s) => (s[id]?.x === next.x && s[id]?.width === next.width ? s : { ...s, [id]: next }))
  }
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        height: stripHeight,
        flexShrink: 0,
        paddingLeft: leading,
        paddingRight: INSET + 2,
        gap: 4,
        backgroundColor: m.titleBar,
        borderBottomWidth: 1,
        borderColor: m.border,
        userSelect: 'none',
      }}
    >
      <div
        onLayout={(e) => setOrigin(e.x ?? 0)}
        style={{ position: 'relative', flexGrow: 1, minWidth: 0, height: TAB, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 2, overflow: 'hidden' }}
      >
        {/* The raised wash. It mounts at the first measured slot, then glides. */}
        {slot ? (
          <motion.div
            initial={false}
            animate={{ left: slot.x - origin, width: slot.width, opacity: 1 }}
            transition={tween({ duration: 0.12, ease: ease.enter })}
            style={{ position: 'absolute', top: 0, height: TAB, borderRadius: TAB_RADIUS, backgroundColor: m.selected, borderWidth: 1, borderColor: m.borderFocused }}
          />
        ) : null}
        {tabs.map((t) => (
          <Tab key={t.id} tab={t} active={t.id === activeId} onPick={() => onPick(t.id)} onClose={() => onClose(t.id)} onLayout={measure(t.id)} />
        ))}
        <Button onPress={onNew} testId="new-thread" title="New note (⌘N)" style={{ width: TAB - 4, paddingLeft: 0, paddingRight: 0 }}>
          <Icon name="plus" size={14} />
        </Button>
      </div>
      {trailing ? <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 }}>{trailing}</div> : null}
    </div>
  )
}

function Tab({ tab, active, onPick, onClose, onLayout }: { tab: StripTab; active: boolean; onPick: () => void; onClose: () => void; onLayout: (e: { x?: number; width?: number }) => void }) {
  const m = useM()
  const [hover, setHover] = useState(false)
  return (
    <div
      testId={`tab-${tab.id}`}
      onLayout={onLayout}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      // ⌃click closes, like a middle click in a browser.
      onClick={(e) => (e.modifiers?.ctrl ? onClose() : onPick())}
      onAuxClick={(e) => (e.button === 1 ? onClose() : undefined)}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        height: TAB,
        flexShrink: 1,
        minWidth: 90,
        maxWidth: 240,
        paddingLeft: 10,
        paddingRight: 6,
        borderRadius: TAB_RADIUS,
        cursor: 'default',
        hover: active ? undefined : { backgroundColor: m.hover },
      }}
    >
      {tab.running ? <Dot color={m.accent} size={6} pulse /> : <Dot color={tab.dot ?? m.textFaint} size={6} />}
      <text style={{ flexGrow: 1, flexShrink: 1, minWidth: 0, fontSize: 12.5, lineHeight: 16, fontWeight: 500, color: active ? m.text : m.textMuted, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
        {tab.title}
      </text>
      {tab.unread && !active ? <div testId={`unread-${tab.id}`} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: m.blue, flexShrink: 0 }} /> : null}
      {hover ? (
        <Button onPress={onClose} testId={`close-${tab.id}`} title="Close tab (⇧⌘W)" style={{ width: 18, height: 18, minHeight: 18, paddingLeft: 0, paddingRight: 0 }}>
          <Icon name="x" size={11} />
        </Button>
      ) : (
        <text style={{ fontSize: 10.5, lineHeight: 14, color: m.textFaint, fontFamily: font.mono, flexShrink: 0, width: 32 }}>{tab.time}</text>
      )}
    </div>
  )
}
