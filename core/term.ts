// The terminal engine: a PTY feeding a libghostty-vt terminal. No UI.
//
// Every interactive terminal in Vellum (! commands, profile login, "Open in
// Claude Code", shells) is a TermSession rendered by ui/TerminalBlock.tsx.
//
// Two kinds of PTY sit behind one: `startTerm` runs it in Vellum and it ends with Vellum;
// `holdTerm` hands it to the terminal holder (core/termd.ts), so it survives a quit or a hot
// reload, and `heldTerms` gets those back at launch with their recent output replayed.

import { spawn } from 'node:child_process'
import { existsSync, openSync } from 'node:fs'
import path from 'node:path'
import { VtTerminal, type Grid, type KeyInput } from './ghostty'
import { hasPty } from './platform'
import { paths } from './store'
import { TERMD_VERSION, Wire, type HeldTerm } from './termd'

export type TermSession = {
  id: string
  argv: string[]
  write(bytes: string | Uint8Array): void
  key(input: KeyInput): void
  /** Paste text the way a terminal does (bracketed when the program asks, control bytes stripped). */
  paste(text: string): void
  resize(cols: number, rows: number): void
  snapshot(): Grid
  /** Plain text of screen and scrollback, from libghostty's formatter. */
  text(): string
  onChange(cb: () => void): () => void
  exited: Promise<number>
  exitCode: number | undefined
  kill(): void
}

type Io = { write(bytes: string | Uint8Array): void; resize(cols: number, rows: number): void; kill(): void }

/** Ended only with Vellum: these are the ones a quit kills. */
const sessions = new Map<string, TermSession>()
let counter = 0
const newId = () => `term-${Date.now().toString(36)}-${counter++}`

export function getTerm(id: string) {
  return sessions.get(id)
}

/** A terminal over some PTY: `feed` it output, `end` it with the exit code. */
function makeSession(id: string, argv: string[], cols: number, rows: number, io: Io) {
  const listeners = new Set<() => void>()
  let pending: ReturnType<typeof setTimeout> | undefined
  let grid: Grid | undefined
  let disposed = false
  let resolveExit!: (code: number) => void

  const changed = () => {
    grid = undefined
    // Coalesce bursts of output into one redraw per frame.
    if (pending) return
    pending = setTimeout(() => {
      pending = undefined
      for (const cb of listeners) cb()
    }, 16)
  }

  // Replies (cursor position, device attributes) go straight back to the PTY.
  const vt = new VtTerminal(cols, rows, (bytes) => session.write(bytes))

  const session: TermSession = {
    id,
    argv,
    exitCode: undefined,
    write(bytes) {
      if (session.exitCode === undefined) io.write(bytes)
    },
    key(input) {
      const bytes = vt.encodeKey(input)
      if (bytes.length) session.write(bytes)
    },
    paste(text) {
      if (disposed) return
      const bytes = vt.encodePaste(text)
      if (bytes.length) session.write(bytes)
    },
    resize(cols, rows) {
      cols = Math.max(20, Math.min(400, Math.floor(cols)))
      rows = Math.max(2, Math.min(200, Math.floor(rows)))
      if (disposed || (cols === vt.cols && rows === vt.rowsCount)) return
      vt.resize(cols, rows)
      if (session.exitCode === undefined) io.resize(cols, rows)
      changed()
    },
    snapshot() {
      if (disposed) return grid ?? { cols: vt.cols, rows: [], cursor: { row: 0, col: 0, visible: false }, alternate: false }
      return (grid ??= vt.snapshot())
    },
    text() {
      return disposed ? '' : vt.text()
    },
    onChange(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    exited: new Promise((r) => (resolveExit = r)),
    kill() {
      if (session.exitCode === undefined) io.kill()
    },
  }

  return {
    session,
    feed(data: Uint8Array) {
      if (disposed) return
      vt.feed(data)
      changed()
    },
    end(code: number) {
      if (session.exitCode !== undefined) return
      session.exitCode = code
      // Freeze the last frame, then free the terminal.
      grid = vt.snapshot()
      const finalText = vt.text()
      session.text = () => finalText
      disposed = true
      vt.dispose()
      for (const cb of listeners) cb()
      resolveExit(code)
    },
  }
}

function ptyEnv(given: Record<string, string | undefined>) {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(given)) if (v !== undefined) env[k] = v
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.CLICOLOR = '1'
  env.CLICOLOR_FORCE = '1'
  return env
}

type TermOpts = {
  id?: string
  argv: string[]
  cwd: string
  env: Record<string, string | undefined>
  cols: number
  rows: number
}

/** A terminal that lives and dies with Vellum. */
export function startTerm(opts: TermOpts): TermSession {
  const id = opts.id ?? newId()
  let proc: ReturnType<typeof Bun.spawn> | undefined
  const t = makeSession(id, opts.argv, opts.cols, opts.rows, {
    write: (bytes) => proc?.terminal?.write(bytes),
    resize: (cols, rows) => proc?.terminal?.resize(cols, rows),
    kill: () => proc?.kill(),
  })
  proc = Bun.spawn(opts.argv, {
    cwd: opts.cwd,
    env: ptyEnv(opts.env),
    terminal: {
      cols: opts.cols,
      rows: opts.rows,
      data: (_t, data) => t.feed(data),
    },
  })
  proc.exited.then((code) => {
    t.end(code)
    proc?.terminal?.close()
    sessions.delete(id)
  })
  sessions.set(id, t.session)
  return t.session
}

