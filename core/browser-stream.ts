import type { StreamClientMessage, StreamServerMessage } from './stream-protocol'

export type BrowserFrame = { data: Uint8Array; width: number; height: number; viewportWidth: number; viewportHeight: number; offsetTop: number; pageScaleFactor: number; timestamp?: number; seq: number }
export type BrowserStreamStatus = 'connecting' | 'live' | 'disconnected'
// Encoded dimensions may differ from CDP viewport dimensions (capped streams, retina).
function imageSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length > 24 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) { const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); return { width: view.getUint32(16), height: view.getUint32(20) } }
  if (bytes[0] !== 255 || bytes[1] !== 216) return
  let i = 2
  while (i + 8 < bytes.length) {
    if (bytes[i] !== 255) { i++; continue }
    const marker = bytes[i + 1]!, length = bytes[i + 2]! * 256 + bytes[i + 3]!
    if ([192, 193, 194].includes(marker)) return { height: bytes[i + 5]! * 256 + bytes[i + 6]!, width: bytes[i + 7]! * 256 + bytes[i + 8]! }
    if (length < 2) return
    i += length + 2
  }
}
export class BrowserStream {
  #socket?: WebSocket
  #timer?: ReturnType<typeof setTimeout>
  #closed = false
  #fps: number
  #pending?: BrowserFrame
  #unaccepted?: BrowserFrame
  #submitting = false
  constructor(private port: number, private frame: (frame: BrowserFrame) => boolean | void | Promise<boolean | void>, private status: (state: BrowserStreamStatus, url?: string) => void, private valid = () => true, private disconnected = () => {}, private authorize: () => Promise<boolean> = async () => true, fps = 10) { this.#fps = fps; this.#connect() }
  async #connect() {
    if (this.#closed || !this.valid()) return
    if (!await this.authorize() || this.#closed || !this.valid()) return
    this.#pending = undefined; this.#unaccepted = undefined
    this.status('connecting')
    const socket = new WebSocket(`ws://127.0.0.1:${this.port}/?pacing=ack&maxFps=${this.#fps}`)
    this.#socket = socket
    socket.onopen = () => { this.send({ type: 'config', pacing: 'ack', maxFps: this.#fps }); this.status('live') }
    socket.onmessage = event => {
      if (this.#closed || socket !== this.#socket || !this.valid()) return
      try {
        if (typeof event.data !== 'string' || event.data.length > 15_000_000) return
        const message: StreamServerMessage = JSON.parse(event.data)
        if (message.type === 'frame') {
          if (typeof message.data !== 'string' || message.data.length > 14_000_000 || !Number.isSafeInteger(message.seq) || message.seq < 0) return
          const data = Buffer.from(message.data, 'base64'), size = imageSize(data)
          const viewportWidth = Number(message.metadata?.deviceWidth ?? size?.width), viewportHeight = Number(message.metadata?.deviceHeight ?? size?.height)
          if (!size || [size.width, size.height, viewportWidth, viewportHeight].some(n => !Number.isFinite(n) || n <= 0 || n > 32_768)) { this.send({ type: 'ack', seq: message.seq }); return }
          this.#pending = { data, ...size, viewportWidth, viewportHeight, offsetTop: Number(message.metadata?.offsetTop) || 0, pageScaleFactor: Number(message.metadata?.pageScaleFactor) || 1, timestamp: Number(message.metadata?.timestamp) || undefined, seq: message.seq }
          void this.#submit()
        } else if (message.type === 'url' && typeof message.url === 'string') this.status('live', message.url)
        else if (message.type === 'error' || (message.type === 'status' && !message.connected)) { this.disconnected(); this.status('disconnected') }
      } catch {}
    }
    socket.onerror = () => socket.close()
    socket.onclose = () => {
      if (socket !== this.#socket) return
      this.disconnected(); this.status('disconnected')
      if (!this.#closed && this.valid()) this.#timer = setTimeout(() => this.#connect(), 2500)
    }
  }
  async #submit() {
    if (this.#submitting) return
    this.#submitting = true
    try {
      while (this.#pending && !this.#closed && this.valid()) {
        const frame = this.#pending; this.#pending = undefined
        try {
          const accepted = await this.frame(frame)
          if (accepted === false) { this.#unaccepted = frame; break }
          if (!this.#closed) this.send({ type: 'ack', seq: frame.seq })
        } catch { this.status('disconnected') }
      }
    } finally { this.#submitting = false }
  }
  resume() { if (this.#unaccepted) { this.#pending = this.#pending ?? this.#unaccepted; this.#unaccepted = undefined; void this.#submit() } }
  send(message: StreamClientMessage) { if (!this.#closed && this.valid() && this.#socket?.readyState === WebSocket.OPEN) this.#socket.send(JSON.stringify(message)) }
  configure(fps: number) { if (!Number.isInteger(fps) || fps < 0 || fps > 120 || fps === this.#fps) return; this.#fps = fps; this.send({ type: 'config', pacing: 'ack', maxFps: fps }) }
  close() { this.#closed = true; this.#pending = undefined; this.#unaccepted = undefined; clearTimeout(this.#timer); this.#socket?.close() }
}
export function browserPoint(point: { x: number; y: number }, bounds: { x: number; y: number; width: number; height: number }, frame: { width: number; height: number; viewportWidth?: number; viewportHeight?: number; offsetTop?: number; pageScaleFactor?: number }) {
  const scale = Math.min(bounds.width / frame.width, bounds.height / frame.height)
  if (!(scale > 0)) return
  const width = frame.width * scale, height = frame.height * scale
  const x = point.x - bounds.x - (bounds.width - width) / 2, y = point.y - bounds.y - (bounds.height - height) / 2
  if (x < 0 || y < 0 || x >= width || y >= height) return
  // v0.39.1 cdp_loop.rs stamps viewport CSS dimensions, independent of the encoded frame cap.
  return { x: x / width * (frame.viewportWidth ?? frame.width), y: y / height * (frame.viewportHeight ?? frame.height) }
}
