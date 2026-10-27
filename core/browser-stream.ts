export type BrowserFrame = { data: Uint8Array; width: number; height: number; seq: number }

export class BrowserStream {
  #socket?: WebSocket
  #timer?: ReturnType<typeof setTimeout>
  #closed = false
  #fps = 4
  constructor(private port: number, private frame: (frame: BrowserFrame) => void, private status: (state: 'connecting' | 'live' | 'disconnected', url?: string) => void) { this.#connect() }
  #connect() {
    if (this.#closed) return
    this.status('connecting')
    const socket = new WebSocket(`ws://127.0.0.1:${this.port}/?pacing=ack&maxFps=${this.#fps}`)
    this.#socket = socket
    socket.onopen = () => this.configure(this.#fps)
    socket.onmessage = (event) => {
      if (this.#closed) return
      try {
        const message = JSON.parse(String(event.data))
        if (message.type === 'frame' && typeof message.data === 'string' && message.data.length < 15000000) {
          const width = Number(message.metadata?.deviceWidth)
          const height = Number(message.metadata?.deviceHeight)
          if (!(width > 0 && height > 0)) return
          this.frame({ data: Buffer.from(message.data, 'base64'), width, height, seq: message.seq })
          this.send({ type: 'ack', seq: message.seq })
          this.status('live')
        } else if (message.type === 'url' && typeof message.url === 'string') this.status('live', message.url)
      } catch {}
    }
    socket.onerror = () => socket.close()
    socket.onclose = () => {
      this.status('disconnected')
      if (!this.#closed) this.#timer = setTimeout(() => this.#connect(), 2500)
    }
  }
  send(message: unknown) { if (this.#socket?.readyState === WebSocket.OPEN) this.#socket.send(JSON.stringify(message)) }
  configure(fps: number) { this.#fps = fps; this.send({ type: 'config', pacing: 'ack', maxFps: fps }) }
  close() { this.#closed = true; clearTimeout(this.#timer); this.#socket?.close() }
}

export function browserPoint(point: { x: number; y: number }, bounds: { x: number; y: number; width: number; height: number }, frame: { width: number; height: number }) {
  return { x: Math.max(0, Math.min(frame.width - 1, (point.x - bounds.x) * frame.width / bounds.width)), y: Math.max(0, Math.min(frame.height - 1, (point.y - bounds.y) * frame.height / bounds.height)) }
}
