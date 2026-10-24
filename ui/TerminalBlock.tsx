// The only terminal view in Vellum: ! commands, profile login, and "Open in Claude Code".
// Renders a libghostty Grid as one line of styled <text> runs per terminal row.

import { useEffect, useReducer, useRef, useState } from 'react'
import { useGpuixRequired, type KeyEvent, type PublicInstance } from '@gpuix/react'
import type { CellColor, Grid, Run } from '../core/ghostty'
import { isTerminalLeave, keys, pasteText, terminalPrimary } from '../core/platform'
import type { TermSession } from '../core/term'
import { Icon, Meta, Quiet, useM } from './kit'
import { concentric, font, radiusBase, type Material } from './theme'

const FONT_SIZE = 12
const LINE = 17
export const CELL_W = FONT_SIZE * font.termAdvance
const PAD = 10
const INLINE_ROWS = 20

function color(m: Material, c: CellColor, fallback: string | undefined) {
  if (c === undefined) return fallback
  if (typeof c === 'number') return m.ansi[c]
  return c
}

function RunText({ run, m, cursor }: { run: Run; m: Material; cursor?: boolean }) {
  let fg = color(m, run.fg, m.termFg)!
  let bg = color(m, run.bg, undefined)
  if (run.bold && typeof run.fg === 'number' && run.fg < 8) fg = m.ansi[run.fg + 8]
  if (run.inverse !== Boolean(cursor)) {
    const swap = fg
    fg = bg ?? m.popup
    bg = swap
  }
  return (
    <text
      style={{
        color: fg,
        backgroundColor: bg,
        fontWeight: run.bold ? 600 : 400,
        textDecoration: run.underline ? 'underline' : undefined,
        opacity: run.faint ? 0.6 : 1,
        fontFamily: font.term,
        fontSize: FONT_SIZE,
        lineHeight: LINE,
        whiteSpace: 'nowrap',
        flexShrink: 0,
        // Runs are cell-aligned: pin each to its cell count so spaces never collapse and nothing
        // can push later columns. CELL_W must be the font's real advance or long runs drift.
        width: [...run.text].length * CELL_W,
        minWidth: [...run.text].length * CELL_W,
        maxWidth: [...run.text].length * CELL_W,
      }}
    >
      {run.text}
    </text>
  )
}

/** Split the run under the cursor so that one cell can be drawn inverted. */
function withCursor(runs: Run[], col: number): Array<{ run: Run; cursor?: boolean }> {
  const out: Array<{ run: Run; cursor?: boolean }> = []
  let x = 0
  let placed = false
  for (const run of runs) {
    const chars = [...run.text]
    if (!placed && col >= x && col < x + chars.length) {
      const i = col - x
      if (i > 0) out.push({ run: { ...run, text: chars.slice(0, i).join('') } })
      out.push({ run: { ...run, text: chars[i]! }, cursor: true })
      if (i + 1 < chars.length) out.push({ run: { ...run, text: chars.slice(i + 1).join('') } })
      placed = true
    } else out.push({ run })
    x += chars.length
  }
  if (!placed) {
    const pad = col - x
    if (pad > 0) out.push({ run: { ...runs[0]!, text: ' '.repeat(pad), fg: undefined, bg: undefined, inverse: false } })
    out.push({ run: { text: ' ', fg: undefined, bg: undefined, bold: false, italic: false, underline: false, inverse: false, faint: false }, cursor: true })
  }
  return out
}

function isBlank(runs: Run[]) {
  return runs.every((r) => r.bg === undefined && !r.inverse && r.text.trim() === '')
}

