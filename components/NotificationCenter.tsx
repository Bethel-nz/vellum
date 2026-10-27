// Arc's notification center. Caller-supplied data only; no agent or app integration.
import { useCallback, useEffect, useRef, useState } from 'react'
import { DismissableLayer, useGpuixRequired, useWindowSize, type KeyEvent, type PublicInstance } from '@gpuix/react'
import { motion } from './spring'
import { FloatingLayer } from '@gpuix/react/floating'
import { Button as Base } from '@gpuix/react/button'
import { elevation } from '../ui/theme'
import { Button, Label } from './Button'
import { Icon } from './Icon'
import { Lifted } from './Lifted'
import { PopoverBackdrop } from './PopoverBackdrop'
import { Scroll } from './Scroll'
import { enter, offset, spring, stagger, tween, useReducedMotion } from './motion'
import { useM } from './theme'

export type NotificationItem = {
  id: string
  title: string
  description?: string
  time: string
  read?: boolean
  tone?: 'info' | 'success' | 'warning'
  actor?: { name: string; photo?: string }
}

export type NotificationCenterProps = {
  notifications: NotificationItem[]
  label?: string
  onReadChange?: (item: NotificationItem, read: boolean) => void
  onDismiss?: (item: NotificationItem) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  testId?: string
}

const PANEL_RADIUS = 26 // Arc's --radius-panel.

