// A file beside the note: press a file chip and it opens here, at the chip's line if it has one,
// with that line washed blue. Markdown renders, with its source a toggle away; code highlights,
// with line numbers; text reads as it is. JSON gets its own view when one is registered in
// `previewViews`; until then it reads as code. Read-only: "Open in" is for editing.
//
// With room, it takes the right side of the page and the note narrows beside it (app.tsx); in a
// narrow window it slides over the note's right side instead. Esc or the ✕ closes it, and so does
// pressing the same chip again. The file is read again whenever the note changes, so an edit
// Claude makes shows up.

import path from 'node:path'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { motion, useGpuixRequired, type KeyEvent, type PublicInstance } from '@gpuix/react'
import { Button, Icon, Segmented } from '../components'
import { duration, ease, offset, tween, useReducedMotion } from '../components/motion'
import { readPreview, type Preview, type PreviewKind } from '../core/preview'
import { FileIcon, useM } from './kit'
import { elevation, font, nativeTheme, replyText, replyTheme, type } from './theme'

export type Previewing = { path: string; line?: number }
export type PreviewViewProps = { preview: Extract<Preview, { ok: true }>; line?: number }

/** Views of their own for some kinds of file; any kind not here reads as code. JSON's goes here. */
export const previewViews: Partial<Record<PreviewKind, (props: PreviewViewProps) => ReactNode>> = {}

/** <code> draws every row at the theme's code line height. */
const ROW = type.mono.lineHeight
const TOP = 14
const HEADER = 46

/** The pane's width for a window, and whether the note keeps enough room to sit beside it. */
export function previewLayout(windowWidth: number) {
  const width = Math.round(Math.min(720, Math.max(440, windowWidth * 0.44)))
  return { width, split: windowWidth - width >= 560 }
}

export function FilePreview({ workspace, file, version, width, split, onClose }: {
  workspace: string
  file: Previewing
  /** Changes whenever the note does, so the file is read again. */
  version: string
  width: number
  /** Beside the note; otherwise over its right side. */
  split: boolean
  onClose: () => void
}) {
  const m = useM()
  const renderer = useGpuixRequired()
  const reduced = useReducedMotion()
  const scroller = useRef<PublicInstance>(null)
  const preview = useMemo(() => readPreview(workspace, file.path), [workspace, file.path, version])
  const [source, setSource] = useState(Boolean(file.line))
  useEffect(() => setSource(Boolean(file.line)), [file.path, file.line])
  const markdown = preview.ok && preview.kind === 'markdown'
  const asCode = preview.ok && (!markdown || source) && !(preview.kind in previewViews)
  const View = preview.ok ? previewViews[preview.kind] : undefined

  // A new file or mode is a new scroll box, so it starts at the top; a chip's line comes into
  // view a few rows down from it.
  useEffect(() => {
    if (!asCode || !file.line || !scroller.current) return
    const id = scroller.current.id
    const t = setTimeout(() => renderer.scrollTo?.(id, 0, -Math.max(0, TOP + (file.line! - 1) * ROW - ROW * 4)), 30)
    return () => clearTimeout(t)
  }, [file.path, file.line, asCode])

  const onKeyDown = (e: KeyEvent) => {
    if (e.key === 'escape') {
      e.preventDefault()
      onClose()
    }
  }
  const name = path.basename(preview.rel)
  const dir = path.dirname(preview.rel)

  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, right: -offset.dialog }}
      animate={{ opacity: 1, right: 0 }}
      transition={tween({ duration: duration.standard, ease: ease.enter })}
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: m.pane,
        borderLeftWidth: 1,
        borderColor: m.border,
        ...(split ? {} : { boxShadow: elevation(m, 'sheet') }),
      }}
    >
      <div testId="file-preview" tabIndex={0} onKeyDown={onKeyDown} style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, keyboardFocusDim: false }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, height: HEADER, paddingLeft: 16, paddingRight: 8, borderBottomWidth: 1, borderColor: m.border, flexShrink: 0 }}>
          <FileIcon path={preview.rel} size={13} />
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'baseline', gap: 6, flexGrow: 1, minWidth: 0 }}>
            <text testId="file-preview-name" style={{ fontSize: 13, lineHeight: 18, fontWeight: 500, color: m.text, whiteSpace: 'nowrap', flexShrink: 0 }}>{name}</text>
            {dir && dir !== '.' ? <text style={{ fontSize: 11.5, lineHeight: 16, color: m.textFaint, whiteSpace: 'nowrap', textOverflow: 'ellipsis', minWidth: 0 }}>{dir}</text> : null}
          </div>
          {markdown ? (
            <Segmented<'preview' | 'source'> pill testId="file-preview-mode" value={source ? 'source' : 'preview'} onChange={(v) => setSource(v === 'source')} width={66} options={[{ value: 'preview', label: 'Preview' }, { value: 'source', label: 'Source' }]} />
          ) : null}
          <Button testId="file-preview-close" title="Close (esc)" onPress={onClose} style={{ width: 28, paddingLeft: 0, paddingRight: 0 }}>
            <Icon name="x" size={13} />
          </Button>
        </div>
        {!preview.ok ? (
          <div testId="file-preview-unavailable" style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 20 }}>
            <text style={{ fontSize: 13, lineHeight: 18, color: m.textUi }}>Can’t preview this file</text>
            <text style={{ fontSize: 12, lineHeight: 17, color: m.textMuted }}>{preview.reason}</text>
          </div>
        ) : (
          <div key={`${file.path}:${file.line}:${source}`} ref={scroller} testId="file-preview-scroll" style={{ flexGrow: 1, minHeight: 0, overflowY: 'scroll', scrollbarColor: m.scrollbar, scrollbarWidth: 6 }}>
            <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
              {View && !(markdown && source) ? (
                <View preview={preview} line={file.line} />
              ) : markdown && !source ? (
                <div testId="file-preview-markdown" style={{ paddingLeft: 24, paddingRight: 24, paddingTop: 18, paddingBottom: 32 }}>
                  <markdown source={preview.text} theme={replyTheme(m)} style={{ color: replyText(m) }} />
                </div>
              ) : (
                <div testId="file-preview-code" style={{ position: 'relative', paddingTop: TOP, paddingBottom: 32 }}>
                  {/* <code> paints no surface, so the wash sits under the chip's line. */}
                  {file.line && file.line <= preview.shown ? (
                    <div testId="file-preview-line" style={{ position: 'absolute', left: 0, right: 0, top: TOP + (file.line - 1) * ROW, height: ROW, backgroundColor: m.lineWash }} />
                  ) : null}
                  <code code={preview.text || ' '} path={preview.abs} language={preview.kind === 'text' ? 'text' : undefined} showLineNumbers theme={nativeTheme(m)} style={{ paddingLeft: 10, paddingRight: 16, color: m.text, fontFamily: font.mono }} />
                </div>
              )}
              {preview.shown < preview.lines ? (
                <text testId="file-preview-truncated" style={{ paddingLeft: 20, paddingBottom: 24, fontSize: 11.5, lineHeight: 16, color: m.textFaint }}>
                  {`Showing the first ${preview.shown.toLocaleString()} of ${preview.lines.toLocaleString()} lines`}
                </text>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  )
}