export function GridView({ grid, focused, mode }: { grid: Grid; focused: boolean; mode: 'inline' | 'full' }) {
  const m = useM()
  let rows = grid.rows
  let offset = 0
  if (mode === 'inline' && !grid.alternate) {
    // Trim the empty rows below the content, but keep the cursor row while it is visible.
    let last = rows.length - 1
    const keep = grid.cursor.visible && focused ? grid.cursor.row : -1
    while (last > keep && last >= 0 && isBlank(rows[last]!)) last--
    rows = rows.slice(0, last + 1)
    if (rows.length > INLINE_ROWS) {
      offset = rows.length - INLINE_ROWS
      rows = rows.slice(offset)
    }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {rows.map((runs, i) => {
        const y = i + offset
        const showCursor = grid.cursor.visible && focused && y === grid.cursor.row
        const parts: Array<{ run: Run; cursor?: boolean }> = showCursor ? withCursor(runs, grid.cursor.col) : runs.map((run) => ({ run }))
        return (
          <div key={y} style={{ display: 'flex', flexDirection: 'row', height: LINE, flexShrink: 0, overflow: 'hidden' }}>
            {parts.length === 0 ? <text style={{ color: m.termFg, fontFamily: font.term, fontSize: FONT_SIZE, lineHeight: LINE }}> </text> : null}
            {parts.map((p, j) => (
              <RunText key={j} run={p.run} m={m} cursor={p.cursor} />
            ))}
          </div>
        )
      })}
    </div>
  )
}

