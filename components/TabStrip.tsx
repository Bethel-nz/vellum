// The tab strip, after a page indicator: open notes are small boxes centred in the 36px band,
// and the current one stays expanded into a pill with its title. Switching tabs morphs one box
// open and the other shut (width, height and radius on the morph curve), so the row itself
// shows where you are. Clicking the current pill opens the note's menu, which hangs off it.
// History sits on the left (the window has no traffic lights), ⌘K and the account on the right.
//
// Two views share the row: notes (the notes icon, then their tabs and +) and terminals (after a
// hairline, the terminal icon, then one box per terminal: logins, Claude Code, shells). The
// view you are in shows its current tab as the pill; the other side stays as boxes.
//
// Box colour says what a background note is doing: violet while Claude works, blue when it
// needs you, light when a reply is waiting unread, dim otherwise. Hover shows the title.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motion } from './spring'
import { Button as Base } from '@gpuix/react/button'
import { font } from '../ui/theme'
import { Button } from './Button'
import { Dot } from './Dot'
import { Alerts } from './Alerts'
import { TabIndicator } from './TabIndicator'
import { PopoverBackdrop } from './PopoverBackdrop'
import { Icon } from './Icon'
import { ChangesSummary, type ChangeSummary } from './ChangesSummary'
import { FloatingLayer } from '@gpuix/react/floating'
import { duration, enter, offset, spring, tween, useReducedMotion } from './motion'
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
  /** The actual pending request, when this note needs approval. */
  attention?: string
  /** The account colour. */
  dot?: string
  /** No note menu (the Help note): its ✕ shows instead of a chevron. */
  plain?: boolean
}

export type StripTerm = { id: string; title: string; running: boolean }

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
  changes,
  menuOpen,
  activeAnchor,
  confirmation,
  view,
  terms,
  activeTermId,
  onNotes,
  onTerminal,
  onPickTerm,
  onCloseTerm,
  onNewTerm,
}: {
  tabs: StripTab[]
  activeId?: string
  onPick: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
  leading?: ReactNode
  trailing?: ReactNode
  changes?: { summary: ChangeSummary; onPress: () => void }
  /** The current pill's menu is open: its chevron lights up. */
  menuOpen?: boolean
  /** Rendered inside the current pill, so a menu anchors to it. */
  activeAnchor?: ReactNode
  /** A running note's close question stays beside the tab that requested it. */
  confirmation?: { tabId: string; content: ReactNode; onDismiss: () => void }
  view: 'notes' | 'terminal'
  terms: StripTerm[]
  activeTermId?: string
  /** The notes icon: back to the note you were on. */
  onNotes: () => void
  /** The terminal icon: the last terminal, or a new shell when there is none. */
  onTerminal: () => void
  onPickTerm: (id: string) => void
  onCloseTerm: (id: string) => void
  /** A new shell; absent where there is no PTY. */
  onNewTerm?: () => void
}) {
  const m = useM()
  const [bandWidth, setBandWidth] = useState(0)
  const [centreWidth, setCentreWidth] = useState(0)
  const [trailingWidth, setTrailingWidth] = useState(0)
  const noteIndex = view === 'notes' ? tabs.findIndex((tab) => tab.id === activeId) : -1
  const termIndex = view === 'terminal' ? terms.findIndex((tab) => tab.id === activeTermId) : -1
  const noteWidth = tabs.reduce((sum, tab, i) => sum + (i === noteIndex ? pillWidth(tab) : BOX) + HIT_X * 2, 0)
  const indicatorLeft = noteIndex >= 0 ? 26 + noteIndex * (BOX + HIT_X * 2) + HIT_X : 26 + noteWidth + 26 + 17 + 26 + Math.max(0, termIndex) * (BOX + HIT_X * 2) + HIT_X
  const current = noteIndex >= 0 ? tabs[noteIndex] : termIndex >= 0 ? { ...terms[termIndex]!, time: '' } : undefined
  return (
    <div
      onLayout={(event) => setBandWidth(event.width ?? 0)}
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
        // On the window frame, over the page's own rounded card (app.tsx): no bar of its own.
        userSelect: 'none',
      }}
    >
      {/* Centred on the whole band, not on the space between the two sides. */}
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
        <div onLayout={(event) => setCentreWidth(event.width ?? 0)} style={{ position: 'relative', display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
          <TabIndicator left={indicatorLeft} width={current ? pillWidth(current) : 0} />
          <ViewButton icon="notes" on={view === 'notes'} onPress={onNotes} testId="view-notes" title="Notes" />
          {tabs.map((t) => (
            <Tab
              key={t.id}
              tab={t}
              active={view === 'notes' && t.id === activeId}
              menuOpen={menuOpen}
              anchor={<>
                {view === 'notes' && t.id === activeId ? activeAnchor : null}
                {confirmation?.tabId === t.id ? <FloatingLayer side="bottom" align="center" sideOffset={6} style={{ backgroundColor: '#00000000' }}><PopoverBackdrop onClose={confirmation.onDismiss} testId="confirm-close-backdrop" />{confirmation.content}</FloatingLayer> : null}
              </>}
              onPick={() => onPick(t.id)}
              onClose={() => onClose(t.id)}
            />
          ))}
          <Button onPress={onNew} testId="new-thread" title="New note (⌘N)" style={{ width: 22, paddingLeft: 0, paddingRight: 0, marginLeft: 4 }}>
            <Icon name="plus" size={13} />
          </Button>
          <div style={{ width: 1, height: 14, marginLeft: 8, marginRight: 8, backgroundColor: m.border }} />
          <ViewButton icon="terminalBox" on={view === 'terminal'} onPress={onTerminal} testId="view-terminal" title="Terminals" />
          {terms.map((t) => (
            <Tab
              key={t.id}
              tab={{ id: t.id, title: t.title, time: '', running: t.running }}
              term
              active={view === 'terminal' && t.id === activeTermId}
              onPick={() => onPickTerm(t.id)}
              onClose={() => onCloseTerm(t.id)}
            />
          ))}
          {view === 'terminal' && onNewTerm ? (
            <Button onPress={onNewTerm} testId="new-term" title="New terminal" style={{ width: 22, paddingLeft: 0, paddingRight: 0, marginLeft: 4 }}>
              <Icon name="plus" size={13} />
            </Button>
          ) : null}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 }}>{leading}</div>
      {trailing || changes ? <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        {changes?.summary.files ? <ChangesSummary key={`${changes.summary.files}:${changes.summary.added}:${changes.summary.removed}`} summary={changes.summary} onPress={changes.onPress} availableWidth={(bandWidth - centreWidth) / 2 - trailingWidth - 18} /> : null}
        {trailing ? <div onLayout={(event) => setTrailingWidth(event.width ?? 0)} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 4 }}>{trailing}</div> : null}
      </div> : null}
    </div>
  )
}