export function killAllTerms() {
  for (const s of sessions.values()) s.kill()
}

// ---------------------------------------------------------------- the holder

type Link = { wire: Wire; socket: { end(): void }; terms: Map<string, ReturnType<typeof makeSession>>; waiting: ((m: any) => boolean)[] }

const socketPath = () => path.join(paths.home, 'termd.sock')
// One connection per Vellum process; a hot reload drops the previous one (its shells stay held).
const g = globalThis as { __vellumTermd?: Promise<Link | undefined> }
void g.__vellumTermd?.then((l) => l?.socket.end())
g.__vellumTermd = undefined

/** Resolve with the first message `match` accepts. */
function expect(link: Link, match: (m: any) => boolean, ms = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the terminal holder did not answer')), ms)
    link.waiting.push((m) => {
      if (!match(m)) return false
      clearTimeout(timer)
      resolve(m)
      return true
    })
  })
}

async function open(): Promise<Link> {
  const link: Link = { wire: undefined!, socket: undefined!, terms: new Map(), waiting: [] }
  const socket = await Bun.connect({
    unix: socketPath(),
    socket: {
      data(_s, chunk) {
        for (const m of link.wire.read(chunk)) {
          const i = link.waiting.findIndex((w) => w(m))
          if (i >= 0) {
            link.waiting.splice(i, 1)
            continue
          }
          const t = link.terms.get(m.id)
          if (!t) continue
          if (m.ev === 'data') t.feed(Buffer.from(m.data, 'base64'))
          else if (m.ev === 'exit') {
            link.terms.delete(m.id)
            t.end(m.code)
          }
        }
      },
      drain: () => link.wire.drain(),
      // The holder went away: its terminals are over as far as this Vellum can tell.
      close() {
        for (const t of link.terms.values()) t.end(-1)
        link.terms.clear()
        const current = g.__vellumTermd
        void current?.then((l) => {
          if (l === link && g.__vellumTermd === current) g.__vellumTermd = undefined
        })
      },
    },
  })
  link.socket = socket
  link.wire = new Wire(socket)
  link.wire.send({ op: 'hello' })
  const hello = await expect(link, (m) => m.ev === 'hello')
  if (hello.version !== TERMD_VERSION) {
    socket.end()
    throw new Error(`the terminal holder running is version ${hello.version}, this Vellum speaks ${TERMD_VERSION}`)
  }
  return link
}

function startHolder() {
  const log = openSync(path.join(paths.home, 'termd.log'), 'a')
  spawn(process.execPath, [path.join(import.meta.dir, 'termd.ts'), socketPath()], { detached: true, stdio: ['ignore', log, log], cwd: paths.home }).unref()
}

/** The holder, started if it isn't running; undefined when there's none to be had. */
function holder(): Promise<Link | undefined> {
  if (!hasPty) return Promise.resolve(undefined)
  return (g.__vellumTermd ??= (async () => {
    try {
      return await open()
    } catch {}
    startHolder()
    for (let i = 0; i < 60; i++) {
      await Bun.sleep(50)
      try {
        return await open()
      } catch {}
    }
    console.error('vellum: no terminal holder; terminals end with Vellum')
    g.__vellumTermd = undefined
    return undefined
  })())
}

function heldSession(link: Link, id: string, argv: string[], cols: number, rows: number) {
  const t = makeSession(id, argv, cols, rows, {
    write: (bytes) => link.wire.send({ op: 'write', id, data: Buffer.from(bytes).toString('base64') }),
    resize: (cols, rows) => link.wire.send({ op: 'resize', id, cols, rows }),
    kill: () => link.wire.send({ op: 'kill', id }),
  })
  link.terms.set(id, t)
  return t
}

/**
 * A terminal the holder keeps, so it outlives Vellum. `meta` comes back with it from `heldTerms`.
 * Without a holder (Windows, or it wouldn't start) it is an ordinary terminal.
 */
export async function holdTerm(opts: TermOpts, meta: unknown): Promise<TermSession> {
  const link = await holder()
  if (!link) return startTerm(opts)
  const id = opts.id ?? newId()
  const t = heldSession(link, id, opts.argv, opts.cols, opts.rows)
  link.wire.send({ op: 'spawn', id, argv: opts.argv, cwd: opts.cwd, env: ptyEnv(opts.env), cols: opts.cols, rows: opts.rows, meta })
  return t.session
}

/** The terminals the holder kept from earlier, each attached with its recent output on screen. */
export async function heldTerms(): Promise<{ meta: unknown; cwd: string; session: TermSession }[]> {
  if (!hasPty) return []
  // Don't start a holder just to ask: no socket, nothing held.
  if (!existsSync(socketPath())) return []
  const link = await holder()
  if (!link) return []
  link.wire.send({ op: 'list' })
  const { terms } = (await expect(link, (m) => m.ev === 'list')) as { terms: HeldTerm[] }
  const out = []
  for (const info of terms) {
    if (link.terms.has(info.id)) continue
    const t = heldSession(link, info.id, info.argv, info.cols, info.rows)
    link.wire.send({ op: 'attach', id: info.id })
    const first = await expect(link, (m) => m.id === info.id && (m.ev === 'replay' || m.ev === 'exit'))
    if (first.ev === 'exit') {
      link.terms.delete(info.id)
      continue
    }
    t.feed(Buffer.from(first.data, 'base64'))
    out.push({ meta: info.meta, cwd: info.cwd, session: t.session })
  }
  return out
}
