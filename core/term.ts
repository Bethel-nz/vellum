// The terminal engine: a PTY feeding a libghostty-vt terminal. No UI.
//
// Every interactive terminal in Vellum (! commands, profile login, "Open in
// Claude Code", shells) is a TermSession rendered by ui/TerminalBlock.tsx.
//
// Two kinds of PTY sit behind one: `startTerm` runs it in Vellum and it ends with Vellum;
// `holdTerm` hands it to the terminal holder (core/termd.ts), so it survives a quit or a hot
// reload, and `heldTerms` gets those back at launch with their recent output replayed.

import { existsSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { VtTerminal, type Grid, type KeyInput } from './ghostty'
import { compiled, hasTermd, hasPty } from './platform'
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
  /** Move the view `lines` rows into the scrollback (negative, up) or back down. */
  scroll(lines: number): void
  /** Back to the newest output; typing and pasting do this first. */
  scrollToBottom(): void
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
      session.scrollToBottom()
      const bytes = vt.encodeKey(input)
      if (bytes.length) session.write(bytes)
    },
    paste(text) {
      if (disposed) return
      session.scrollToBottom()
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
    scroll(lines) {
      if (disposed || !lines) return
      vt.scroll(lines)
      changed()
    },
    scrollToBottom() {
      if (disposed || vt.scrollbar().atBottom) return
      vt.scrollToBottom()
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
  // A tmux-backed shell is ahead of everything — even this quit (the ✕ on its tab
  // is the one thing that ends it). Its attach dies with the process on its own.
  for (const [id, s] of sessions) if (!tmuxClients.has(id)) s.kill()
}

// ---------------------------------------------------------------- tmux shells

/**
 * Shell tabs run under tmux when tmux exists. The session is created detached and
 * only attached: the program inside never depends on any of this process, so a shell
 * is ahead of the holder, of a quit, even of Vellum itself. The tab's ✕ is the one
 * thing that ends it — `kill-session`. Names live in `paths.home/terms.json`, so a
 * later launch can reattach a detached session with no held PTYs to lean on.
 */

type TmuxEntry = { name: string; meta: unknown; at: string }

let tmuxOk: boolean | undefined

function tmuxAvailable(): boolean {
  if (!hasTermd) return false
  if (tmuxOk !== undefined) return tmuxOk
  try {
    tmuxOk = Bun.spawnSync(['tmux', '-V']).exitCode === 0
  } catch {
    tmuxOk = false
  }
  return tmuxOk
}

/** Live tmux session names; `undefined` means tmux itself couldn't answer. */
function listTmux(): Set<string> | undefined {
  try {
    const out = Bun.spawnSync(['tmux', 'list-sessions', '-F', '#{session_name}'])
    return new Set(out.exitCode === 0 ? out.stdout.toString().split('\n').filter(Boolean) : [])
  } catch {
    return undefined
  }
}

const termsFile = () => path.join(paths.home, 'terms.json')

function readRegistry(): TmuxEntry[] {
  try {
    const parsed = JSON.parse(readFileSync(termsFile(), 'utf8'))
    return Array.isArray(parsed?.tmux) ? parsed.tmux : []
  } catch {
    return []
  }
}

function writeRegistry(entries: TmuxEntry[]) {
  try {
    writeFileSync(termsFile(), JSON.stringify({ tmux: entries }, null, 2))
  } catch {}
}

/** Attach PTYs that are tmux clients: quit must not end their sessions. */
const tmuxClients = new Set<string>()
/** Names attached in this run, so a restore never doubles a session. */
const attachedTmux = new Set<string>()
let tmuxSeq = 0

type TmuxOpts = { argv: string[]; cwd: string; env: Record<string, string | undefined>; cols: number; rows: number }

/**
 * A login shell in a fresh detached tmux session, attached here through the holder as
 * ever. The tab's ✕ becomes `kill-session`; a plain exit or detach keeps the session
 * alive, so it comes back at the next launch.
 */
export async function tmuxShell(opts: TmuxOpts, meta: unknown): Promise<{ session: TermSession; tmux?: string }> {
  if (!tmuxAvailable()) return { session: await holdTerm(opts, meta) }
  const name = `vellum-${Date.now().toString(36)}-${tmuxSeq++}`
  try {
    // Nesting inside tmux is refused out of care, not carelessness — but a shell
    // opened from Vellum is a session of its own even when Vellum sits in tmux.
    const { TMUX: _tmux, TMUX_TMPDIR: _tmuxDir, ...env } = opts.env
    const created = Bun.spawnSync(['tmux', 'new-session', '-d', '-s', name, '-x', String(opts.cols), '-y', String(opts.rows), '-c', opts.cwd, ...opts.argv], { env })
    if (created.exitCode !== 0) throw new Error(created.stderr.toString())
  } catch {
    console.error('vellum: tmux new-session failed; the shell ends with the holder')
    return { session: await holdTerm(opts, meta) }
  }
  const tagged = { ...(meta as object), tmux: name }
  const session = await holdTerm({ argv: ['tmux', 'attach-session', '-t', name], cwd: opts.cwd, env: opts.env, cols: opts.cols, rows: opts.rows }, tagged)
  tmuxClients.add(session.id)
  attachedTmux.add(name)
  writeRegistry([...readRegistry().filter((e) => e.name !== name), { name, meta: tagged, at: new Date().toISOString() }])
  const plainKill = session.kill.bind(session)
  session.kill = () => {
    try {
      Bun.spawn(['tmux', 'kill-session', '-t', name], { detached: true, stdio: ['ignore', 'ignore', 'ignore'] }).unref()
    } catch {}
    writeRegistry(readRegistry().filter((e) => e.name !== name))
    plainKill()
  }
  return { session, tmux: name }
}

/**
 * Shells whose tmux session still exists reattach here, with their tab metadata from
 * terms.json. `skip` is the names already restored through the holder's held terms —
 * holders that no longer exist (an `exit` typed inside tmux) fall out of the file.
 */
export async function restoreTmuxTerms(skip = new Set<string>()): Promise<{ meta: unknown; session: TermSession; tmux: string }[]> {
  if (!tmuxAvailable()) return []
  const live = listTmux()
  if (!live) return []
  const entries = readRegistry()
  const kept: TmuxEntry[] = []
  const out: { meta: unknown; session: TermSession; tmux: string }[] = []
  for (const e of entries) {
    if (skip.has(e.name) || !live.has(e.name)) continue
    if (attachedTmux.has(e.name)) {
      kept.push(e)
      continue
    }
    const session = await holdTerm({ argv: ['tmux', 'attach-session', '-t', e.name], cwd: paths.home, env: process.env, cols: 100, rows: 30 }, e.meta)
    tmuxClients.add(session.id)
    attachedTmux.add(e.name)
    out.push({ meta: e.meta, session, tmux: e.name })
    kept.push(e)
  }
  if (kept.length !== entries.length) writeRegistry(kept)
  return out
}

// ---------------------------------------------------------------- the holder

type Waiter = { match: (m: any) => boolean; fail: (e: Error) => void }
type Link = { wire: Wire; socket: { end(): void }; terms: Map<string, ReturnType<typeof makeSession>>; waiting: Waiter[]; closed?: boolean }

const socketPath = () => path.join(paths.home, 'run', 'termd.sock')
// One connection per Vellum process; a hot reload drops the previous one (its shells stay held).
const g = globalThis as { __vellumTermd?: Promise<Link | undefined> }
void g.__vellumTermd?.then((l) => l?.socket.end())
g.__vellumTermd = undefined

/** Resolve with the first message `match` accepts; reject if the link closes first. */
function expect(link: Link, match: (m: any) => boolean, ms = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    if (link.closed) return reject(new Error('the terminal holder link is closed'))
    const timer = setTimeout(() => reject(new Error('the terminal holder did not answer')), ms)
    link.waiting.push({
      match: (m) => {
        if (!match(m)) return false
        clearTimeout(timer)
        resolve(m)
        return true
      },
      fail: (e) => {
        clearTimeout(timer)
        reject(e)
      },
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
          const i = link.waiting.findIndex((w) => w.match(m))
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
      // The holder went away, or a hot reload let go of this link: its terminals are over as far
      // as this Vellum can tell, and nothing more will answer on it.
      close() {
        link.closed = true
        for (const w of link.waiting.splice(0)) w.fail(new Error('the terminal holder link is closed'))
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
  const log = openSync(path.join(paths.home, 'termd.log'), 'a', 0o600)
  // Once compiled, Vellum is its own holder (bin.ts).
  const args = compiled ? ['--termd', socketPath()] : [path.join(import.meta.dir, 'termd.ts'), socketPath()]
  Bun.spawn([process.execPath, ...args], { detached: true, stdio: ['ignore', log, log], cwd: paths.home }).unref()
}

/** The holder, started if it isn't running; undefined when there's none to be had. */
function holder(): Promise<Link | undefined> {
  if (!hasTermd) return Promise.resolve(undefined)
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

/**
 * The terminals the holder kept from earlier, each attached with its recent output on screen.
 * Never throws: a link a hot reload closed mid-way leaves it to the newer Vellum (quietly), and
 * a holder that doesn't answer leaves them held for the next launch.
 */
export async function heldTerms(): Promise<{ meta: unknown; cwd: string; session: TermSession }[]> {
  if (!hasTermd) return []
  // Don't start a holder just to ask: no socket, nothing held.
  if (!existsSync(socketPath())) return []
  const link = await holder()
  if (!link) return []
  try {
    return await attachHeld(link)
  } catch (e) {
    if (!link.closed) console.error(`vellum: held terminals not restored (${(e as Error).message})`)
    return []
  }
}

async function attachHeld(link: Link) {
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
