import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { DismissableLayer, useWindowSize, type PublicInstance } from '@gpuix/react'
import { FloatingLayer } from '@gpuix/react/floating'
import { Button, Icon, Label, Scroll, useM } from '../components'
import { Lifted } from '../components/Lifted'
import { PopoverBackdrop } from '../components/PopoverBackdrop'
import { motion } from '../components/spring'
import { enter, offset, useReducedMotion } from '../components/motion'
import { noticeMessage, noticeText } from '../core/notice-text'
import { notificationInbox, type Notice } from '../core/notify'
import { elevation, radiusXl } from './theme'

const kindLabel = (item: Notice) => item.kind === 'question' ? 'Question' : item.kind === 'approval' ? 'Approval' : item.kind === 'error' ? 'Needs attention' : 'Reply'
const actionLabel = (item: Notice) => item.pending ? item.kind === 'question' ? 'Answer question' : 'Review request' : 'Open note'
function time(at: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - at) / 60_000))
  return minutes < 1 ? 'Now' : minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`
}

export function NotificationInboxButton() {
  const m = useM(), window = useWindowSize(), reduced = useReducedMotion()
  const state = useSyncExternalStore(notificationInbox.subscribe, notificationInbox.getSnapshot, notificationInbox.getSnapshot)
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'all' | 'waiting'>('all')
  const [, tick] = useState(0)
  const trigger = useRef<PublicInstance>(null), panel = useRef<PublicInstance>(null), close = useRef<PublicInstance>(null)
  const ignored = useRef(false)
  const waiting = state.items.filter((item) => item.pending)
  const count = state.items.filter((item) => item.pending || !item.read).length
  const visible = view === 'waiting' ? waiting : state.items
  useEffect(() => { if (!open) return; const timer = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(timer) }, [open])
  const go = (item: Notice) => { setOpen(false); notificationInbox.open(item.id) }
  return <div style={{ position: 'relative', flexShrink: 0 }}>
    <Button buttonRef={trigger} testId="open-notifications" title={count ? `Notifications · ${count} waiting or unread` : 'Notifications'} selected={open} onPressStart={() => { ignored.current = false }} onPress={() => { if (ignored.current) { ignored.current = false; return }; setOpen(!open) }} style={{ width: 26, paddingLeft: 0, paddingRight: 0 }}><Icon name="bell" size={15} /></Button>
    {count ? <div testId="notifications-badge" style={{ position: 'absolute', right: 0, top: -3, minWidth: 12, height: 12, paddingLeft: 2, paddingRight: 2, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: m.accent, pointerEvents: 'none' }}><text style={{ fontSize: 8, lineHeight: 10, color: m.rootTint, fontWeight: 600 }}>{count > 9 ? '9+' : String(count)}</text></div> : null}
    {open ? <DismissableLayer onEscapeKeyDown={() => setOpen(false)} initialFocus={() => close.current?.id ?? null} finalFocus={() => trigger.current?.id ?? null}>
      <FloatingLayer side="bottom" align="start" sideOffset={8} collisionPadding={12} style={{ width: Math.min(392, window.width - 24), backgroundColor: '#00000000' }}>
        <PopoverBackdrop exclude={panel} testId="notifications-backdrop" onClose={() => { ignored.current = true; setOpen(false); }} />
        <div ref={panel} testId="notifications-panel" role="dialog" aria-label="Notifications" style={{ position: 'relative', display: 'flex', flexDirection: 'column', pointerEvents: 'auto' }}>
          <Lifted initial={reduced ? false : { opacity: 0, top: -offset.menu }} animate={{ opacity: 1, top: 0 }} transition={enter('fast')} shadow={elevation(m, 'popover')} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: radiusXl, borderWidth: 1, borderColor: m.border, backgroundColor: m.popup, pointerEvents: 'none' }} />
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: radiusXl, pointerEvents: 'auto' }}>
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, paddingBottom: 10 }}><text style={{ fontSize: 14, lineHeight: 20, fontWeight: 600, color: m.text, flexGrow: 1 }}>Notifications</text><Button buttonRef={close} testId="notifications-close" title="Close notifications" onPress={() => setOpen(false)} style={{ width: 22, paddingLeft: 0, paddingRight: 0 }}><Icon name="x" size={13} /></Button></div>
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 12, paddingRight: 12, paddingBottom: 10, borderBottomWidth: 1, borderColor: m.border }}>
              <Button testId="notifications-all" selected={view === 'all'} onPress={() => setView('all')}><Label muted={view !== 'all'}>All</Label></Button>
              <Button testId="notifications-waiting" selected={view === 'waiting'} onPress={() => setView('waiting')}><Label muted={view !== 'waiting'}>{waiting.length ? `Needs you · ${waiting.length}` : 'Needs you'}</Label></Button>
              <div style={{ flexGrow: 1 }} />
              {state.items.some((item) => !item.read) ? <Button testId="notifications-mark-read" title="Mark all notifications read" onPress={() => notificationInbox.markAllRead()}><Icon name="checkCheck" size={14} /></Button> : null}
            </div>
            <Scroll testId="notifications-list" style={{ maxHeight: Math.max(140, Math.min(420, window.height - 200)) }} padding={8} gutter={8}>
              {visible.map((item) => <div key={item.id} testId={`notice-${item.id}`} style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: 10, borderRadius: 9, backgroundColor: item.pending ? m.chipBg : '#00000000', marginBottom: 3 }}>
                <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 7 }}><Icon name={item.kind === 'question' ? 'comment' : item.kind === 'approval' ? 'shield' : item.kind === 'error' ? 'shieldX' : 'circleCheck'} size={13} color={item.kind === 'error' ? m.danger : item.pending ? m.accent : m.textMuted} /><text style={{ fontSize: 10.5, lineHeight: 15, color: m.textMuted, flexGrow: 1 }}>{`${item.agent} · ${kindLabel(item)}${!item.pending && (item.kind === 'question' || item.kind === 'approval') ? ' resolved' : ''}`}</text><text style={{ fontSize: 10.5, lineHeight: 15, color: m.textMuted }}>{time(item.at)}</text>{!item.read ? <div style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: m.blue }} /> : null}</div>
                <text style={{ fontSize: 13, lineHeight: 18, color: m.text, fontWeight: 500, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{`Note · ${noticeText(item.title, 90)}`}</text>
                <text style={{ fontSize: 12, lineHeight: 18, maxHeight: 36, overflow: 'hidden', color: m.textMuted }}>{noticeMessage(item).body}</text>
                <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 2 }}><Button testId={`notice-open-${item.id}`} onPress={() => go(item)} style={{ borderWidth: 1, borderColor: m.borderFocused, height: 26, paddingLeft: 9, paddingRight: 9 }}><Label>{actionLabel(item)}</Label><Icon name="chevronRight" size={11} /></Button><div style={{ flexGrow: 1 }} />{item.pending ? <text style={{ fontSize: 10.5, color: m.textMuted }}>Waiting for you</text> : <Button testId={`notice-dismiss-${item.id}`} title="Dismiss notification" onPress={() => notificationInbox.dismiss(item.id)}><Icon name="x" size={12} /></Button>}</div>
              </div>)}
              {!visible.length ? <div testId="notifications-empty" style={{ minHeight: 150, padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}><Icon name={view === 'waiting' ? 'circleCheck' : 'bell'} size={20} /><text style={{ fontSize: 13, lineHeight: 18, color: m.text }}>{view === 'waiting' ? 'Nothing needs your attention' : 'You’re all caught up'}</text><text style={{ fontSize: 11.5, lineHeight: 17, color: m.textMuted, textAlign: 'center' }}>Questions, approvals and replies appear here.</text></div> : null}
            </Scroll>
            {state.items.some((item) => item.read && !item.pending) ? <div style={{ padding: 8, borderTopWidth: 1, borderColor: m.border }}><Button testId="notifications-clear-read" onPress={() => notificationInbox.clearRead()}><Label muted>Clear read</Label></Button></div> : null}
          </div>
        </div>
      </FloatingLayer>
    </DismissableLayer> : null}
  </div>
}

/** A quiet, actionable nudge for another note; never takes keyboard focus. */
export function NotificationBanner({ top = 12 }: { top?: number }) {
  const m = useM(), window = useWindowSize(), reduced = useReducedMotion()
  const state = useSyncExternalStore(notificationInbox.subscribe, notificationInbox.getSnapshot, notificationInbox.getSnapshot)
  const item = state.items.find((item) => item.id === state.banner)
  useEffect(() => { if (!item) return; const timer = setTimeout(() => notificationInbox.closeBanner(), 8000); return () => clearTimeout(timer) }, [item?.id])
  if (!item) return null
  return <motion.div key={item.id} initial={reduced ? false : { opacity: 0, top: top - 4 }} animate={{ opacity: 1, top }} transition={enter('fast')} style={{ position: 'absolute', top, right: 12, width: Math.min(360, window.width - 32), pointerEvents: 'none' }}>
    <div testId="notification-banner" role="status" style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: 12, borderRadius: radiusXl, borderWidth: 1, borderColor: m.borderFocused, backgroundColor: m.popup, boxShadow: elevation(m, 'popover'), pointerEvents: 'auto' }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 7 }}><Icon name={item.kind === 'error' ? 'shieldX' : 'bell'} size={13} color={item.kind === 'error' ? m.danger : m.accent} /><text style={{ fontSize: 12, lineHeight: 17, color: m.text, flexGrow: 1 }}>{noticeMessage(item).title}</text><Button testId="notification-banner-close" title="Dismiss alert" onPress={() => notificationInbox.closeBanner()}><Icon name="x" size={12} /></Button></div>
      <text style={{ fontSize: 12, lineHeight: 17, color: m.textMuted, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{`Note · ${noticeText(item.title, 90)}`}</text>
      <text style={{ fontSize: 12, lineHeight: 18, color: m.textUi, lineClamp: 3 }}>{noticeMessage(item).body}</text>
      <Button testId="notification-banner-open" onPress={() => notificationInbox.open(item.id)} style={{ alignSelf: 'start', borderWidth: 1, borderColor: m.borderFocused, height: 26 }}><Label>{actionLabel(item)}</Label><Icon name="chevronRight" size={11} /></Button>
    </div>
  </motion.div>
}
