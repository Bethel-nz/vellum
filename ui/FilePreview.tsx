// A file beside the note: press a file chip and it opens here, at the chip's line if it has one,
// with that line washed blue. Markdown renders, with its source a toggle away; code highlights,
// with line numbers; text reads as it is. JSON gets its own view when one is registered in
// `previewViews`; until then it reads as code. Read-only: "Open" is for editing.
//
// The pane is a card of its own beside the note's (app.tsx); in a narrow window it slides over
// the note's right side instead. Esc or the ✕ closes it, and so does pressing the same chip
// again. The file is read again whenever the note changes, so an edit Claude makes shows up.
//
// The header is a row of pills: where the file is, as a path from the note's folder (a folder in
// it opens the tree there); "Show changes" when this note edited the file, which swaps the file
// for those edits; and copy path and Open (an editor, Finder, a terminal). The tree (⇧⌘E, or the
// button at the header's left) runs down the pane's left side (ui/FileTree.tsx); the Files button
// on the strip opens the pane on the tree alone.
//
// In the code view the line numbers pick lines: press one, drag down or up, or ⇧-click to stretch
// the pick, and "Add to note" (↵) drops a `#path:12-18` chip into the draft, the same tag a line
// chip is. Esc clears a pick before it closes the pane.

import path from 'node:path'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { motion, useGpuixRequired, type EventPayload, type KeyEvent, type PublicInstance } from '@gpuix/react'
import { Button, Icon, Label, Segmented } from '../components'
import { duration, ease, offset, tween, useReducedMotion } from '../components/motion'
import type { Hunk } from '../core/changes'
import { ancestors } from '../core/filetree'
import { copyText, keys } from '../core/platform'
import { readPreview, type Preview, type PreviewKind } from '../core/preview'
import { FileTree } from './FileTree'
import { FileIcon, useM } from './kit'
import { OpenIn } from './OpenIn'
import { diffHeaderClip, diffTheme, elevation, font, nativeTheme, replyText, replyTheme, type } from './theme'

/** The pane's file; without a path the pane shows the tree alone. */
export type Previewing = { path?: string; line?: number; endLine?: number }
export type PreviewViewProps = { preview: Extract<Preview, { ok: true }>; line?: number; endLine?: number }

/** Views of their own for some kinds of file; any kind not here reads as code. JSON's goes here. */
export const previewViews: Partial<Record<PreviewKind, (props: PreviewViewProps) => ReactNode>> = {}

/** <code> draws every row at the theme's code line height. */
const ROW = type.mono.lineHeight
const TOP = 14
const HEADER = 46
/** The strip over <code>'s line numbers that picks lines. */
const GUTTER = 46
const PILL = 28
export const TREE_WIDTH = 220
/** The note keeps at least this much beside the pane. */
const NOTE_MIN = 560

const linesLabel = (a: number, b: number) => (a === b ? `Line ${a}` : `Lines ${a}–${b}`)

/**
 * The pane's width for a window, and whether the note keeps enough room to sit beside it. The
 * tree widens the pane while the note can spare the room; past that the pane goes over the note.
 */
export function previewLayout(windowWidth: number, tree = false) {
  const base = Math.round(Math.min(720, Math.max(440, windowWidth * 0.44)))
  if (!tree) return { width: base, split: windowWidth - base >= NOTE_MIN }
  const beside = Math.min(base + TREE_WIDTH, windowWidth - NOTE_MIN - 12)
  if (beside >= base) return { width: beside, split: true }
  return { width: Math.min(base + TREE_WIDTH, windowWidth - 60), split: false }
}

