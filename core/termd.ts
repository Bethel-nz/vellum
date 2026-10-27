// The terminal holder: a small process that owns the shells, so they outlive Vellum.
//
// Vellum starts it on first use (core/term.ts) and talks to it over a unix socket in its home.
// It runs the PTYs, keeps the recent output of each, and forwards bytes both ways; it has no
// terminal emulator of its own. Quitting Vellum, or a `bun --hot` reload, only drops the
// connection: the shells and whatever they run keep going, and the next Vellum lists them and
// replays their output into a fresh terminal. It quits by itself once it holds no terminal and
// nobody is connected.
//
//   bun core/termd.ts <socket>
//
// Protocol: one JSON object per line each way. Bytes travel as base64.
//   → hello                              ← hello {version, pid}
//   → spawn {id, argv, cwd, env, cols, rows, meta}   (the spawner is attached)
//   → list                               ← list {terms: HeldTerm[]}
//   → attach {id}                        ← replay {id, data}, then data… (or exit {id, code} if it's gone)
//   → write {id, data} / resize {id, cols, rows} / kill {id} / detach {id}
//                                        ← data {id, data} / exit {id, code}

// The socket's folder, its permissions and the exit-time cleanup are node:fs's work.
import { chmodSync, existsSync, lstatSync, mkdirSync, unlinkSync } from 'node:fs'
import path from 'node:path'

export const TERMD_VERSION = 1

/** What the holder tells a Vellum about a terminal it holds. `meta` is Vellum's, kept verbatim. */
export type HeldTerm = { id: string; argv: string[]; cwd: string; cols: number; rows: number; meta: unknown }

