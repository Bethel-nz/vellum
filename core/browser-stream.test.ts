import { expect, test } from 'bun:test'
import { BrowserStream } from './browser-stream'
test('ACK follows accepted image submission, skips a stalled backlog and keeps viewport metadata separate', async () => {
  const data = (await Bun.file(new URL('../assets/icon.png', import.meta.url)).bytes()).toBase64()
  const messages: any[] = [], painted: number[] = []
  let release: (() => void) | undefined, socket: any
  const gate = new Promise<void>(resolve => { release = resolve })
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request, server) { return server.upgrade(request) ? undefined : new Response() }, websocket: { open(ws) { socket = ws }, message(_ws, message) { messages.push(JSON.parse(String(message))) } } })
  const stream = new BrowserStream(server.port!, async frame => { painted.push(frame.seq); expect(frame.width).toBe(1024); expect(frame.viewportWidth).toBe(800); if (frame.seq === 1) await gate; return true }, () => {})
  try {
    for (let i = 0; i < 40 && !socket; i++) await Bun.sleep(5)
    expect(socket).toBeDefined()
    for (const seq of [1, 2, 3]) socket.send(JSON.stringify({ type: 'frame', seq, data, metadata: { deviceWidth: 800, deviceHeight: 600 } }))
    await Bun.sleep(30)
    expect(messages.filter(message => message.type === 'ack')).toHaveLength(0)
    release!(); await Bun.sleep(30)
    expect(painted).toEqual([1, 3])
    expect(messages.filter(message => message.type === 'ack').map(message => message.seq)).toEqual([1, 3])
  } finally { stream.close(); server.stop(true) }
})
