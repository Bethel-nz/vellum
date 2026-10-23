// The terminal engine: a Bun PTY feeding a libghostty-vt terminal. No UI.
//
// Every interactive terminal in Vellum (! commands, profile login, "Open in
// Claude Code") is a TermSession rendered by ui/TerminalBlock.tsx.

import { VtTerminal, type Grid, type KeyInput } from './ghostty'

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

const sessions = new Map<string, TermSession>()
let counter = 0

export function getTerm(id: string) {
  return sessions.get(id)
}

export function startTerm(opts: {
  id?: string
  argv: string[]
  cwd: string
  env: Record<string, string | undefined>
  cols: number
  rows: number
}): TermSession {
  const id = opts.id ?? `term-${Date.now().toString(36)}-${counter++}`
  const listeners = new Set<() => void>()
  let pending: ReturnType<typeof setTimeout> | undefined
  let grid: Grid | undefined
  let disposed = false

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
  let proc: ReturnType<typeof Bun.spawn> | undefined
  const vt = new VtTerminal(opts.cols, opts.rows, (bytes) => proc?.terminal?.write(bytes))

  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(opts.env)) if (v !== undefined) env[k] = v
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.CLICOLOR = '1'
  env.CLICOLOR_FORCE = '1'

  proc = Bun.spawn(opts.argv, {
    cwd: opts.cwd,
    env,
    terminal: {
      cols: opts.cols,
      rows: opts.rows,
      data(_t, data) {
        if (disposed) return
        vt.feed(data)
        changed()
      },
    },
  })

  const session: TermSession = {
    id,
    argv: opts.argv,
    exitCode: undefined,
    write(bytes) {
      if (session.exitCode === undefined) proc?.terminal?.write(bytes)
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
      if (cols === vt.cols && rows === vt.rowsCount) return
      vt.resize(cols, rows)
      if (session.exitCode === undefined) proc?.terminal?.resize(cols, rows)
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
    exited: proc.exited.then((code) => {
      session.exitCode = code
      // Freeze the last frame, then free the terminal.
      grid = vt.snapshot()
      const finalText = vt.text()
      session.text = () => finalText
      disposed = true
      vt.dispose()
      proc?.terminal?.close()
      for (const cb of listeners) cb()
      return code
    }),
    kill() {
      if (session.exitCode === undefined) proc?.kill()
    },
  }
  sessions.set(id, session)
  return session
}

export function killAllTerms() {
  for (const s of sessions.values()) s.kill()
}