export function NotificationCenter({ notifications, label = 'Notifications', onReadChange, onDismiss, open: controlledOpen, onOpenChange, testId = 'notifications' }: NotificationCenterProps) {
  const m = useM()
  const reduced = useReducedMotion()
  const renderer = useGpuixRequired()
  const window = useWindowSize()
  const trigger = useRef<PublicInstance>(null)
  const anchorTarget = useRef<PublicInstance>(null)
  const panel = useRef<PublicInstance>(null)
  const list = useRef<PublicInstance>(null)
  const revealTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const closeButton = useRef<PublicInstance>(null)
  const tabTargets = useRef(new Map<string, PublicInstance>())
  const rowTargets = useRef(new Map<string, PublicInstance>())
  const restoreFocus = useRef(true)
  // Ignore only the click from the outside press that closed the panel. A new
  // mouse/key down starts a fresh press, so quick reopening never waits on a timer.
  const ignoreTriggerClick = useRef(false)
  const focusAfter = useRef<{ item?: string } | null>(null)
  const [localOpen, setLocalOpen] = useState(false)
  const isOpen = controlledOpen ?? localOpen
  const [items, setItems] = useState(notifications)
  // New caller data replaces the local view, including externally changed read states.
  useEffect(() => setItems(notifications), [notifications])
  const [view, setView] = useState<'all' | 'unread'>('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const unread = items.filter((item) => !item.read).length
  const read = items.length - unread
  const visible = view === 'unread' ? items.filter((item) => !item.read) : items
  const width = Math.min(424, Math.max(0, window.width - 24))
  const narrow = width < 380
  const anchor = anchorTarget.current && renderer.getElementBounds?.(anchorTarget.current.id)
  const available = anchor ? Math.max(anchor.y - 24, window.height - anchor.y - anchor.height - 24) : window.height - 24
  const maxHeight = Math.min(590, Math.max(0, available))
  const naturalLeft = anchor ? anchor.x + anchor.width - width : 12
  const alignOffset = Math.max(12, Math.min(naturalLeft, window.width - width - 12)) - naturalLeft
  const setOpen = (next: boolean, restore = true) => {
    restoreFocus.current = restore
    if (controlledOpen === undefined) setLocalOpen(next)
    onOpenChange?.(next)
  }
  useEffect(() => () => clearTimeout(revealTimer.current), [])
  const focusNode = useCallback((node: PublicInstance, reveal = true) => {
    renderer.focusElement?.(node.id)
    clearTimeout(revealTimer.current)
    if (!reveal) return
    revealTimer.current = setTimeout(() => {
      const scroller = list.current
      const viewport = scroller && renderer.getElementBounds?.(scroller.id)
      const target = renderer.getElementBounds?.(node.id)
      if (!scroller || !viewport || !target) return
      const current = renderer.getScrollOffset?.(scroller.id)?.[1] ?? 0
      const change = target.y < viewport.y + 4 ? viewport.y + 4 - target.y : target.y + target.height > viewport.y + viewport.height - 4 ? viewport.y + viewport.height - 4 - target.y - target.height : 0
      if (change) renderer.scrollTo?.(scroller.id, 0, Math.min(0, current + change))
    }, 32)
  }, [renderer])
  // biome-ignore lint/correctness/useExhaustiveDependencies: Apply queued focus only after a read/dismiss update has committed its new rows.
  useEffect(() => {
    const target = focusAfter.current
    if (!target) return
    focusAfter.current = null
    const row = target.item === undefined ? undefined : rowTargets.current.get(target.item)
    const node = row ?? tabTargets.current.get(view)
    if (node) focusNode(node, Boolean(row))
  }, [items, view, focusNode])
  const focusNeighbour = (item: NotificationItem) => {
    const index = visible.findIndex((entry) => entry.id === item.id)
    focusAfter.current = { item: visible[index + 1]?.id ?? visible[index - 1]?.id }
  }
  const toggleRead = (item: NotificationItem) => {
    if (view === 'unread' && !item.read) { focusNeighbour(item); setExpanded(null) }
    setItems((before) => before.map((entry) => entry.id === item.id ? { ...entry, read: !item.read } : entry))
    onReadChange?.(item, !item.read)
  }
  const dismiss = (item: NotificationItem) => {
    focusNeighbour(item)
    setItems((before) => before.filter((entry) => entry.id !== item.id))
    if (expanded === item.id) setExpanded(null)
    onDismiss?.(item)
  }
  const markAll = () => {
    focusAfter.current = {}
    setExpanded(null)
    setItems((before) => before.map((item) => ({ ...item, read: true })))
    for (const item of items) if (!item.read) onReadChange?.(item, true)
  }
  const clearRead = () => {
    focusAfter.current = {}
    if (items.find((item) => item.id === expanded)?.read) setExpanded(null)
    setItems((before) => before.filter((item) => !item.read))
    for (const item of items) if (item.read) onDismiss?.(item)
  }
  const navigate = (event: KeyEvent, index: number) => {
    if (event.defaultPrevented) return
    const step = event.key === 'down' || (event.modifiers?.ctrl && event.key === 'n') ? 1 : event.key === 'up' || (event.modifiers?.ctrl && event.key === 'p') ? -1 : 0
    if (!step && event.key !== 'home' && event.key !== 'end') return
    event.preventDefault()
    event.stopPropagation()
    const item = visible[event.key === 'home' ? 0 : event.key === 'end' ? visible.length - 1 : (index + step + visible.length) % visible.length]
    const node = item && rowTargets.current.get(item.id)
    if (node) focusNode(node)
  }

  return <div ref={anchorTarget} style={{ position: 'relative', width: 42, height: 42, flexShrink: 0 }}>
    <NotificationTrigger unreadCount={unread} open={isOpen} label={label} buttonRef={trigger} testId={`${testId}-trigger`} onPressStart={() => { ignoreTriggerClick.current = false }} onPress={() => { if (ignoreTriggerClick.current) { ignoreTriggerClick.current = false; return }; setOpen(!isOpen) }} />
    {isOpen ? <DismissableLayer onEscapeKeyDown={() => setOpen(false)} initialFocus={() => closeButton.current?.id ?? null} finalFocus={() => restoreFocus.current ? trigger.current?.id ?? null : null}>
      <FloatingLayer side="bottom" align="end" alignOffset={alignOffset} sideOffset={12} collisionPadding={12} style={{ width, borderRadius: PANEL_RADIUS, backgroundColor: '#00000000' }}>
        <PopoverBackdrop exclude={panel} testId={`${testId}-backdrop`} onClose={() => { ignoreTriggerClick.current = true; setOpen(false, false) }} />
        <div ref={panel} testId={`${testId}-panel`} role="dialog" aria-label={label} style={{ position: 'relative', display: 'flex', flexDirection: 'column', maxHeight, minHeight: 0 }}>
          <Lifted initial={reduced ? false : { opacity: 0, top: -offset.menu }} animate={{ opacity: 1, top: 0 }} transition={enter()} shadow={elevation(m, 'popover')} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, borderRadius: PANEL_RADIUS, borderWidth: 1, borderColor: m.border, backgroundColor: m.popup, pointerEvents: 'none' }} />
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', maxHeight, minHeight: 0, overflow: 'hidden', borderRadius: PANEL_RADIUS }}>
            <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingTop: narrow ? 20 : 23, paddingBottom: narrow ? 16 : 18, paddingLeft: narrow ? 16 : 24, paddingRight: narrow ? 16 : 24, flexShrink: 0 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flexGrow: 1 }}>
                <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}><text style={{ fontSize: narrow ? 18 : 22, lineHeight: narrow ? 22 : 27, color: m.text, fontWeight: 500, flexShrink: 1, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{label}</text><div style={{ height: 21, minWidth: 21, paddingLeft: 5, paddingRight: 5, borderRadius: 7, backgroundColor: m.chipBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Count value={unread} testId={`${testId}-count`} /></div></div>
                <motion.div key={unread ? 'unread' : 'read'} initial={reduced ? false : { opacity: 0, top: offset.tooltip }} animate={{ opacity: 1, top: 0 }} transition={enter()} style={{ position: 'relative', pointerEvents: 'none' }}><text style={{ fontSize: 12, lineHeight: 17, color: m.textMuted }}>{unread ? 'Updates waiting for you' : 'No unread notifications'}</text></motion.div>
              </div>
              <Button buttonRef={closeButton} title="Close notifications" testId={`${testId}-close`} onPress={() => setOpen(false)} style={{ width: 30, height: 30, paddingLeft: 0, paddingRight: 0, borderRadius: 8 }}><Icon name="x" size={17} /></Button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingLeft: narrow ? 12 : 20, paddingRight: narrow ? 12 : 17, paddingBottom: 13, minHeight: 52, borderBottomWidth: 1, borderColor: m.border, flexShrink: 0 }}>
              {/* biome-ignore lint/a11y/useSemanticElements: GPUIX has div hosts, not HTML fieldsets. */}
              <div role="group" aria-label="Show notifications" style={{ position: 'relative', display: 'flex', flexDirection: 'row', gap: 3 }}>
                <motion.div initial={false} animate={{ left: view === 'all' ? 0 : 64 }} transition={tween(spring.morph)} style={{ position: 'absolute', top: 0, width: 61, height: 31, borderRadius: 9, backgroundColor: m.chipBg, pointerEvents: 'none' }} />
                {(['all', 'unread'] as const).map((next) => <Base key={next} ref={(node) => { if (node) tabTargets.current.set(next, node); else tabTargets.current.delete(next) }} testId={`${testId}-${next}`} aria-selected={view === next} onClick={() => { setView(next); setExpanded(null) }} style={{ width: 61, height: 31, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 9, focusVisible: { outlineWidth: 1, outlineColor: m.focusRing } }}><text style={{ fontSize: 12, lineHeight: 17, color: view === next ? m.text : m.textMuted }}>{next === 'all' ? 'All' : 'Unread'}</text></Base>)}
              </div>
              {unread > 0 ? <Button title="Mark all read" testId={`${testId}-mark-all`} onPress={markAll} style={{ paddingLeft: 0, paddingRight: 0, gap: 6 }}><Icon name="checkCheck" size={15} />{narrow ? null : <text style={{ fontSize: 12, lineHeight: 17, color: m.textMuted }}>Mark all read</text>}</Button> : null}
            </div>
            <Scroll scrollRef={list} testId={`${testId}-list`} gutter={narrow ? 5 : 11} padding={{ top: narrow ? 8 : 9, left: narrow ? 5 : 11, right: narrow ? 5 : 11, bottom: 10 }} style={{ flexShrink: 1 }}>
              {/* biome-ignore lint/a11y/useSemanticElements: GPUIX has div hosts, not HTML lists. */}
              <div role="list" aria-label={view === 'all' ? 'All notifications' : 'Unread notifications'}>
                {visible.map((item, index) => <NotificationRow key={item.id} item={item} index={index} expanded={expanded === item.id} narrow={narrow} testId={`${testId}-item-${item.id}`} targetRef={(node) => { if (node) rowTargets.current.set(item.id, node); else rowTargets.current.delete(item.id) }} onToggle={() => setExpanded((before) => before === item.id ? null : item.id)} onRead={() => toggleRead(item)} onDismiss={() => dismiss(item)} onKeyDown={(event) => navigate(event, index)} />)}
                {!visible.length ? <div testId={`${testId}-empty`} style={{ minHeight: 190, padding: 22, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}><Icon name="circleCheck" size={24} color={m.textMuted} /><text style={{ fontSize: 14, lineHeight: 20, fontWeight: 500, color: m.text, paddingTop: 9 }}>{view === 'unread' ? 'No unread notifications' : 'No notifications'}</text><text style={{ fontSize: 12, lineHeight: 17, color: m.textMuted, textAlign: 'center' }}>{view === 'unread' && items.length ? 'All notifications are marked read.' : 'New notifications will appear here.'}</text>{view === 'unread' && items.length ? <Button testId={`${testId}-view-all`} onPress={() => setView('all')} style={{ marginTop: 12 }}><Label>View all notifications</Label></Button> : null}</div> : null}
              </div>
            </Scroll>
            {read > 0 ? <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 46, paddingTop: 8, paddingBottom: 8, paddingLeft: narrow ? 16 : 22, paddingRight: narrow ? 16 : 22, borderTopWidth: 1, borderColor: m.border, flexShrink: 0 }}><div testId={`${testId}-read-count`} style={{ display: 'flex', flexDirection: 'row' }}><Count value={read} testId={`${testId}-read-number`} /><text style={{ fontSize: 12, lineHeight: 17, color: m.textMuted }}> read</text></div><Button testId={`${testId}-clear-read`} onPress={clearRead} style={{ paddingLeft: 0, paddingRight: 0 }}><text style={{ fontSize: 12, lineHeight: 17, color: m.textMuted }}>Clear read</text></Button></div> : null}
          </div>
        </div>
      </FloatingLayer>
    </DismissableLayer> : null}
  </div>
}

