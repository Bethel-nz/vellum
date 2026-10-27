import path from 'node:path'
import { appIsActive, setDockBadge } from './dock'
import { compiled } from './platform'
import { paths } from './store'
import { prepareNotificationHelper } from '../scripts/notification-helper'

export type NotificationPermission = 'idle' | 'preparing' | 'notDetermined' | 'authorized' | 'denied' | 'unavailable' | 'error'
export type NativeNotice = { id: string; title: string; subtitle: string; body: string; note: string }
type Desktop = {
  isWindowActive?(): boolean
  setWindowActivation?(changed: ((active: boolean) => void) | null): void
  notificationsAvailable?(): boolean
  showNotification?(note: { tag: string; title: string; body: string; actions: { id: string; label: string }[] }): void
  dismissNotification?(tag: string): void
  setNotificationResponse?(response: ((response: { tag: string }) => void) | null): void
  setDockBadge?(badge: string | null): void
  requestAttention?(critical: boolean): void
  activateWindow?(): void
}

/** The app's own notification identity; no AppleScript/Script Editor fallback. */
export class NativeNotifications {
  #desktop: Desktop
  #process?: ReturnType<typeof Bun.spawn>
  #starting?: Promise<void>
  #closed = false
  #timer?: ReturnType<typeof setInterval>
  #active = true
  constructor(renderer: unknown, private callbacks: { open: (id: string) => void; focus: (active: boolean) => void; status: (status: NotificationPermission, error?: string) => void }) {
    this.#desktop = renderer as Desktop
    this.#active = this.focused()
    const changed = (active: boolean) => { if (active !== this.#active) { this.#active = active; callbacks.focus(active) } }
    if (typeof this.#desktop.setWindowActivation === 'function') this.#desktop.setWindowActivation(changed)
    else this.#timer = setInterval(() => changed(this.focused()), 1000)
    if (typeof this.#desktop.setNotificationResponse === 'function') this.#desktop.setNotificationResponse((response) => this.#open(response.tag))
  }
  focused() {
    try { return this.#desktop.isWindowActive?.() ?? appIsActive() } catch { return false }
  }
  badge(count: number) {
    if (typeof this.#desktop.setDockBadge === 'function') this.#desktop.setDockBadge(count ? String(count) : null)
    else setDockBadge(count)
  }
  #open(id: string) {
    if (this.#closed) return
    this.#desktop.activateWindow?.()
    this.callbacks.open(id)
  }
  async #start() {
    if (this.#closed) throw new Error('Notification service is closed')
    if (this.#process) return
    if (this.#starting) return this.#starting
    this.#starting = (async () => {
      if (process.platform !== 'darwin') { this.callbacks.status('unavailable'); throw new Error('Native notifications are unavailable in this GPUIX build') }
      this.callbacks.status('preparing')
      const executable = compiled
        ? path.join(path.dirname(process.execPath), 'helpers/Vellum Notifications.app/Contents/MacOS/VellumNotifications')
        : await prepareNotificationHelper(path.join(paths.home, 'native/Vellum Notifications.app'))
      if (this.#closed) return
      const child = Bun.spawn([executable, '--parent', String(process.pid)], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
      this.#process = child
      void this.#read(child.stdout as ReadableStream<Uint8Array>).catch(() => { if (!this.#closed) this.callbacks.status('error', 'The notification service disconnected.') })
      // Drain diagnostics; expose an error only when the helper exits unexpectedly.
      const error = new Response(child.stderr).text()
      void child.exited.then(async (code) => {
        if (this.#process !== child) return
        this.#process = undefined
        const detail = (await error).trim()
        if (!this.#closed) this.callbacks.status('error', detail.slice(0, 300) || `Notification service exited (${code})`)
      })
    })().catch((error) => { if (!this.#closed) this.callbacks.status('error', String(error.message)); throw error }).finally(() => { this.#starting = undefined })
    return this.#starting
  }
  async #read(stream: ReadableStream<Uint8Array>) {
    const reader = stream.getReader(), decoder = new TextDecoder()
    let buffer = ''
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let index: number
        while ((index = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, index); buffer = buffer.slice(index + 1)
          try {
            const event = JSON.parse(line)
            if (event.type === 'response' && typeof event.id === 'string') this.#open(event.id)
            else if (event.type === 'status' && ['notDetermined', 'authorized', 'denied', 'provisional'].includes(event.status)) this.callbacks.status(event.status === 'provisional' ? 'authorized' : event.status)
            else if (event.type === 'error') this.callbacks.status('error', event.message)
          } catch { /* Ignore non-protocol helper output. */ }
        }
      }
    } finally { reader.releaseLock() }
  }
  #write(message: unknown) {
    const input = this.#process?.stdin as import('bun').FileSink | undefined
    input?.write(`${JSON.stringify(message)}\n`)
    input?.flush()
  }
  async authorize() {
    if (this.#desktop.notificationsAvailable?.()) {
      // Availability is not the OS permission state; that API requests permission on delivery.
      this.#desktop.showNotification?.({ tag: 'vellum:notification-check', title: 'Vellum', body: 'Vellum can notify you when an agent needs attention.', actions: [] })
      return
    }
    await this.#start()
    this.#write({ command: 'authorize' })
  }
  async show(note: NativeNotice, wanted: () => boolean) {
    if (!wanted() || this.#closed) return
    if (this.#desktop.notificationsAvailable?.() && typeof this.#desktop.showNotification === 'function') {
      this.#desktop.showNotification({ tag: note.id, title: note.title, body: [note.subtitle, note.body].filter(Boolean).join('\n'), actions: [{ id: 'open', label: 'Open note' }] })
      this.#desktop.requestAttention?.(false)
      return
    }
    await this.#start()
    if (wanted() && !this.#closed) this.#write({ command: 'show', ...note })
  }
  dismiss(id: string) { this.#desktop.dismissNotification?.(id); this.#write({ command: 'dismiss', id }) }
  close() {
    this.#closed = true
    clearInterval(this.#timer)
    this.#desktop.setWindowActivation?.(null)
    this.#desktop.setNotificationResponse?.(null)
    this.badge(0)
    this.#write({ command: 'quit' })
    ;(this.#process?.stdin as import('bun').FileSink | undefined)?.end()
  }
}
