import { appendFileSync } from 'node:fs'
import { noticeMessage } from './notice-text'
import { readSettings } from './store'
import { NativeNotifications, type NotificationPermission } from './native-notify'

export type NoticeKind = 'question' | 'approval' | 'done' | 'error'
export type Notice = {
  id: string
  noteId: string
  kind: NoticeKind
  title: string
  body: string
  agent: string
  at: number
  pending: boolean
  read: boolean
}
type Snapshot = { items: Notice[]; banner?: string; permission: NotificationPermission; error?: string }
type Context = { visible: (noteId: string) => boolean; open: (noteId: string) => void }

class NotificationInbox {
  #state: Snapshot = { items: [], permission: 'idle' }
  #listeners = new Set<() => void>()
  #native?: NativeNotifications
  #context?: Context
  getSnapshot = () => this.#state
  subscribe = (listener: () => void) => { this.#listeners.add(listener); return () => { this.#listeners.delete(listener) } }
  #update(change: Partial<Snapshot>) {
    this.#state = { ...this.#state, ...change }
    for (const listener of this.#listeners) listener()
    this.#native?.badge(this.#state.items.filter((item) => item.pending).length)
  }
  configure(renderer: unknown, context: Context) {
    this.#native?.close()
    this.#context = context
    const native = new NativeNotifications(renderer, {
      open: (id) => this.open(id),
      focus: (active) => { if (active) for (const item of this.#state.items) if (context.visible(item.noteId)) this.seen(item.noteId) },
      status: (permission, error) => this.#update({ permission, error }),
    })
    this.#native = native
    return () => { native.close(); if (this.#native === native) { this.#native = undefined; this.#context = undefined } }
  }
  #wanted(item: Notice) {
    const preference = readSettings().notify ?? 'asks'
    return preference !== 'off' && (item.kind !== 'done' || preference === 'all')
  }
  publish(item: Omit<Notice, 'at' | 'pending' | 'read'>) {
    const previous = this.#state.items.find((entry) => entry.id === item.id)
    if (previous && previous.body === item.body && (previous.pending || item.kind === 'error' && !previous.read)) return
    const focused = this.#native?.focused() ?? true
    const visible = focused && Boolean(this.#context?.visible(item.noteId))
    const notice: Notice = { ...item, at: Date.now(), pending: item.kind === 'question' || item.kind === 'approval', read: visible }
    const items = [notice, ...this.#state.items.filter((entry) => entry.id !== item.id)]
    const retained = items.filter((entry, index) => entry.pending || index < 80)
    this.#update({ items: retained, ...(focused && !visible ? { banner: notice.id } : {}) })
    if (!this.#wanted(notice) || focused) return
    const log = process.env.VELLUM_NOTIFY_LOG
    if (log) { appendFileSync(log, JSON.stringify({ kind: notice.kind === 'done' ? 'done' : 'ask', title: notice.title, body: notice.body, id: notice.id, noteId: notice.noteId }) + '\n'); return }
    // Scratch automation never sends desktop banners or requests OS permission.
    if (process.env.GPUIX_BACKGROUND) return
    const wanted = () => Boolean(this.#native && !this.#native.focused() && this.#wanted(notice) && this.#state.items.some((entry) => entry.id === notice.id && !entry.read && (!notice.pending || entry.pending)))
    const message = noticeMessage(notice)
    void this.#native?.show({ id: notice.id, title: message.title, subtitle: '', body: message.body, note: notice.noteId }, wanted).catch(() => {})
  }
  settle(id: string) {
    this.#native?.dismiss(id)
    this.#update({ items: this.#state.items.map((item) => item.id === id ? { ...item, pending: false, read: true } : item), ...(this.#state.banner === id ? { banner: undefined } : {}) })
  }
  settleNote(noteId: string) { for (const item of this.#state.items) if (item.noteId === noteId && item.pending) this.settle(item.id) }
  seen(noteId: string) {
    if (!this.#native?.focused()) return
    const unread = this.#state.items.filter((item) => item.noteId === noteId && !item.read)
    if (!unread.length) return
    for (const item of unread) this.#native.dismiss(item.id)
    this.#update({ items: this.#state.items.map((item) => item.noteId === noteId ? { ...item, read: true } : item) })
  }
  markAllRead() {
    for (const item of this.#state.items) this.#native?.dismiss(item.id)
    this.#update({ items: this.#state.items.map((item) => ({ ...item, read: true })) })
  }
  clearRead() { this.#update({ items: this.#state.items.filter((item) => !item.read || item.pending) }) }
  dismiss(id: string) {
    const item = this.#state.items.find((item) => item.id === id)
    if (item?.pending) return
    this.#native?.dismiss(id)
    this.#update({ items: this.#state.items.filter((item) => item.id !== id), ...(this.#state.banner === id ? { banner: undefined } : {}) })
  }
  open(id: string) {
    const item = this.#state.items.find((item) => item.id === id)
    if (!item) return
    this.#native?.dismiss(id)
    this.#update({ items: this.#state.items.map((entry) => entry.id === id ? { ...entry, read: true } : entry), banner: undefined })
    this.#context?.open(item.noteId)
  }
  closeBanner() { this.#update({ banner: undefined }) }
  async authorize() {
    if (process.env.GPUIX_BACKGROUND) return
    try { await this.#native?.authorize() } catch { /* Native service reports the reason in Settings. */ }
  }
}

export const notificationInbox = new NotificationInbox()
export const askNoticeId = (noteId: string, requestId: string) => `ask:${noteId}:${requestId}`

/** The inbox records live events; desktop delivery respects focus and the saved preference. */
export function notify(kind: 'ask' | 'done' | 'error', title: string, body: string, context: { noteId: string; id?: string; kind?: NoticeKind; agent: string }) {
  notificationInbox.publish({ id: context.id ?? `${kind}:${context.noteId}`, noteId: context.noteId, kind: context.kind ?? (kind === 'ask' ? 'approval' : kind), title, body, agent: context.agent })
}