export function NotificationTrigger({ unreadCount = 0, open = false, label = 'Notifications', onPress, onPressStart, buttonRef, testId = 'notifications-trigger' }: { unreadCount?: number; open?: boolean; label?: string; onPress: () => void; onPressStart?: () => void; buttonRef?: React.Ref<PublicInstance>; testId?: string }) {
  const m = useM()
  const reduced = useReducedMotion()
  const [hover, setHover] = useState(false)
  return <div style={{ position: 'relative', width: 42, height: 42, borderRadius: 21, borderWidth: 1, borderColor: open || hover ? m.borderFocused : m.border, backgroundColor: open || hover ? m.chipBg : m.popup }}>
    <div style={{ position: 'absolute', left: 11, top: 11, pointerEvents: 'none' }}><Icon name="bell" size={19} color={m.text} /></div>
    {unreadCount > 0 ? <motion.div initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={enter('fast')} style={{ position: 'absolute', top: -6, right: -6, minWidth: 20, height: 20, paddingLeft: 5, paddingRight: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 2, borderColor: m.popup, backgroundColor: m.text, pointerEvents: 'none' }}><Count value={unreadCount} display={unreadCount > 9 ? '9+' : String(unreadCount)} color={m.pane} testId={`${testId}-badge`} /></motion.div> : null}
    <Base ref={buttonRef} testId={testId} aria-label={unreadCount ? `${label}, ${unreadCount.toLocaleString()} unread` : label} aria-expanded={open} onMouseDown={onPressStart} onKeyDown={(event) => { if (event.key === 'enter' || event.key === 'space') onPressStart?.() }} onClick={onPress} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{ position: 'absolute', left: 0, top: -6, right: -6, bottom: 0, borderRadius: 21, focusVisible: { outlineWidth: 2, outlineColor: m.focusRing, outlineOffset: 2 } }} />
  </div>
}

