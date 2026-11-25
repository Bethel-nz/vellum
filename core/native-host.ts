// Chrome's native messaging host for Snapshot. Chrome starts `Vellum chrome-extension://<id>/` only for
// the extension named in the host manifest (native-host-install.ts); this relays its requests to the
// bridge socket with the owner token, so the extension never holds a token or finds a port.
import { bridgeFetch } from './bridge-client'
import { extensionId } from './capture'
import { assembler, chunks, type NativeChunk, type NativeRequest, type NativeResponse } from './native-protocol'
import { paths } from './store'

// stdout carries only frames: a 4-byte little-endian length, then UTF-8 JSON.
function send(message: unknown) {
  const body = Buffer.from(JSON.stringify(message))
  const head = Buffer.alloc(4)
  head.writeUInt32LE(body.length)
  process.stdout.write(Buffer.concat([head, body]))
}

async function relay(request: NativeRequest): Promise<NativeResponse> {
  const pairing = await Bun.file(paths.bridge).json().catch(() => undefined) as { endpoint?: string; token?: string } | undefined
  if (!pairing?.endpoint || !pairing.token) return { error: 'unavailable' }
  let body: string | FormData | undefined = request.body
  if (request.form) {
    const form = new FormData()
    for (const [key, value] of Object.entries(request.form.fields)) form.set(key, value)
    for (const file of request.form.files) form.append(file.name, new Blob([Buffer.from(file.data, 'base64')], { type: file.mime }), file.name)
    body = form
  }
  try {
    const response = await bridgeFetch(pairing.endpoint, request.route, { method: request.method ?? 'GET', headers: { ...request.headers, Authorization: `Bearer ${pairing.token}` }, body, signal: AbortSignal.timeout(60_000) })
    return { status: response.status, body: await response.text() }
  } catch {
    return { error: 'unavailable' }
  }
}

export async function serveNativeHost(caller: string) {
  if (caller !== `chrome-extension://${extensionId}/`) { console.error(`Vellum native host: refused ${caller}`); process.exit(1) }
  const take = assembler()
  const inFlight = new Set<Promise<void>>()
  let buffer = Buffer.alloc(0)
  for await (const piece of Bun.stdin.stream()) {
    buffer = Buffer.concat([buffer, piece])
    while (buffer.length >= 4) {
      const size = buffer.readUInt32LE(0)
      if (buffer.length < 4 + size) break
      const chunk = JSON.parse(buffer.subarray(4, 4 + size).toString()) as NativeChunk
      buffer = buffer.subarray(4 + size)
      const whole = take(chunk)
      if (!whole) continue
      const answer = relay(whole.value as NativeRequest).then((result) => { for (const part of chunks(chunk.id, result)) send(part) })
      inFlight.add(answer)
      void answer.finally(() => inFlight.delete(answer))
    }
  }
  // Input closed: finish what was asked, then go.
  await Promise.all(inFlight)
  process.exit(0)
}
