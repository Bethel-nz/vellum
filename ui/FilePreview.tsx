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
// for those edits; and copy path and Open (an editor, Finder, a terminal). The tree (⇧⌘E) runs
// down the pane's left side (ui/FileTree.tsx); the folder button at the strip's right end opens
// the pane on the tree alone.
//
// The pane's left edge and the tree's drag to resize them (app.tsx keeps the sizes): the pane
// stops where the note would have less than NOTE_MIN, the tree between TREE_MIN and TREE_MAX.
// A double click on either edge puts it back.
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
import { bytesLabel, HEX_BYTES, readPreview, type Preview, type PreviewKind } from '../core/preview'
import { CodeLines, MarkdownPages } from './CodeLines'
import { FileTree, type FileMark } from './FileTree'
import { FileIcon, useM } from './kit'
import { OpenIn } from './OpenIn'
import { diffHeaderClip, diffTheme, elevation, font, nativeTheme } from './theme'

/** The pane's file; without a path the pane shows the tree alone. */
export type Previewing = { path?: string; line?: number; endLine?: number }
export type PreviewViewProps = { preview: Extract<Preview, { ok: true }>; line?: number; endLine?: number }

/** Views of their own for some kinds of file; any kind not here reads as code. JSON's goes here. */
export const previewViews: Partial<Record<PreviewKind, (props: PreviewViewProps) => ReactNode>> = {}

/** The tree card's 40pt header, 6pt down: the two line up. */
const HEADER = 46
const PILL = 28
export const TREE_WIDTH = 220
export const TREE_MIN = 160
export const TREE_MAX = 360
/** The file's side of the pane is never narrower than this. */
export const FILE_MIN = 320
/** Where a drag on an edge takes hold. */
const EDGE = 6
/** The tree's card sits this far in from the pane's edges and from the file; its edge is the gap. */
const TREE_INSET = 6
/** The note keeps at least this much beside the pane. */
const NOTE_MIN = 560

const linesLabel = (a: number, b: number) => (a === b ? `Line ${a}` : `Lines ${a}–${b}`)

/**
 * The pane's width for a window, and whether the note keeps enough room to sit beside it. `tree`
 * is the tree's width when it shows, `file` the file side's width once you've dragged it. The tree
 * widens the pane while the note can spare the room; past that the pane goes over the note.
 */
export function previewLayout(windowWidth: number, tree = 0, file?: number) {
  const extra = tree ? tree + TREE_INSET * 2 : 0
  const base = file ?? Math.round(Math.min(720, Math.max(440, windowWidth * 0.44)))
  const room = windowWidth - NOTE_MIN - (tree ? 12 : 0)
  if (room >= (file ? FILE_MIN + extra : base)) return { width: Math.min(base + extra, room), split: true }
  return { width: Math.min(base + extra, windowWidth - 60), split: false }
}

/** A dragged file side, kept to what the window has: beside the note while it can be. */
export function fitFile(windowWidth: number, tree: number, file: number) {
  const extra = tree ? tree + TREE_INSET * 2 : 0
  const room = windowWidth - NOTE_MIN - (tree ? 12 : 0) - extra
  return Math.round(Math.max(FILE_MIN, Math.min(file, room >= FILE_MIN ? room : windowWidth - 60 - extra)))
}

