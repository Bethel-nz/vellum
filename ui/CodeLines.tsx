// The file pane's long text, mounted a window at a time: a 5,000-line file used to build 5,000
// rows at once. Code goes in blocks of a hundred lines, each its own <code>, with the line numbers
// drawn here so they count on across blocks. A block highlights on its own, so a comment or string
// that crosses into the next one can lose its colour there.
//
// Each <code> is its own sideways scroller, and <code> reports no scroll to sync the others by, so
// blocks of their own would each scroll apart. Instead a plain scroller holds two columns, the line
// numbers and the code. The code column is the one sideways scroller, every block as wide as the
// longest line so no <code> scrolls on its own and the lines move together; the numbers stay put.
// Rows are a fixed height, so what isn't mounted is a spacer of exact height in each column, and
// the window follows `onScrollChange`.
// The outer scroller scrolls both ways though only its height overflows: one that scrolls only
// down turns a sideways swipe into a vertical one. Markdown keeps the list (ui/windowed.ts): its
// pages have no exact height to stand in for them.
//
// The line numbers pick lines (ui/FilePreview.tsx keeps the pick): each block's strip over them
// says which line a press is on; mid-drag one cover lies over both columns, since moves go only to
// what's under the pointer.
//
// Markdown goes in pages split at blank lines, before a heading or a paragraph, never inside a
// fence or a list.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useGpuixRequired, type EventPayload, type PublicInstance } from '@gpuix/react'
import { codeLanguage, type Preview } from '../core/preview'
import { useM } from './kit'
import { font, nativeTheme, replyText, replyTheme, type, scrollbarWidth } from './theme'
import { useWindowed } from './windowed'

type Shown = Extract<Preview, { ok: true }>

/** <code> draws every row at the theme's code line height. */
export const ROW = type.mono.lineHeight
export const TOP = 14
const BOTTOM = 32
/** The "Showing the first … lines" note under a cut-off file. */
const NOTE = 28
const BLOCK = 100
/** Blocks mounted at once: a few screens either side. */
const SPAN = 8
/** Geist Mono's advance at 12px. */
const DIGIT = 7.2
const TAB = 4

/** How many columns a line takes: a tab to the next stop, wide (CJK, emoji) characters two. */
function columns(line: string) {
  let n = 0
  for (const ch of line) n = ch === '\t' ? n + TAB - (n % TAB) : n + (ch.codePointAt(0)! >= 0x1100 ? 2 : 1)
  return n
}