/** A socket as JSON lines both ways: a partial write waits for drain, UTF-8 split across chunks is joined. */
export class Wire {
  #in = ''
  #decoder = new TextDecoder()
  #pending: Uint8Array[] = []
  constructor(readonly socket: { write(data: Uint8Array): number }) {}
  send(msg: object) {
    const bytes = new TextEncoder().encode(JSON.stringify(msg) + '\n')
    if (this.#pending.length) this.#pending.push(bytes)
    else this.#write(bytes)
  }
  #write(bytes: Uint8Array) {
    const n = this.socket.write(bytes)
    if (n < bytes.length) this.#pending.push(bytes.subarray(Math.max(0, n)))
  }
  /** Call from the socket's drain handler. */
  drain() {
    if (!this.#pending.length) return
    const all = Buffer.concat(this.#pending)
    this.#pending = []
    this.#write(all)
  }
  /** The complete messages in a chunk; the rest waits for the next one. */
  read(chunk: Uint8Array): any[] {
    this.#in += this.#decoder.decode(chunk, { stream: true })
    const lines = this.#in.split('\n')
    this.#in = lines.pop()!
    const out: any[] = []
    for (const line of lines) {
      try {
        out.push(JSON.parse(line))
      } catch {}
    }
    return out
  }
}

/** Output kept per terminal for a returning Vellum to replay. */
const KEEP = 1 << 20
/** How long it lingers with nothing to hold and nobody connected. */
const IDLE_MS = 10_000

type Conn = { wire: Wire; attached: Set<string> }
type Held = HeldTerm & { proc: ReturnType<typeof Bun.spawn>; chunks: Uint8Array[]; size: number }

if (import.meta.main) await serve(process.argv[2]!)

export async function serve(sock: string) {
  if (!sock || !path.isAbsolute(sock)) throw new Error('usage: bun core/termd.ts <absolute socket path>')
  // Whoever can connect can run commands as you, so the socket lives in a folder only you can open.
  const dir = path.dirname(sock)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
  const st = lstatSync(dir)
  if (!st.isDirectory() || st.uid !== process.getuid!() || (st.mode & 0o077) !== 0) throw new Error(`termd: ${dir} must be a folder of yours that only you can open`)
  // Another holder already answering here wins; a stale socket file is cleared.
  if (existsSync(sock)) {
    const alive = await Bun.connect({ unix: sock, socket: { data() {} } }).then(
      (s) => (s.end(), true),
      () => false,
    )
    if (alive) process.exit(0)
    unlinkSync(sock)
  }

  const terms = new Map<string, Held>()
  const clients = new Set<Conn>()
  let idle: ReturnType<typeof setTimeout> | undefined

  const send = (c: Conn, msg: object) => c.wire.send(msg)
  const broadcast = (id: string, msg: object) => {
    for (const c of clients) if (c.attached.has(id)) send(c, msg)
  }
  const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
  const info = ({ id, argv, cwd, cols, rows, meta }: Held): HeldTerm => ({ id, argv, cwd, cols, rows, meta })

  const checkIdle = () => {
    clearTimeout(idle)
    if (terms.size || clients.size) return
    idle = setTimeout(() => {
      server.stop(true)
      try {
        unlinkSync(sock)
      } catch {}
      process.exit(0)
    }, IDLE_MS)
  }

  function spawn(c: Conn, m: any) {
    if (terms.has(m.id)) return
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(m.env ?? {})) if (typeof v === 'string') env[k] = v
    let term: Held
    const proc = Bun.spawn(m.argv, {
      cwd: m.cwd,
      env,
      terminal: {
        cols: m.cols,
        rows: m.rows,
        data(_t, data) {
          const bytes = new Uint8Array(data)
          term.chunks.push(bytes)
          term.size += bytes.length
          while (term.size > KEEP && term.chunks.length > 1) term.size -= term.chunks.shift()!.length
          broadcast(term.id, { ev: 'data', id: term.id, data: b64(bytes) })
        },
      },
    })
    term = { id: m.id, argv: m.argv, cwd: m.cwd, cols: m.cols, rows: m.rows, meta: m.meta, proc, chunks: [], size: 0 }
    terms.set(term.id, term)
    c.attached.add(term.id)
    proc.exited.then((code) => {
      terms.delete(term.id)
      broadcast(term.id, { ev: 'exit', id: term.id, code })
      proc.terminal?.close()
      checkIdle()
    })
    checkIdle()
  }

  function handle(c: Conn, m: any) {
    const term = typeof m.id === 'string' ? terms.get(m.id) : undefined
    switch (m.op) {
      case 'hello':
        return send(c, { ev: 'hello', version: TERMD_VERSION, pid: process.pid })
      case 'spawn':
        return spawn(c, m)
      case 'list':
        return send(c, { ev: 'list', terms: [...terms.values()].map(info) })
      case 'attach':
        if (!term) return send(c, { ev: 'exit', id: m.id, code: -1 })
        c.attached.add(term.id)
        return send(c, { ev: 'replay', id: term.id, cols: term.cols, rows: term.rows, data: b64(Buffer.concat(term.chunks)) })
      case 'detach':
        return c.attached.delete(m.id)
      case 'write':
        return term?.proc.terminal?.write(Buffer.from(m.data, 'base64'))
      case 'resize':
        if (!term) return
        term.cols = m.cols
        term.rows = m.rows
        return term.proc.terminal?.resize(m.cols, m.rows)
      case 'kill':
        return term?.proc.kill()
    }
  }

  const gone = (c: Conn) => {
    clients.delete(c)
    checkIdle()
  }
  // Private from the moment it exists; the shells it starts get your usual umask back.
  const umask = process.umask(0o077)
  const server = Bun.listen<Conn>({
    unix: sock,
    socket: {
      open(s) {
        s.data = { wire: new Wire(s), attached: new Set() }
        clients.add(s.data)
        checkIdle()
      },
      data(s, chunk) {
        for (const m of s.data.wire.read(chunk)) {
          try {
            handle(s.data, m)
          } catch (e) {
            console.error('termd:', e)
          }
        }
      },
      drain: (s) => s.data.wire.drain(),
      close: (s) => gone(s.data),
      error: (s) => gone(s.data),
    },
  })
  process.umask(umask)
  chmodSync(sock, 0o600)
  await Bun.write(sock + '.pid', String(process.pid))
  process.on('exit', () => {
    try {
      unlinkSync(sock + '.pid')
    } catch {}
  })
  checkIdle()
}