export function FilePreview({ workspace, file, version, width, treeWidth, split, radius, tree, changes, onTree, onOpenFile, onMention, onMentionPath, onViewImage, onResize, onClose }: {
  workspace: string
  file: Previewing
  /** Changes whenever the note does, so the file is read again. */
  version: string
  width: number
  treeWidth: number
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
  /** A file or folder from the tree's menu, for the draft. */
  onMentionPath: (rel: string, dir: boolean) => void
  /** A press on the pane's edge or the tree's, at the pointer's x; a double click resets it. */
  onResize: (edge: 'pane' | 'tree', x: number, reset: boolean) => void
  /** An image file, full size over everything. */
  onViewImage: (src: string) => void
  onClose: () => void
}) {
  const m = useM()
  const renderer = useGpuixRequired()
  const reduced = useReducedMotion()
  const scroller = useRef<PublicInstance>(null)
  const root = useRef<PublicInstance>(null)
  const preview = useMemo(() => (file.path ? readPreview(workspace, file.path) : undefined), [workspace, file.path, version])
  const shown = preview?.ok ? preview : undefined
  const [source, setSource] = useState(Boolean(file.line))
  useEffect(() => setSource(Boolean(file.line)), [file.path, file.line])
  const markdown = shown?.kind === 'markdown'
  const hunks = shown ? changes.get(shown.rel) : undefined
  const [diff, setDiff] = useState(false)
  useEffect(() => setDiff(false), [file.path, file.line])
  const showDiff = diff && Boolean(hunks?.length)
  const drawn = shown?.kind === 'image' || shown?.kind === 'binary'
  const asCode = Boolean(shown) && !showDiff && !drawn && (!markdown || source) && !(shown!.kind in previewViews)
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
  // A file the note made starts its first hunk at nothing.
  const marks = useMemo(() => new Map([...changes].map(([rel, hs]): [string, FileMark] => [rel, hs.some((h) => h.header.startsWith('@@ -0,0 ')) ? 'A' : 'M'])), [changes])
  const folderName = path.basename(workspace) || workspace

  // The pick: where it started and where the pointer is now, in either order.
  const [pick, setPick] = useState<{ from: number; to: number }>()
  // Moves go only to what's under the pointer, so while a drag is on the strip covers the code.
  const [dragging, setDragging] = useState(false)
  useEffect(() => setPick(undefined), [file.path, source, showDiff])
  const picked = pick ? ([Math.min(pick.from, pick.to), Math.max(pick.from, pick.to)] as const) : undefined
  const press = (line: number, shift: boolean) => {
    setDragging(true)
    setPick((p) => (shift && p ? { from: p.from, to: line } : { from: line, to: line }))
    // Keys (↵, esc) go to the pane once a line is picked.
    if (root.current) renderer.focusElement?.(root.current.id)
  }
  const drag = (line: number, held: boolean) => {
    if (!held) return setDragging(false)
    setPick((p) => (p && p.to !== line ? { ...p, to: line } : p))
  }
  const mention = () => {
    if (!picked || !shown) return
    onMention(shown.rel, picked[0], picked[1] > picked[0] ? picked[1] : undefined)
    setPick(undefined)
  }
  // The chip's own lines, washed until a pick takes over.
  const chipLines = file.line ? ([file.line, Math.max(file.line, file.endLine ?? file.line)] as const) : undefined
  const wash = picked ?? chipLines

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
  // The file side keeps its least, even in a window too narrow for both.
  const treeShown = Math.max(120, Math.min(treeWidth, width - 2 - TREE_INSET * 2 - FILE_MIN))
  const contentWidth = width - 2 - (tree ? treeShown + TREE_INSET * 2 : 0)
  // What the path pill has left once the header's buttons and pills are in.
  const pathRoom = contentWidth - 16 - PILL - 6 * 4 - (markdown && !showDiff ? 140 : 0) - (hunks?.length ? (width >= 600 ? 130 : 34) : 0) - (shown ? 98 : 70)
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
        <div style={{ display: 'flex', flexDirection: 'row', flexGrow: 1, minHeight: 0 }}>
          {tree ? (
            <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', minHeight: 0, padding: TREE_INSET, flexShrink: 0 }}>
              <FileTree workspace={workspace} name={folderName} current={shown?.rel} marks={marks} expanded={expanded} version={version} width={treeShown} radius={Math.max(6, radius - TREE_INSET)} onToggle={toggleDir} onOpen={onOpenFile} onMention={onMentionPath} />
              <Edge testId="file-tree-edge" right={0} onPress={(e) => onResize('tree', e.x ?? 0, e.clickCount === 2)} />
            </div>
          ) : null}
          <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, height: HEADER, paddingLeft: 8, paddingRight: 8, flexShrink: 0, ...(tree ? {} : { borderBottomWidth: 1, borderColor: m.border }) }}>
            <div style={{ display: 'flex', flexDirection: 'row', flexGrow: 1, minWidth: 0 }}>
              {/* Beside the tree, which shows where it is, the file is a tab; alone, a path. */}
              {preview && tree ? <FileTab rel={preview.rel} /> : preview ? <PathPill folder={folderName} rel={preview.rel} room={pathRoom} onFolder={revealIn} /> : null}
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
            ) : asCode ? (
              // A new file or mode starts at the top; a chip's line comes into view.
              <CodeLines key={`${file.path}:${source}`} preview={preview} line={file.line} wash={wash} picked={Boolean(picked)} dragging={dragging} onPress={press} onDrag={drag} onUp={() => setDragging(false)} />
            ) : markdown && !source && !View && !showDiff ? (
              <MarkdownPages key={file.path} preview={preview} />
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
                  ) : preview.kind === 'image' ? (
                    <ImageView preview={preview} room={contentWidth} onView={onViewImage} />
                  ) : preview.kind === 'binary' ? (
                    <BinaryView preview={preview} />
                  ) : View ? (
                    <View preview={preview} line={file.line} endLine={file.endLine} />
                  ) : null}
                  {preview.shown < preview.lines && !showDiff && View ? (
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
      <Edge testId="file-preview-edge" left={0} onPress={(e) => onResize('pane', e.x ?? 0, e.clickCount === 2)} />
    </motion.div>
  )
}