function Count({ value, display = value.toLocaleString(), color, testId }: { value: number; display?: string; color?: string; testId: string }) {
  const m = useM()
  const reduced = useReducedMotion()
  return <motion.div key={display} initial={reduced ? false : { opacity: 0, top: offset.tooltip }} animate={{ opacity: 1, top: 0 }} transition={enter('fast')} style={{ position: 'relative', pointerEvents: 'none' }}><text testId={testId} style={{ fontSize: 12, lineHeight: 17, color: color ?? m.textMuted }}>{display}</text></motion.div>
}

function NotificationRow({ item, index, expanded, narrow, testId, targetRef, onToggle, onRead, onDismiss, onKeyDown }: { item: NotificationItem; index: number; expanded: boolean; narrow: boolean; testId: string; targetRef: React.Ref<PublicInstance>; onToggle: () => void; onRead: () => void; onDismiss: () => void; onKeyDown: (event: KeyEvent) => void }) {
  const m = useM()
  const reduced = useReducedMotion()
  const [hover, setHover] = useState(false)
  const padding = narrow ? 7 : 10
  const gap = narrow ? 7 : 11
  // biome-ignore lint/a11y/useSemanticElements: GPUIX has div hosts, not HTML list items.
  return <div role="listitem" testId={testId} style={{ position: 'relative', borderRadius: 14, backgroundColor: expanded || hover ? m.chipBg : '#00000000', overflow: 'hidden' }}>
    <div style={{ position: 'relative', height: 64 }}>
      <motion.div initial={reduced ? false : { opacity: 0, top: offset.tooltip }} animate={{ opacity: 1, top: 0 }} transition={enter('standard', Math.min(index, stagger.maxItems - 1) * stagger.item)} style={{ position: 'relative', display: 'flex', flexDirection: 'row', alignItems: 'start', gap, paddingLeft: padding, paddingRight: padding, paddingTop: 10, pointerEvents: 'none' }}>
        <NotificationVisual item={item} />
        <div style={{ flexGrow: 1, minWidth: 0, paddingTop: 2, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}><text style={{ fontSize: 14, lineHeight: 20, fontWeight: 500, color: item.read ? m.textMuted : m.text, minWidth: 0, flexShrink: 1, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{item.title}</text>{!item.read ? <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: m.text, flexShrink: 0 }} /> : null}</div>
          <text style={{ fontSize: 12, lineHeight: 17, color: m.textMuted, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{item.description ?? (item.actor ? `From ${item.actor.name}` : 'View details')}</text>
        </div>
        <text style={{ fontSize: 12, lineHeight: 17, color: m.textMuted, paddingTop: 4, flexShrink: 0 }}>{item.time}</text>
      </motion.div>
      <Base ref={targetRef} testId={`${testId}-toggle`} aria-label={`${item.title}${item.read ? '' : ', unread'}. ${expanded ? 'Hide details' : 'Show details'}`} aria-expanded={expanded} onClick={onToggle} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onKeyDown={onKeyDown} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: 14, focusVisible: { outlineWidth: 1, outlineColor: m.focusRing, outlineOffset: -1 } }} />
    </div>
    {expanded ? <NotificationDetails item={item} inset={padding + 36 + gap} testId={testId} onRead={onRead} onDismiss={onDismiss} /> : null}
  </div>
}

function NotificationVisual({ item }: { item: NotificationItem }) {
  const m = useM()
  const initials = item.actor?.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')
  return item.actor ? <div role="img" aria-label={item.actor.name} style={{ position: 'relative', width: 36, height: 36, borderRadius: 18, backgroundColor: m.chipBg, flexShrink: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><text style={{ fontSize: 12, lineHeight: 17, color: m.textMuted }}>{initials}</text>{item.actor.photo ? <img src={item.actor.photo} alt="" objectFit="cover" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, width: 36, height: 36 }} /> : null}</div> : <div style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={item.tone === 'warning' ? 'warning' : item.tone === 'success' ? 'circleCheck' : 'comment'} size={18} color={item.tone === 'warning' ? m.warning : item.tone === 'success' ? m.success : m.accent} /></div>
}

function NotificationDetails({ item, inset, testId, onRead, onDismiss }: { item: NotificationItem; inset: number; testId: string; onRead: () => void; onDismiss: () => void }) {
  const m = useM()
  const renderer = useGpuixRequired()
  const reduced = useReducedMotion()
  const window = useWindowSize()
  const body = useRef<PublicInstance>(null)
  const [height, setHeight] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: Text and viewport changes require a new native layout measurement.
  useEffect(() => {
    const timer = setTimeout(() => {
      const bounds = body.current && renderer.getElementBounds?.(body.current.id)
      if (bounds) setHeight(bounds.height)
    }, 32)
    return () => clearTimeout(timer)
  }, [renderer, item.description, item.actor?.name, window.width])
  return <div style={{ position: 'relative', overflow: 'hidden' }}>
    <motion.div initial={reduced ? false : { height: 0, opacity: 0 }} animate={{ height, opacity: 1 }} transition={tween(spring.smooth)} style={{ overflow: 'hidden', pointerEvents: 'none' }}>
      <div ref={body} style={{ paddingLeft: inset, paddingRight: 10, paddingTop: 4, paddingBottom: 15, display: 'flex', flexDirection: 'column', gap: 12, flexShrink: 0 }}><text style={{ fontSize: 12, lineHeight: 17, color: m.textMuted }}>{item.description ?? (item.actor ? `From ${item.actor.name}` : 'Notification details')}</text><div style={{ height: 30, flexShrink: 0 }} /></div>
    </motion.div>
    <div style={{ position: 'absolute', left: inset, right: 10, bottom: 15, display: 'flex', flexDirection: 'row', gap: 6 }}>
      <ReadAction read={Boolean(item.read)} testId={`${testId}-read`} onPress={onRead} />
      <Button testId={`${testId}-dismiss`} onPress={onDismiss} style={{ height: 30, paddingLeft: 10, paddingRight: 10, borderRadius: 10, borderWidth: 1, borderColor: m.border, gap: 5 }}><Icon name="x" size={14} /><text style={{ fontSize: 12, lineHeight: 17, color: m.text }}>Dismiss</text></Button>
    </div>
  </div>
}

function ReadAction({ read, testId, onPress }: { read: boolean; testId: string; onPress: () => void }) {
  const m = useM()
  const renderer = useGpuixRequired()
  const reduced = useReducedMotion()
  const readSizer = useRef<PublicInstance>(null)
  const unreadSizer = useRef<PublicInstance>(null)
  const [widths, setWidths] = useState<{ read: number; unread: number }>()
  useEffect(() => {
    const timer = setTimeout(() => {
      const a = readSizer.current && renderer.getElementBounds?.(readSizer.current.id)
      const b = unreadSizer.current && renderer.getElementBounds?.(unreadSizer.current.id)
      if (a && b) setWidths({ read: a.width + 41, unread: b.width + 41 })
    }, 32)
    return () => clearTimeout(timer)
  }, [renderer])
  const label = read ? 'Mark unread' : 'Mark read'
  const width = widths?.[read ? 'unread' : 'read']
  return <div style={{ position: 'relative', flexShrink: 0 }}>
    <div style={{ position: 'absolute', left: 0, top: -1000, opacity: 0, pointerEvents: 'none', display: 'flex', flexDirection: 'row' }}><text ref={readSizer} style={{ flexShrink: 0, fontSize: 12, lineHeight: 17, whiteSpace: 'nowrap' }}>Mark read</text><text ref={unreadSizer} style={{ flexShrink: 0, fontSize: 12, lineHeight: 17, whiteSpace: 'nowrap' }}>Mark unread</text></div>
    <motion.div initial={false} animate={width === undefined ? {} : { width }} transition={tween(spring.morph)} style={{ height: 30, paddingLeft: 10, paddingRight: 10, borderWidth: 1, borderColor: m.border, borderRadius: 10, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 5, overflow: 'hidden', pointerEvents: 'none' }}><motion.div key={label} initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={enter('fast')} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 0, pointerEvents: 'none' }}><Icon name={read ? 'circleDot' : 'check'} size={14} /><text style={{ fontSize: 12, lineHeight: 17, color: m.text, whiteSpace: 'nowrap' }}>{label}</text></motion.div></motion.div>
    <Base testId={testId} aria-label={label} onClick={onPress} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: 10, focusVisible: { outlineWidth: 1, outlineColor: m.focusRing } }} />
  </div>
}