export function TerminalBlock({
  session,
  title,
  mode = 'inline',
  autoFocus,
  onReturnFocus,
  onSendOutput,
  frozen,
  testId,
  hint,
  onClose,
  bare,
}: {
  session?: TermSession
  title: string
  /** Shown instead of "running · click to type" (e.g. what to do in a login). */
  hint?: string
  /** A ✕ on the header that ends the program and closes the terminal. */
  onClose?: () => void
  /** No header at all: the terminal view, whose tab already names it and closes it. */
  bare?: boolean
  mode?: 'inline' | 'full'
  autoFocus?: boolean
  onReturnFocus?: () => void
  onSendOutput?: (text: string) => void
  /** A grid restored from disk when the session is gone. */
  frozen?: { grid: Grid; exitCode: number; output?: string }
  testId?: string
}) {
  const m = useM()
  const renderer = useGpuixRequired()
  const [, redraw] = useReducer((n: number) => n + 1, 0)
  const [focused, setFocused] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const ref = useRef<PublicInstance>(null)

  useEffect(() => session?.onChange(redraw), [session])

  // Focus state is tracked here as well as through onFocus/onBlur, which GPUI
  // does not deliver while the window is inactive.
  const focusSelf = () => {
    if (!ref.current) return
    renderer.focusElement?.(ref.current.id)
    setFocused(true)
  }

  useEffect(() => {
    if (autoFocus) focusSelf()
  }, [autoFocus, renderer])

  const grid = session ? session.snapshot() : frozen?.grid
  const exitCode = session ? session.exitCode : frozen?.exitCode
  const running = session !== undefined && session.exitCode === undefined
  // Scrollback is not in the viewport grid; once the command has exited,
  // "Show all" reads the whole output from libghostty's formatter.
  const allLines = !running ? (session?.text() ?? frozen?.output ?? '').replace(/\s+$/, '').split('\n') : undefined
  const visibleRows = grid ? Math.min(INLINE_ROWS, grid.rows.filter((r) => !isBlank(r)).length) : 0

  const onLayout = (e: { width?: number; height?: number }) => {
    if (!session || !running) return
    const cols = Math.floor(((e.width ?? 600) - PAD * 2) / CELL_W)
    const rows = mode === 'full' ? Math.floor(((e.height ?? 400) - PAD * 2) / LINE) : INLINE_ROWS
    session.resize(cols, rows)
  }

  const onKeyDown = (e: KeyEvent) => {
    if (!session || !running) return
    const mods = e.modifiers
    if (isTerminalLeave(e.key ?? '', mods)) {
      e.preventDefault()
      setFocused(false)
      onReturnFocus?.()
      return
    }
    if (terminalPrimary(mods)) {
      if (e.key === 'v') {
        e.preventDefault()
        const text = pasteText()
        if (text) session.paste(text)
      }
      return // the app's other shortcuts stay with the app (⌘ on macOS, Ctrl+Shift elsewhere)
    }
    e.preventDefault()
    e.stopPropagation()
    session.key({ key: e.key ?? '', keyChar: e.keyChar, modifiers: mods })
  }

  const radius = concentric(radiusBase, 0)
  return (
    <div
      testId={testId}
      onClick={focusSelf}
      onMouseDownOutside={() => setFocused(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        flexGrow: mode === 'full' ? 1 : 0,
        minHeight: 0,
        borderRadius: radius,
        borderWidth: 1,
        borderColor: focused ? m.accent : m.border,
        backgroundColor: m.termBg,
        overflow: 'hidden',
      }}
    >
      {bare ? null : (
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          height: 30,
          paddingLeft: PAD,
          paddingRight: 4,
          borderBottomWidth: 1,
          borderColor: m.borderFaint,
          userSelect: 'none',
        }}
      >
        <text style={{ flexGrow: 1, minWidth: 0, color: m.text, fontFamily: font.mono, fontSize: 12, lineHeight: 16, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          {title}
        </text>
        {running ? (
          <Meta>{hint ?? (focused ? keys('running · ⌘Esc to leave') : 'running · click to type')}</Meta>
        ) : exitCode !== undefined ? (
          <Meta color={exitCode === 0 ? m.textFaint : m.danger}>{`exit ${exitCode}`}</Meta>
        ) : null}
        {!running && onSendOutput && (session || frozen) ? (
          <Quiet onPress={() => onSendOutput((session?.text() ?? frozen?.output ?? '').trim())}>
            <Meta color={m.textMuted}>Send output to Claude</Meta>
          </Quiet>
        ) : null}
        {onClose ? (
          <Quiet testId={testId ? `${testId}-close` : undefined} onPress={onClose} title={running ? 'End it and close' : 'Close'}>
            <Icon name="x" size={12} />
          </Quiet>
        ) : running ? (
          <Quiet testId={testId ? `${testId}-kill` : undefined} onPress={() => session?.kill()}>
            <Meta color={m.textMuted}>Kill</Meta>
          </Quiet>
        ) : null}
      </div>
      )}
      <div
        ref={ref}
        testId={running ? 'term-running' : undefined}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onLayout={onLayout}
        onClick={focusSelf}
        style={{
          flexGrow: mode === 'full' ? 1 : 0,
          minHeight: mode === 'full' ? 0 : undefined,
          padding: PAD,
          cursor: running ? 'text' : 'default',
          keyboardFocusDim: false,
        }}
      >
        {showAll && allLines ? (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {allLines.map((line, i) => (
              <text key={i} style={{ color: m.termFg, fontFamily: font.term, fontSize: FONT_SIZE, lineHeight: LINE, whiteSpace: 'nowrap' }}>
                {line || ' '}
              </text>
            ))}
          </div>
        ) : grid ? (
          <GridView grid={grid} focused={focused && running} mode={mode} />
        ) : null}
      </div>
      {mode === 'inline' && !running && visibleRows === 0 && !showAll ? (
        <div style={{ paddingLeft: PAD, paddingBottom: 8, marginTop: -6 }}>
          <Meta>Full-screen program ended; nothing was left on screen.</Meta>
        </div>
      ) : null}
      {mode === 'inline' && allLines && allLines.some((l) => l.trim()) && allLines.length > visibleRows ? (
        <div style={{ paddingLeft: PAD - 8, paddingBottom: 6 }}>
          <Quiet onPress={() => setShowAll((v) => !v)}>
            <Meta color={m.textMuted}>{showAll ? 'Show less' : 'Show all'}</Meta>
          </Quiet>
        </div>
      ) : null}
    </div>
  )
}