/** A strip down an edge that takes the press that starts a resize (app.tsx follows the drag). */
function Edge({ testId, left, right, onPress }: { testId: string; left?: number; right?: number; onPress: (e: EventPayload) => void }) {
  return <div testId={testId} onMouseDown={(e) => e.button === 0 && onPress(e)} style={{ position: 'absolute', left, right, top: 0, bottom: 0, width: EDGE, cursor: 'col-resize' }} />
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

/** The open file as a tab, the way an editor shows it beside its tree. */
function FileTab({ rel }: { rel: string }) {
  const m = useM()
  return (
    <div testId="file-preview-path" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, height: PILL, paddingLeft: 10, paddingRight: 12, borderRadius: 8, backgroundColor: m.popup, borderWidth: 1, borderColor: m.border, minWidth: 0, flexShrink: 1 }}>
      <FileIcon path={rel} size={12} />
      <text testId="file-preview-name" style={{ fontSize: 12.5, lineHeight: 16, fontWeight: 500, color: m.text, whiteSpace: 'nowrap', textOverflow: 'ellipsis', minWidth: 0 }}>{path.basename(rel)}</text>
    </div>
  )
}

/** An image file as itself, fitted to the pane, and what it is. Pressing it opens it full size. */
function ImageView({ preview, room, onView }: { preview: Extract<Preview, { ok: true }>; room: number; onView: (src: string) => void }) {
  const m = useM()
  const natural = preview.size ?? { width: 320, height: 240 }
  const scale = Math.min(1, (room - 48) / natural.width, 640 / natural.height)
  const ext = path.extname(preview.rel).slice(1).toUpperCase()
  const info = [ext, preview.size ? `${preview.size.width} × ${preview.size.height}` : undefined, bytesLabel(preview.bytes)].filter(Boolean).join(' · ')
  return (
    <div testId="file-preview-image" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: 24 }}>
      <div testId="file-preview-image-open" onClick={() => onView(preview.abs)} style={{ borderRadius: 6, borderWidth: 1, borderColor: m.border, overflow: 'hidden', cursor: 'pointer' }}>
        <img src={preview.abs} objectFit="contain" style={{ width: Math.round(natural.width * scale), height: Math.round(natural.height * scale) }} />
      </div>
      <text testId="file-preview-image-info" style={{ fontFamily: font.mono, fontSize: 11.5, lineHeight: 16, color: m.textMuted }}>{info}</text>
    </div>
  )
}

/** Any other binary file: a hex dump of its start, and how much there is. */
function BinaryView({ preview }: { preview: Extract<Preview, { ok: true }> }) {
  const m = useM()
  const more = preview.bytes > HEX_BYTES
  return (
    <div testId="file-preview-binary" style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 14, paddingBottom: 32 }}>
      <text testId="file-preview-binary-info" style={{ paddingLeft: 16, fontSize: 12, lineHeight: 16, color: m.textMuted }}>{`Binary file · ${bytesLabel(preview.bytes)}${more ? ` · the first ${bytesLabel(HEX_BYTES)}` : ''}`}</text>
      <code code={preview.text} language="text" theme={nativeTheme(m)} style={{ paddingLeft: 16, paddingRight: 16, color: m.textUi, fontFamily: font.mono }} />
    </div>
  )
}
