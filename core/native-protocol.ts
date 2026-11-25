// What Snapshot and Vellum's native messaging host say to each other. Chrome caps one message from the
// host at 1 MB, so every payload travels as JSON text cut into chunks well under that.
export const nativeHost = 'dev.vellum.bridge'

export type NativeChunk = { id: string; seq: number; done: boolean; data: string }
export type NativeFile = { name: string; mime: string; data: string }
export type NativeRequest = { route: string; method?: string; headers?: Record<string, string>; body?: string; form?: { fields: Record<string, string>; files: NativeFile[] } }
export type NativeResponse = { status: number; body: string } | { error: 'unavailable' }

// 3 bytes per character at worst in UTF-8, plus escaping, still fits in 1 MB.
const SIZE = 200_000

export function* chunks(id: string, value: unknown): Generator<NativeChunk> {
  const text = JSON.stringify(value)
  for (let at = 0, seq = 0; ; at += SIZE, seq++) {
    const done = at + SIZE >= text.length
    yield { id, seq, done, data: text.slice(at, at + SIZE) }
    if (done) return
  }
}

/** Collects chunks per id; hands back the whole value once its last chunk arrives. */
export function assembler() {
  const parts = new Map<string, string[]>()
  return (chunk: NativeChunk): { value: unknown } | undefined => {
    const list = parts.get(chunk.id) ?? []
    list[chunk.seq] = chunk.data
    if (!chunk.done) { parts.set(chunk.id, list); return }
    parts.delete(chunk.id)
    return { value: JSON.parse(list.join('')) }
  }
}