export function FilePreview({ workspace, file, version, width, split, radius, tree, changes, onTree, onOpenFile, onMention, onClose }: {
  workspace: string
  file: Previewing
  /** Changes whenever the note does, so the file is read again. */
  version: string
  width: number
  /** Beside the note; otherwise over its right side. */
  split: boolean
  /** The page card's corner, so the two cards match. */
  radius: number
  tree: boolean
  /** This note's edits, by file from the note's folder. */
  changes: Map<string, Hunk[]>
  onTree: (open: boolean) => void
  /** A file picked in the tree, from the note's folder. */
  onOpenFile: (file: string) => void
  /** Picked lines, for the draft: the file as the note's folder names it. */
  onMention: (file: string, line: number, endLine?: number) => void
  onClose: () => void
}) {
  const m = useM()
  const renderer = useGpuixRequired()
  const reduced = useReducedMotion()
  const scroller = useRef<PublicInstance>(null)
  const root = useRef<PublicInstance>(null)
  const gutter = useRef<PublicInstance>(null)
  const preview = useMemo(() => (file.path ? readPreview(workspace, file.path) : undefined), [workspace, file.path, version])
  const shown = preview?.ok ? preview : undefined
  const [source, setSource] = useState(Boolean(file.line))
  useEffect(() => setSource(Boolean(file.line)), [file.path, file.line])
  const markdown = shown?.kind === 'markdown'
  const hunks = shown ? changes.get(shown.rel) : undefined
  const [diff, setDiff] = useState(false)
  useEffect(() => setDiff(false), [file.path, file.line])
  const showDiff = diff && Boolean(hunks?.length)
  const asCode = Boolean(shown) && !showDiff && (!markdown || source) && !(shown!.kind in previewViews)
  const View = shown && !showDiff ? previewViews[shown.kind] : undefined

  // The tree opens the folders the file sits in, and keeps whatever else you opened.
  const [expanded, setExpanded] = useState(() => new Set(shown ? ancestors(shown.rel) : []))
  useEffect(() => {
    if (shown) setExpanded((all) => new Set([...all, ...ancestors(shown.rel)]))
  }, [shown?.rel])
  const toggleDir = (rel: string, open: boolean) =>
    setExpanded((all) => {
      const next = new Set(all)
      if (open) next.add(rel)
      else next.delete(rel)
      return next
    })
  const changed = useMemo(() => new Set(changes.keys()), [changes])
  const folderName = path.basename(workspace) || workspace

  // The pick: where it started and where the pointer is now, in either order.
  const [pick, setPick] = useState<{ from: number; to: number }>()
  // Moves go only to what's under the pointer, so while a drag is on the strip covers the code.
  const [dragging, setDragging] = useState(false)
  useEffect(() => setPick(undefined), [file.path, source, showDiff])
  const picked = pick ? ([Math.min(pick.from, pick.to), Math.max(pick.from, pick.to)] as const) : undefined
  const lineAt = (y?: number) => {
    const b = gutter.current ? renderer.getElementBounds?.(gutter.current.id) : null
    if (!b || y === undefined || !shown) return undefined
    return Math.min(shown.shown, Math.max(1, Math.floor((y - b.y) / ROW) + 1))
  }
  const press = (e: EventPayload) => {
    const line = lineAt(e.y)
    if (!line) return
    setDragging(true)
    setPick((p) => (e.modifiers?.shift && p ? { from: p.from, to: line } : { from: line, to: line }))
    // Keys (↵, esc) go to the pane once a line is picked.
    if (root.current) renderer.focusElement?.(root.current.id)
  }
  const drag = (e: EventPayload) => {
    if (!dragging) return
    if (e.pressedButton !== 0) return setDragging(false)
    const line = lineAt(e.y)
    if (line) setPick((p) => (p && p.to !== line ? { ...p, to: line } : p))
  }
  const mention = () => {
    if (!picked || !shown) return
    onMention(shown.rel, picked[0], picked[1] > picked[0] ? picked[1] : undefined)
    setPick(undefined)
  }
  // The chip's own lines, washed until a pick takes over.
  const chipLines = file.line ? ([file.line, Math.max(file.line, file.endLine ?? file.line)] as const) : undefined
  const wash = picked ?? chipLines

  // A new file or mode is a new scroll box, so it starts at the top; a chip's line comes into
  // view a few rows down from it.
  useEffect(() => {
    if (!asCode || !file.line || !scroller.current) return
    const id = scroller.current.id
    const t = setTimeout(() => renderer.scrollTo?.(id, 0, -Math.max(0, TOP + (file.line! - 1) * ROW - ROW * 4)), 30)
    return () => clearTimeout(t)
  }, [file.path, file.line, asCode])

  const onKeyDown = (e: KeyEvent) => {
    if (e.key === 'enter' && picked) {
      e.preventDefault()
      mention()
    } else if (e.key === 'escape') {
      e.preventDefault()
      if (picked) setPick(undefined)
      else onClose()
    }
  }
  // What the path pill has left once the header's buttons and pills are in.
  const pathRoom = width - 16 - PILL * 2 - 6 * 5 - (markdown && !showDiff ? 140 : 0) - (hunks?.length ? (width >= 600 ? 130 : 34) : 0) - (shown ? 98 : 70)
  /** A folder in the path: the tree opens, down to it. */
  const revealIn = (dir: string) => {
    onTree(true)
    if (dir) setExpanded((all) => new Set([...all, ...ancestors(`${dir}/-`)]))
  }

  return (
    <motion.div
      // Beside the note it's a card in the row and slides in from the right; over the note it
      // sits on the right edge.
      initial={reduced ? false : split ? { opacity: 0, left: offset.dialog } : { opacity: 0, right: -offset.dialog }}
      animate={split ? { opacity: 1, left: 0 } : { opacity: 1, right: 0 }}
      transition={tween({ duration: duration.standard, ease: ease.enter })}
      style={{
        ...(split ? { position: 'relative', flexShrink: 0 } : { position: 'absolute', top: 0, right: 0, bottom: 0 }),
        width,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: m.pane,
        borderRadius: radius,
        borderWidth: 1,
        borderColor: m.border,
        overflow: 'hidden',
        boxShadow: split ? { offsetX: 0, offsetY: 1, blurRadius: 0, spreadRadius: 0, color: m.paneHighlight, inset: true } : elevation(m, 'sheet'),
      }}
    >
      <div ref={root} testId="file-preview" tabIndex={0} onKeyDown={onKeyDown} style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, keyboardFocusDim: false }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, height: HEADER, paddingLeft: 8, paddingRight: 8, borderBottomWidth: 1, borderColor: m.border, flexShrink: 0 }}>
          <Button testId="file-preview-tree" selected={tree} title={keys(tree ? 'Hide files (⇧⌘E)' : 'Show files (⇧⌘E)')} onPress={() => onTree(!tree)} style={{ width: PILL, height: PILL, minHeight: PILL, paddingLeft: 0, paddingRight: 0 }}>
            <Icon name="panelLeft" size={14} />
          </Button>
          <div style={{ display: 'flex', flexDirection: 'row', flexGrow: 1, minWidth: 0 }}>
            {preview ? <PathPill folder={folderName} rel={preview.rel} room={pathRoom} onFolder={revealIn} /> : null}
          </div>
          {markdown && !showDiff ? (
            <Segmented<'preview' | 'source'> pill testId="file-preview-mode" value={source ? 'source' : 'preview'} onChange={(v) => setSource(v === 'source')} width={66} options={[{ value: 'preview', label: 'Preview' }, { value: 'source', label: 'Source' }]} />
          ) : null}
          {hunks?.length ? (
            <Button testId="file-preview-changes" selected={showDiff} title={showDiff ? 'Back to the file' : 'What this note changed in the file'} onPress={() => setDiff(!showDiff)} style={pill(m)}>
              <Icon name="diff" size={13} />
              {width >= 600 ? <Label>{showDiff ? 'Show file' : 'Show changes'}</Label> : null}
            </Button>
          ) : null}
          <FileActions folder={workspace} rel={shown?.rel} abs={shown?.abs} />
          <Button testId="file-preview-close" title="Close (esc)" onPress={onClose} style={{ width: PILL, height: PILL, minHeight: PILL, paddingLeft: 0, paddingRight: 0 }}>
            <Icon name="x" size={13} />
          </Button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'row', flexGrow: 1, minHeight: 0 }}>
          {tree ? (
            <FileTree workspace={workspace} name={folderName} current={shown?.rel} changed={changed} expanded={expanded} version={version} width={Math.min(TREE_WIDTH, Math.round(width * 0.4))} onToggle={toggleDir} onOpen={onOpenFile} />
          ) : null}
          <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 }}>
            {!preview ? (
              <div testId="file-preview-empty" style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 20 }}>
                <text style={{ fontSize: 13, lineHeight: 18, color: m.textUi }}>No file open</text>
                <text style={{ fontSize: 12, lineHeight: 17, color: m.textMuted }}>{tree ? 'Pick one from the tree to read it here.' : keys('Show the files (⇧⌘E) to pick one.')}</text>
              </div>
            ) : !preview.ok ? (
              <div testId="file-preview-unavailable" style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 20 }}>
                <text style={{ fontSize: 13, lineHeight: 18, color: m.textUi }}>Can’t preview this file</text>
                <text style={{ fontSize: 12, lineHeight: 17, color: m.textMuted }}>{preview.reason}</text>
              </div>
            ) : (
              <div key={`${file.path}:${file.line}:${source}:${showDiff}`} ref={scroller} testId="file-preview-scroll" style={{ flexGrow: 1, minHeight: 0, overflowY: 'scroll', scrollbarColor: m.scrollbar, scrollbarWidth: 6 }}>
                <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
                  {showDiff ? (
                    <div testId="file-preview-diff" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12, paddingBottom: 32 }}>
                      {hunks!.map((h) => (
                        <div key={h.id} style={{ overflow: 'hidden', paddingTop: 4, borderRadius: 8, borderWidth: 1, borderColor: m.border, backgroundColor: m.codeBg }}>
                          <diff patch={`--- a/${preview.rel}\n+++ b/${preview.rel}\n${h.patch}`} wordDiff theme={diffTheme(m)} style={{ marginTop: -diffHeaderClip }} />
                        </div>
                      ))}
                    </div>
                  ) : View && !(markdown && source) ? (
                    <View preview={preview} line={file.line} endLine={file.endLine} />
                  ) : markdown && !source ? (
                    <div testId="file-preview-markdown" style={{ paddingLeft: 24, paddingRight: 24, paddingTop: 18, paddingBottom: 32 }}>
                      <markdown source={preview.text} theme={replyTheme(m)} style={{ color: replyText(m) }} />
                    </div>
                  ) : (
                    <div testId="file-preview-code" style={{ position: 'relative', paddingTop: TOP, paddingBottom: 32 }}>
                      {/* <code> paints no surface, so the wash sits under the lines. */}
                      {wash && wash[0] <= preview.shown ? (
                        <div
                          testId={picked ? 'file-preview-pick' : 'file-preview-line'}
                          style={{ position: 'absolute', left: 0, right: 0, top: TOP + (wash[0] - 1) * ROW, height: (Math.min(wash[1], preview.shown) - wash[0] + 1) * ROW, backgroundColor: m.lineWash }}
                        />
                      ) : null}
                      <code code={preview.text || ' '} path={preview.abs} language={preview.kind === 'text' ? 'text' : undefined} showLineNumbers theme={nativeTheme(m)} style={{ paddingLeft: 10, paddingRight: 16, color: m.text, fontFamily: font.mono }} />
                      {/* Over the line numbers, after <code> so it takes the press; over all of it mid-drag. */}
                      <div ref={gutter} testId="file-preview-gutter" onMouseDown={press} onMouseMove={drag} onMouseUp={() => setDragging(false)} style={{ position: 'absolute', left: 0, top: TOP, ...(dragging ? { right: 0 } : { width: GUTTER }), height: preview.shown * ROW, cursor: 'pointer' }} />
                    </div>
                  )}
                  {preview.shown < preview.lines && !showDiff ? (
                    <text testId="file-preview-truncated" style={{ paddingLeft: 20, paddingBottom: 24, fontSize: 11.5, lineHeight: 16, color: m.textFaint }}>
                      {`Showing the first ${preview.shown.toLocaleString()} of ${preview.lines.toLocaleString()} lines`}
                    </text>
                  ) : null}
                </div>
              </div>
            )}
            {picked ? (
              <div testId="file-preview-mention-bar" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, height: 44, paddingLeft: 16, paddingRight: 8, borderTopWidth: 1, borderColor: m.border, flexShrink: 0 }}>
                <text testId="file-preview-picked" style={{ fontSize: 12.5, lineHeight: 16, color: m.textUi, flexGrow: 1 }}>{linesLabel(picked[0], picked[1])}</text>
                <Button testId="file-preview-clear" title="Clear (esc)" onPress={() => setPick(undefined)}>
                  <Label muted>Clear</Label>
                </Button>
                <Button testId="file-preview-mention" variant="solid" title="Add to note (↵)" onPress={mention}>
                  <Label variant="solid">Add to note</Label>
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </motion.div>
  )
}