export function CodeLines({ preview, line, wash, picked, dragging, onPress, onDrag, onUp }: {
  preview: Shown
  /** A chip's line: it comes into view a few rows down from the top. */
  line?: number
  /** Lines washed blue: the pick, else the chip's. */
  wash?: readonly [number, number]
  picked: boolean
  dragging: boolean
  onPress: (line: number, shift: boolean) => void
  onDrag: (line: number, held: boolean) => void
  onUp: () => void
}) {
  const m = useM()
  const renderer = useGpuixRequired()
  const { blocks, widest } = useMemo(() => {
    const lines = preview.text.split('\n').slice(0, preview.shown)
    const out: string[] = []
    for (let i = 0; i < lines.length; i += BLOCK) out.push(lines.slice(i, i + BLOCK).join('\n'))
    return { blocks: out.length ? out : [''], widest: lines.reduce((w, l) => Math.max(w, columns(l)), 0) }
  }, [preview.text, preview.shown])
  const scroller = useRef<PublicInstance>(null)
  const sideways = useRef<PublicInstance>(null)
  // A swipe keeps to the axis it started on, as a Mac view does: a sideways swipe's few points
  // of vertical drift would walk the file up and down. The two scrollers report their moves;
  // those of one frame are weighed together, the larger picks the swipe's axis for as long as
  // it keeps moving, and the other is put back.
  const at = useRef({ x: 0, y: 0 })
  const lock = useRef<{ axis: 'x' | 'y'; until: number }>({ axis: 'y', until: 0 })
  const pending = useRef<{ x?: number; y?: number }>({})
  const settle = () => {
    const p = pending.current
    pending.current = {}
    const now = Date.now()
    const dx = p.x === undefined ? 0 : p.x - at.current.x
    const dy = p.y === undefined ? 0 : p.y - at.current.y
    const axis = now < lock.current.until ? lock.current.axis : Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
    lock.current = { axis, until: now + 150 }
    if (axis === 'x') {
      if (p.x !== undefined) at.current.x = p.x
      if (p.y !== undefined && scroller.current) renderer.scrollTo?.(scroller.current.id, 0, -at.current.y)
    } else {
      if (p.y !== undefined) at.current.y = p.y
      if (p.x !== undefined && sideways.current) renderer.scrollTo?.(sideways.current.id, -at.current.x, 0)
      setStart(around(at.current.y))
    }
  }
  const moved = (axis: 'x' | 'y', value: number) => {
    if (Math.abs(value - at.current[axis]) < 0.5) return
    if (pending.current.x === undefined && pending.current.y === undefined) setTimeout(settle, 0)
    pending.current[axis] = value
  }
  const [wanted, setStart] = useState(0)
  const total = blocks.length
  const start = Math.max(0, Math.min(wanted, total - SPAN))
  const end = Math.min(total, start + SPAN)
  const truncated = preview.shown < preview.lines
  /** Where block `i` starts in a column. */
  const offset = (i: number) => (i === 0 ? 0 : TOP + i * BLOCK * ROW)
  const height = TOP + preview.shown * ROW + BOTTOM + (truncated ? NOTE : 0)
  /** The window for a scroll at `y` down: a block above it, the rest below. */
  const around = (y: number) => Math.max(0, Math.min(Math.floor((y - TOP) / (BLOCK * ROW)) - 1, total - SPAN))
  useEffect(() => {
    setStart(0)
    at.current = { x: 0, y: 0 }
  }, [preview.abs, preview.text])
  useEffect(() => {
    if (!line) return
    const y = TOP + Math.max(0, line - 1 - 4) * ROW
    setStart(around(y))
    // Once the window has the line.
    const id = scroller.current?.id
    if (id !== undefined) setTimeout(() => renderer.scrollTo?.(id, 0, -y), 16)
  }, [preview.abs, line])

  const numbers = String(preview.shown).length * DIGIT + 22
  /** Which line a press at window y is on, in the block `first` starts. */
  const lineAt = (e: EventPayload, first: number, count: number) => {
    const b = renderer.getElementBounds?.(e.elementId)
    if (!b || e.y === undefined) return undefined
    return first + Math.min(count - 1, Math.max(0, Math.floor((e.y - b.y) / ROW)))
  }
  const theme = nativeTheme(m)
  const language = preview.kind === 'text' ? 'text' : codeLanguage(preview.abs)

  /** One column: the room of the blocks above the window, the window's blocks, the room below. */
  const column = (block: (i: number, first: number, count: number, a: number, b: number) => ReactNode) => (
    <>
      <div style={{ height: offset(start), flexShrink: 0 }} />
      {blocks.slice(start, end).map((_, k) => {
        const i = start + k
        const first = i * BLOCK + 1
        const count = Math.min(BLOCK, preview.shown - i * BLOCK) || 1
        const last = i === total - 1
        // The washed lines this block holds.
        const a = wash ? Math.max(wash[0], first) : 0
        const b = wash ? Math.min(wash[1], first + count - 1) : -1
        return (
          <div key={i} style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', height: (i === 0 ? TOP : 0) + count * ROW + (last ? BOTTOM + (truncated ? NOTE : 0) : 0), paddingTop: i === 0 ? TOP : 0 }}>
            {block(i, first, count, a, b)}
          </div>
        )
      })}
      {end < total ? <div style={{ height: height - offset(end), flexShrink: 0 }} /> : null}
    </>
  )
  /** <code> paints no surface, so the wash sits under the lines, in both columns. */
  const washed = (i: number, first: number, a: number, b: number, col: string) =>
    a <= b ? <div testId={col === 'code' && a === wash![0] ? (picked ? 'file-preview-pick' : 'file-preview-line') : undefined} style={{ position: 'absolute', left: 0, right: 0, top: (a - first) * ROW, height: (b - a + 1) * ROW, backgroundColor: m.lineWash }} /> : null
  /** The strip over a block's numbers that says which line a press is on. */
  const strip = (first: number, count: number, testId?: string) => (
    <div
      testId={testId}
      onMouseDown={(e) => {
        const at = lineAt(e, first, count)
        if (at && e.button === 0) onPress(at, Boolean(e.modifiers?.shift))
      }}
      onMouseUp={onUp}
      style={{ position: 'absolute', left: 0, top: 0, right: 0, height: count * ROW, cursor: 'pointer' }}
    />
  )

  return (
    <div
      ref={scroller}
      testId="file-preview-scroll"
      onScrollChange={(e) => moved('y', -(e.scrollY ?? 0))}
      style={{ flexGrow: 1, minHeight: 0, width: '100%', overflow: 'scroll', scrollbarColor: m.scrollbar, scrollbarWidth }}
    >
      <div style={{ position: 'relative', flexShrink: 0, width: '100%', display: 'flex', flexDirection: 'row' }}>
        <div style={{ width: numbers, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
          {column((i, first, count, a, b) => (
            <div style={{ position: 'relative', height: count * ROW }}>
              {washed(i, first, a, b, 'numbers')}
              <text style={{ paddingRight: 12, textAlign: 'right', fontFamily: font.mono, fontSize: type.mono.fontSize, lineHeight: ROW, color: m.textFaint }}>
                {Array.from({ length: count }, (_, n) => first + n).join('\n')}
              </text>
              {strip(first, count, i === 0 ? 'file-preview-gutter' : `file-preview-gutter-${i}`)}
            </div>
          ))}
        </div>
        <div ref={sideways} onScrollChange={(e) => moved('x', -(e.scrollX ?? 0))} style={{ flexGrow: 1, minWidth: 0, overflowX: 'scroll' }}>
          <div style={{ width: widest * DIGIT + 16 + 2 * DIGIT, minWidth: '100%', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
            {column((i, first, count, a, b) => (
              <>
                <div testId={i === 0 ? 'file-preview-code' : undefined} style={{ position: 'relative', height: count * ROW, display: 'flex', flexDirection: 'column' }}>
                  {washed(i, first, a, b, 'code')}
                  <code code={blocks[i] || ' '} path={preview.abs} language={language} theme={theme} style={{ paddingRight: 16, color: m.text, fontFamily: font.mono }} />
                </div>
                {i === total - 1 && truncated ? (
                  <text testId="file-preview-truncated" style={{ paddingLeft: 8, paddingTop: 12, fontSize: 11.5, lineHeight: 16, color: m.textFaint }}>
                    {`Showing the first ${preview.shown.toLocaleString()} of ${preview.lines.toLocaleString()} lines`}
                  </text>
                ) : null}
              </>
            ))}
          </div>
        </div>
        {/* Mid-drag one cover over both columns says which line the pointer is on. */}
        {dragging ? (
          <div
            onMouseMove={(e) => {
              const at = lineAt(e, 1, preview.shown)
              if (at) onDrag(at, e.pressedButton === 0)
            }}
            onMouseUp={onUp}
            style={{ position: 'absolute', left: 0, right: 0, top: TOP, height: preview.shown * ROW, cursor: 'pointer' }}
          />
        ) : null}
      </div>
    </div>
  )
}

/** Markdown in pages of about this many lines. */
const PAGE = 80

/** Splits at a blank line outside a fence when what follows starts a heading or a paragraph. */
export function markdownPages(source: string): string[] {
  const lines = source.split('\n')
  const pages: string[] = []
  let page: string[] = []
  let fence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    page.push(line)
    const next = lines[i + 1]
    if (!fence && page.length >= PAGE && !line.trim() && next !== undefined && /^(#{1,6}\s|[A-Za-z*_`[(])/.test(next) && !/^[*+-]\s/.test(next)) {
      pages.push(page.join('\n'))
      page = []
    }
  }
  if (page.length) pages.push(page.join('\n'))
  return pages
}

export function MarkdownPages({ preview }: { preview: Shown }) {
  const m = useM()
  const pages = useMemo(() => markdownPages(preview.text), [preview.text])
  const win = useWindowed(pages.length, 6, [preview.abs, preview.text])
  return (
    <virtual-list {...win.props} testId="file-preview-scroll" alignment="top" estimatedItemHeight={900} overdraw={800} style={{ flexGrow: 1, minHeight: 0, width: '100%', scrollbarColor: m.scrollbar, scrollbarWidth }}>
      {pages.slice(win.start, win.end).map((page, k) => {
        const i = win.start + k
        return (
          <div key={i} testId={i === 0 ? 'file-preview-markdown' : undefined} style={{ paddingLeft: 24, paddingRight: 24, paddingTop: i === 0 ? 18 : 12, paddingBottom: i === pages.length - 1 ? 32 : 0 }}>
            <markdown source={page} theme={replyTheme(m)} style={{ color: replyText(m) }} />
          </div>
        )
      })}
    </virtual-list>
  )
}
