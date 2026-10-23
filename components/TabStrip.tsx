// The tab strip, after a page indicator: open notes are small boxes centred in the 36px band,
// and the current one stays expanded into a pill with its title. Switching tabs morphs one box
// open and the other shut (width, height and radius on the morph curve), so the row itself
// shows where you are. Clicking the current pill opens the note's menu, which hangs off it.
// History sits on the left (the window has no traffic lights), ⌘K and the account on the right.
//
// Box colour says what a background note is doing: violet while Claude works, blue when it
// needs you, light when a reply is waiting unread, dim otherwise. Hover shows the title.

import { useState, type ReactNode } from 'react'
import { motion } from '@gpuix/react'
import { Button as Base } from '@gpuix/react/button'
import { font } from '../ui/theme'
import { Button } from './Button'
import { Dot } from './Dot'
import { Icon } from './Icon'
import { FloatingLayer } from '@gpuix/react/floating'
import { enter, offset, spring, tween } from './motion'
import { useM } from './theme'

export const stripHeight = 36
const BOX = 10
const PILL = 24
/** Clickable room around each box, so a 10px target is not a 10px hit area. */
const HIT_X = 3

export type StripTab = {
  id: string
  title: string
  time: string
  running?: boolean
  unread?: boolean
  /** Claude is waiting on an approval or a question. */
  needsYou?: boolean
  /** The account colour. */
  dot?: string
}

/** The pill fits its title, within reason. Geist 12.5/500 averages ~6.9px a character. */
const pillWidth = (t: StripTab) => Math.round(Math.min(280, Math.max(124, t.title.length * 6.9 + 30 + 54)))

export function TabStrip({
  tabs,
  activeId,
  onPick,
  onClose,
  onNew,
  leading,
  trailing,
  menuOpen,
  activeAnchor,
}: {
  tabs: StripTab[]
  activeId?: string
  onPick: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
  leading?: ReactNode
  trailing?: ReactNode
  /** The current pill's menu is open: its chevron lights up. */
  menuOpen?: boolean
  /** Rendered inside the current pill, so a menu anchors to it. */
  activeAnchor?: ReactNode
}) {
  const m = useM()
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: stripHeight,
        flexShrink: 0,
        paddingLeft: 6,
        paddingRight: 6,
        backgroundColor: m.titleBar,
        borderBottomWidth: 1,
        borderColor: m.border,
        userSelect: 'none',
      }}
    >
      {/* Centred on the whole band, not on the space between the two sides. */}
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
          {tabs.map((t) => (
            <Tab key={t.id} tab={t} active={t.id === activeId} menuOpen={menuOpen} anchor={t.id === activeId ? activeAnchor : null} onPick={() => onPick(t.id)} onClose={() => onClose(t.id)} />
          ))}
          <Button onPress={onNew} testId="new-thread" title="New note (⌘N)" style={{ width: 22, paddingLeft: 0, paddingRight: 0, marginLeft: 4 }}>
            <Icon name="plus" size={13} />
          </Button>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 }}>{leading}</div>
      {trailing ? <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 }}>{trailing}</div> : null}
    </div>
  )
}

function Tab({ tab, active, menuOpen, anchor, onPick, onClose }: { tab: StripTab; active: boolean; menuOpen?: boolean; anchor?: ReactNode; onPick: () => void; onClose: () => void }) {
  const m = useM()
  const [hover, setHover] = useState(false)
  const tone = tab.needsYou ? m.blue : tab.running ? m.accent : tab.unread ? m.textUi : hover ? m.textFaint : m.selected
  const box = (
    <div style={{ height: 28, paddingLeft: HIT_X, paddingRight: HIT_X, display: 'flex', alignItems: 'center' }}>
      <motion.div
        initial={false}
        animate={{ width: active ? pillWidth(tab) : BOX, height: active ? PILL : BOX, borderRadius: active ? 7 : 3 }}
        transition={tween(spring.morph)}
        style={{
          // A motion.div keeps presses to itself; let them reach the tab button.
          pointerEvents: 'none',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          overflow: 'hidden',
          backgroundColor: active ? m.selected : tone,
          borderWidth: active ? 1 : 0,
          borderColor: m.borderFocused,
        }}
      >
        {active ? (
          <div testId="title-menu" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 7, flexGrow: 1, minWidth: 0, paddingLeft: 10, paddingRight: 6 }}>
            {tab.running ? <Dot color={m.accent} size={6} pulse /> : <Dot color={tab.dot ?? m.textFaint} size={6} />}
            <text style={{ flexShrink: 1, minWidth: 0, fontSize: 12.5, lineHeight: 16, fontWeight: 500, color: m.text, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{tab.title}</text>
            <Icon name="chevronDown" size={11} color={menuOpen ? m.text : m.textFaint} />
            <div style={{ flexGrow: 1 }} />
            {hover ? (
              <Button onPress={onClose} testId={`close-${tab.id}`} title="Close tab (⇧⌘W)" style={{ pointerEvents: 'auto', width: 18, height: 18, minHeight: 18, paddingLeft: 0, paddingRight: 0 }}>
                <Icon name="x" size={11} />
              </Button>
            ) : (
              <text style={{ fontSize: 10.5, lineHeight: 14, color: m.textFaint, fontFamily: font.mono, flexShrink: 0 }}>{tab.time}</text>
            )}
          </div>
        ) : null}
      </motion.div>
    </div>
  )
  return (
    // The menu anchor sits beside the button, not in it, so presses in the menu stay in the menu.
    <div style={{ position: 'relative' }}>
    {/* A real button: a tab stop with Enter/Space, and it takes the press inside the centred layer. */}
    <Base
      testId={`tab-${tab.id}`}
      aria-label={tab.title}
      aria-selected={active}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      // ⌃click closes, like a middle click in a browser.
      onClick={(e) => (e.modifiers?.ctrl ? onClose() : onPick())}
      onAuxClick={(e) => (e.button === 1 ? onClose() : undefined)}
      style={{ position: 'relative', cursor: 'default', borderRadius: 7, focusVisible: { outlineWidth: 2, outlineColor: m.focusRing, outlineOffset: -2 } }}
    >
      {box}
      {/* Its own hover label: the shared Tooltip's trigger eats the click a box needs. */}
      {hover && !active ? (
        <FloatingLayer side="bottom" align="center" sideOffset={4}>
          <motion.div
            initial={{ opacity: 0, top: -offset.tooltip }}
            animate={{ opacity: 1, top: 0 }}
            transition={enter('instant')}
            style={{ position: 'relative', display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, height: 24, paddingLeft: 8, paddingRight: 8, backgroundColor: m.popup, borderRadius: 6, borderWidth: 1, borderColor: m.border }}
          >
            <text style={{ fontSize: 12, lineHeight: 16, color: m.textUi, whiteSpace: 'nowrap' }}>{tab.title}</text>
            {tab.time ? <text style={{ fontSize: 10.5, lineHeight: 14, color: m.textFaint, fontFamily: font.mono }}>{tab.time}</text> : null}
          </motion.div>
        </FloatingLayer>
      ) : null}
    </Base>
    {anchor}
    </div>
  )
}