/** The strip's pill, the one "files changed" sits on. */
const pill = (m: ReturnType<typeof useM>) => ({ height: PILL, minHeight: PILL, borderRadius: PILL / 2, paddingLeft: 10, paddingRight: 10, backgroundColor: m.chipBg, borderWidth: 1, borderColor: m.border })

/** A mono crumb's width at 11.5px, and what a chevron between two crumbs adds. */
const CHAR = 7
const SEP = 19

/**
 * Where the file is: the note's folder, the folders under it, then the file. A folder opens the
 * tree there. When the pill hasn't room, the outer folders fold into one "…" and the file and its
 * nearest folders stay whole.
 */
function PathPill({ folder, rel, room, onFolder }: { folder: string; rel: string; room: number; onFolder: (dir: string) => void }) {
  const m = useM()
  const dirs = rel.split('/')
  const name = dirs.pop()!
  // The note's folder is crumb -1; folder i is dirs[0..i].
  const crumbs = [{ i: -1, label: folder }, ...dirs.map((label, i) => ({ i, label }))]
  let left = room - 24 - 17 - name.length * CHAR
  let keep = crumbs.length
  while (keep > 0 && left - (crumbs[keep - 1]!.label.length * CHAR + SEP) - (keep > 1 ? CHAR + SEP : 0) >= 0) left -= crumbs[--keep]!.label.length * CHAR + SEP
  const kept = crumbs.slice(keep)
  const folded = keep > 0
  const crumb = { fontFamily: font.mono, fontSize: 11.5, lineHeight: 16, whiteSpace: 'nowrap', flexShrink: 0 } as const
  const sep = <Icon name="chevronRight" size={9} color={m.textFaint} />
  return (
    <div testId="file-preview-path" style={{ ...pill(m), display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 0, flexShrink: 1, overflow: 'hidden' }}>
      {folded ? (
        <>
          <text testId="file-preview-crumb-folded" onClick={() => onFolder(crumbs[keep - 1]!.i < 0 ? '' : dirs.slice(0, crumbs[keep - 1]!.i + 1).join('/'))} style={{ ...crumb, color: m.textFaint, cursor: 'pointer' }}>…</text>
          {sep}
        </>
      ) : null}
      {kept.map(({ i, label }) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          <text testId={i < 0 ? 'file-preview-crumb-root' : `file-preview-crumb-${i}`} onClick={() => onFolder(i < 0 ? '' : dirs.slice(0, i + 1).join('/'))} style={{ ...crumb, color: m.textMuted, cursor: 'pointer' }}>{label}</text>
          {sep}
        </div>
      ))}
      <FileIcon path={rel} size={12} />
      <text testId="file-preview-name" style={{ ...crumb, color: m.text, fontWeight: 500, flexShrink: 1, minWidth: 0, textOverflow: 'ellipsis' }}>{name}</text>
    </div>
  )
}

/** Copy the path and Open in (the file, or the folder with none open): one pill. */
function FileActions({ folder, rel, abs }: { folder: string; rel?: string; abs?: string }) {
  const m = useM()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1200)
    return () => clearTimeout(t)
  }, [copied])
  const icon = { width: 26, height: 24, minHeight: 24, borderRadius: 12, paddingLeft: 0, paddingRight: 0 }
  return (
    <div style={{ ...pill(m), display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 0, paddingLeft: 1, paddingRight: 1, flexShrink: 0 }}>
      {rel ? (
        <Button testId="file-preview-copy" title={copied ? 'Copied' : 'Copy the path'} onPress={() => setCopied(copyText(rel))} style={icon}>
          <Icon name={copied ? 'check' : 'copy'} size={13} />
        </Button>
      ) : null}
      <OpenIn folder={folder} file={abs} />
    </div>
  )
}
