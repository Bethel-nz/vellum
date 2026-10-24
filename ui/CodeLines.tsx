// The file pane's long text, mounted a window at a time (ui/windowed.ts): a 5,000-line file
// used to build 5,000 rows at once. Code goes in blocks of a hundred lines, each its own <code>,
// with the line numbers drawn here so they count on across blocks. A block highlights on its own,
// so a comment or string that crosses into the next one can lose its colour there.
//
// The line numbers pick lines (ui/FilePreview.tsx keeps the pick): each block's strip over them
// says which line a press or a drag is on; mid-drag the strips cover the code, since moves go
// only to what's under the pointer.
//
// Markdown goes in pages split at blank lines, before a heading or a paragraph, never inside a
// fence or a list.

import { useEffect, useMemo } from 'react'
import { useGpuixRequired, type EventPayload } from '@gpuix/react'
import { codeLanguage, type Preview } from '../core/preview'
import { useM } from './kit'
import { font, nativeTheme, replyText, replyTheme, type } from './theme'
import { useWindowed } from './windowed'

type Shown = Extract<Preview, { ok: true }>

/** <code> draws every row at the theme's code line height. */
export const ROW = type.mono.lineHeight
export const TOP = 14
const BLOCK = 100
/** Blocks mounted at once: a few screens either side. */
const SPAN = 8
/** Geist Mono's advance at 12px. */
const DIGIT = 7.2

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
  const blocks = useMemo(() => {
    const lines = preview.text.split('\n').slice(0, preview.shown)
    const out: string[] = []
    for (let i = 0; i < lines.length; i += BLOCK) out.push(lines.slice(i, i + BLOCK).join('\n'))
    return out.length ? out : ['']
  }, [preview.text, preview.shown])
  const win = useWindowed(blocks.length, SPAN, [preview.abs, preview.text])
  useEffect(() => {
    if (!line) return
    const target = Math.max(0, line - 1 - 4)
    const index = Math.floor(target / BLOCK)
    win.reveal(index, (index === 0 ? TOP : 0) + (target % BLOCK) * ROW)
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

  return (
    <virtual-list {...win.props} testId="file-preview-scroll" alignment="top" estimatedItemHeight={BLOCK * ROW} overdraw={800} style={{ flexGrow: 1, minHeight: 0, width: '100%', scrollbarColor: m.scrollbar, scrollbarWidth: 6 }}>
      {blocks.slice(win.start, win.end).map((code, k) => {
        const i = win.start + k
        const first = i * BLOCK + 1
        const count = Math.min(BLOCK, preview.shown - i * BLOCK) || 1
        const top = i === 0 ? TOP : 0
        const last = i === blocks.length - 1
        // The washed lines this block holds.
        const a = wash ? Math.max(wash[0], first) : 0
        const b = wash ? Math.min(wash[1], first + count - 1) : -1
        return (
          <div key={i} testId={i === 0 ? 'file-preview-code' : undefined} style={{ display: 'flex', flexDirection: 'column', paddingTop: top, paddingBottom: last ? 32 : 0 }}>
            <div style={{ position: 'relative', display: 'flex', flexDirection: 'row' }}>
              {/* <code> paints no surface, so the wash sits under the lines. */}
              {a <= b ? <div testId={a === wash![0] ? (picked ? 'file-preview-pick' : 'file-preview-line') : undefined} style={{ position: 'absolute', left: 0, right: 0, top: (a - first) * ROW, height: (b - a + 1) * ROW, backgroundColor: m.lineWash }} /> : null}
              <text style={{ width: numbers, flexShrink: 0, paddingRight: 12, textAlign: 'right', fontFamily: font.mono, fontSize: type.mono.fontSize, lineHeight: ROW, color: m.textFaint }}>
                {Array.from({ length: count }, (_, n) => first + n).join('\n')}
              </text>
              <code code={code || ' '} path={preview.abs} language={language} theme={theme} style={{ flexGrow: 1, minWidth: 0, paddingRight: 16, color: m.text, fontFamily: font.mono }} />
              <div
                testId={i === 0 ? 'file-preview-gutter' : `file-preview-gutter-${i}`}
                onMouseDown={(e) => {
                  const at = lineAt(e, first, count)
                  if (at && e.button === 0) onPress(at, Boolean(e.modifiers?.shift))
                }}
                onMouseMove={(e) => {
                  if (!dragging) return
                  const at = lineAt(e, first, count)
                  if (at) onDrag(at, e.pressedButton === 0)
                }}
                onMouseUp={onUp}
                style={{ position: 'absolute', left: 0, top: 0, ...(dragging ? { right: 0 } : { width: numbers }), height: count * ROW, cursor: 'pointer' }}
              />
            </div>
            {last && preview.shown < preview.lines ? (
              <text testId="file-preview-truncated" style={{ paddingLeft: 20, paddingTop: 12, fontSize: 11.5, lineHeight: 16, color: m.textFaint }}>
                {`Showing the first ${preview.shown.toLocaleString()} of ${preview.lines.toLocaleString()} lines`}
              </text>
            ) : null}
          </div>
        )
      })}
    </virtual-list>
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
    <virtual-list {...win.props} testId="file-preview-scroll" alignment="top" estimatedItemHeight={900} overdraw={800} style={{ flexGrow: 1, minHeight: 0, width: '100%', scrollbarColor: m.scrollbar, scrollbarWidth: 6 }}>
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