/** A view's icon at the head of its side of the strip: bright while you are in that view. */
function ViewButton({ icon, on, onPress, testId, title }: { icon: 'notes' | 'terminalBox'; on: boolean; onPress: () => void; testId: string; title: string }) {
  const m = useM()
  return (
    <Button onPress={onPress} testId={testId} title={title} style={{ width: 24, paddingLeft: 0, paddingRight: 0, marginRight: 2 }}>
      <Icon name={icon} size={15} color={on ? m.text : m.textFaint} />
    </Button>
  )
}

function Tab({
  tab,
  active,
  menuOpen,
  anchor,
  onPick,
  onClose,
  term,
}: {
  tab: StripTab
  active: boolean
  menuOpen?: boolean
  anchor?: ReactNode
  onPick: () => void
  onClose: () => void
  /** A terminal: no note menu, so no chevron and no title-menu hook. */
  term?: boolean
}) {
  const m = useM()
  const [hover, setHover] = useState(false)
  useReducedMotion()
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const show = () => { clearTimeout(hoverTimer.current); setHover(true) }
  const hide = () => { hoverTimer.current = setTimeout(() => setHover(false), duration.fast * 1000) }
  useEffect(() => () => clearTimeout(hoverTimer.current), [])
  // No menu to open: the pill shows its ✕ all the time, as a terminal's does.
  const bare = term || tab.plain
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
          backgroundColor: active ? '#00000000' : tone,
          borderWidth: 0,
          borderColor: m.borderFocused,
        }}
      >
        {active ? (
          <div testId={bare ? undefined : 'title-menu'} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 7, flexGrow: 1, minWidth: 0, paddingLeft: 10, paddingRight: 6 }}>
            {term ? null : tab.running ? <Dot color={m.accent} size={6} pulse /> : <Dot color={tab.dot ?? m.textFaint} size={6} />}
            <text style={{ flexShrink: 1, minWidth: 0, fontSize: 12.5, lineHeight: 16, fontWeight: 500, color: m.text, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{tab.title}</text>
            {bare ? null : <Icon name="chevronDown" size={11} color={menuOpen ? m.text : m.textFaint} />}
            <div style={{ flexGrow: 1 }} />
            {hover || bare ? (
              <div style={{ width: 18, height: 18, flexShrink: 0 }} />
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
    <div role="presentation" onMouseEnter={show} onMouseLeave={hide} style={{ position: 'relative' }}>
    {box}
    {/* A real button: a tab stop with Enter/Space, and it takes the press inside the centred layer. */}
    <Base
      testId={`tab-${tab.id}`}
      aria-label={tab.title}
      aria-selected={active}
      // ⌃click closes, like a middle click in a browser.
      onClick={(e) => (e.modifiers?.ctrl ? onClose() : onPick())}
      onAuxClick={(e) => (e.button === 1 ? onClose() : undefined)}
      style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, cursor: 'default', borderRadius: 7, focusVisible: { outlineWidth: 2, outlineColor: m.focusRing, outlineOffset: -2 } }}
    />
    {active && (hover || bare) ? <div style={{ position: 'absolute', right: 6, top: 5 }}><Button onPress={onClose} testId={`close-${tab.id}`} title={term ? 'Close terminal' : 'Close tab (⇧⌘W)'} style={{ width: 18, height: 18, minHeight: 18, paddingLeft: 0, paddingRight: 0 }}><Icon name="x" size={11} /></Button></div> : null}
      {/* Its own hover label: the shared Tooltip's trigger eats the click a box needs. */}
      {hover && !active && !tab.needsYou && !tab.unread ? (
        <FloatingLayer side="bottom" align="center" sideOffset={4} style={{ backgroundColor: '#00000000' }}>
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
    {hover && !active && (tab.needsYou || tab.unread) ? (
      <Alerts title={tab.title} detail={tab.attention} needsYou={tab.needsYou} onOpen={onPick} onEnter={show} onLeave={hide} />
    ) : null}
    {anchor}
    </div>
  )
}
