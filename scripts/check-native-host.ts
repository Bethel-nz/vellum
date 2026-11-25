// The native messaging host as Chrome drives it: length-prefixed JSON on stdio, chunked both ways,
// relayed to a bridge on a scratch home. Never touches your browsers' host manifests.
//   bun scripts/check-native-host.ts
import { expect } from 'bun:test'
import path from 'node:path'
import { remove, scratchDir } from './scratch'

const home = await scratchDir('vellum-native-')
process.env.VELLUM_HOME = home
process.env.VELLUM_CLAUDE_HOME = path.join(home, 'claude')
const { createBridge } = await import('../core/bridge')
const { extensionId } = await import('../core/capture')
const { appendRecord } = await import('../core/threads')
const { assembler, chunks } = await import('../core/native-protocol')
const note = { id: 'note-one', title: 'One', workspace: home, profileId: 'default', createdAt: new Date().toISOString() }
appendRecord(note.id, { type: 'vellum/meta', meta: note })
const bridge = createBridge({ notes: () => [{ ...note, account: 'Default', active: true }], record: (id, record) => appendRecord(id, record), deliver: () => {} })
const ok = (name: string) => console.log(`ok  ${name}`)

/** Starts the host the way Chrome does and returns a request function speaking its framing. */
function host(caller = `chrome-extension://${extensionId}/`) {
  const child = Bun.spawn([process.execPath, path.join(import.meta.dir, '../bin.ts'), caller], { env: { ...process.env, VELLUM_HOME: home }, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
  const take = assembler()
  const waiting = new Map<string, (value: any) => void>()
  void (async () => {
    let buffer = Buffer.alloc(0)
    for await (const piece of child.stdout) {
      buffer = Buffer.concat([buffer, piece])
      while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE(0)) {
        const size = buffer.readUInt32LE(0)
        expect(size).toBeLessThan(1024 * 1024)
        const chunk = JSON.parse(buffer.subarray(4, 4 + size).toString())
        buffer = buffer.subarray(4 + size)
        const whole = take(chunk)
        if (whole) waiting.get(chunk.id)?.(whole.value)
      }
    }
  })()
  const request = (value: unknown) => new Promise<any>((resolve) => {
    const id = crypto.randomUUID()
    waiting.set(id, resolve)
    for (const chunk of chunks(id, value)) {
      const body = Buffer.from(JSON.stringify(chunk)); const head = Buffer.alloc(4); head.writeUInt32LE(body.length)
      child.stdin.write(Buffer.concat([head, body]))
    }
    child.stdin.flush()
  })
  return { child, request }
}

try {
  const { child, request } = host()
  const health = await request({ route: '/health' })
  expect(health.status).toBe(200)
  expect(JSON.parse(health.body).ok).toBe(true)
  ok('host relays a request to the bridge socket with the owner token')

  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(1_500_000)])
  const capture = { version: 1, id: 'native', createdAt: new Date().toISOString(), page: { url: 'https://example.com/', title: 'Fixture', viewport: { w: 800, h: 600, dpr: 1 } }, elements: [1, 2, 3].map((n) => ({ ref: `e${n}`, selector: `#card${n}`, note: 'Rebuild this card', html: `<div>${'x'.repeat(450_000)}</div>`, css: {}, box: { x: 0, y: 0, w: 1, h: 1 }, animations: [], shots: { element: 'card.png' } })) }
  const upload = await request({ route: '/captures', method: 'POST', form: { fields: { capture: JSON.stringify(capture), target: 'active', mode: 'queue' }, files: [{ name: 'card.png', mime: 'image/png', data: png.toString('base64') }] } })
  expect(upload.status).toBe(201)
  ok('a 3.4 MB upload crosses in chunks and arrives as one multipart request')

  const read = await request({ route: '/captures/native' })
  expect(read.status).toBe(200)
  expect(read.body.length).toBeGreaterThan(1024 * 1024)
  expect(JSON.parse(read.body).capture.elements).toHaveLength(3)
  ok('a reply over 1 MB comes back in chunks under Chrome\'s cap')

  const last = request({ route: '/health' })
  child.stdin.end()
  expect((await last).status).toBe(200)
  expect(await child.exited).toBe(0)
  ok('closing the port answers what is in flight, then the host exits')

  const stranger = host('chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/')
  expect(await stranger.child.exited).toBe(1)
  ok('any other extension is refused')

  bridge.stop()
  const gone = host()
  expect((await gone.request({ route: '/health' })).error).toBe('unavailable')
  gone.child.stdin.end()
  ok('with Vellum closed the host answers unavailable instead of hanging')
} finally { bridge.stop(); await remove(home) }
