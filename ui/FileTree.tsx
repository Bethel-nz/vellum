// The note's folder as a tree, down the left of the file pane (ui/FilePreview.tsx). Folders open
// in place, read as they open (core/filetree.ts); a file opens in the pane. The open file is
// selected, and the folders it sits in open with it. What git ignores is dimmed, and files this
// note changed carry a dot, as do the folders they're in.
//
// Keys, once the tree has focus: ↑↓ move, → opens a folder (or steps in), ← closes it (or steps
// out), ↵ opens a file.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useGpuixRequired, type KeyEvent, type PublicInstance } from '@gpuix/react'
import { Icon } from '../components'
import { listDir, type TreeEntry } from '../core/filetree'
import { FileIcon, useM } from './kit'

const ROW = 24
const INDENT = 12

type Row = TreeEntry & { depth: number }

export function FileTree({ workspace, name, current, changed, expanded, version, width, onToggle, onOpen }: {
  workspace: string
  /** The folder's own name, over the tree. */
  name: string
  /** The open file, from the note's folder. */
  current?: string
  /** Files this note changed, from the note's folder. */
  changed: Set<string>
  expanded: Set<string>
  /** Changes when the note does, so folders are read again. */
  version: string
  width: number
  onToggle: (rel: string, open: boolean) => void
  onOpen: (rel: string) => void
}) {
  const m = useM()
  const renderer = useGpuixRequired()
  const scroller = useRef<PublicInstance>(null)
  const [hover, setHover] = useState<string>()
  const [focus, setFocus] = useState<string>()

  // One read per folder until the note changes again.
  const cache = useMemo(() => new Map<string, TreeEntry[]>(), [workspace, version])
  const read = (rel: string) => {
    let entries = cache.get(rel)
    if (!entries) cache.set(rel, (entries = listDir(workspace, rel)))
    return entries
  }
  const rows: Row[] = []
  const walk = (rel: string, depth: number) => {
    for (const e of read(rel)) {
      rows.push({ ...e, depth })
      if (e.dir && expanded.has(e.rel)) walk(e.rel, depth + 1)
    }
  }
  walk('', 0)
  const changedDirs = useMemo(() => {
    const dirs = new Set<string>()
    for (const f of changed) for (let i = f.indexOf('/'); i > 0; i = f.indexOf('/', i + 1)) dirs.add(f.slice(0, i))
    return dirs
  }, [changed])

  // The open file comes into view once its folders have opened.
  useEffect(() => {
    if (!current || !scroller.current) return
    const i = rows.findIndex((r) => r.rel === current)
    if (i < 0) return
    const id = scroller.current.id
    const t = setTimeout(() => renderer.scrollTo?.(id, 0, -Math.max(0, i * ROW - ROW * 4)), 30)
    return () => clearTimeout(t)
  }, [current])

  const press = (r: Row) => {
    setFocus(r.rel)
    if (r.dir) onToggle(r.rel, !expanded.has(r.rel))
    else onOpen(r.rel)
  }
  const onKeyDown = (e: KeyEvent) => {
    const at = Math.max(0, rows.findIndex((r) => r.rel === (focus ?? current)))
    const r = rows[at]
    if (!r) return
    const move = (i: number) => rows[i] && setFocus(rows[i]!.rel)
    if (e.key === 'down') move(at + 1)
    else if (e.key === 'up') move(at - 1)
    else if (e.key === 'right') r.dir && !expanded.has(r.rel) ? onToggle(r.rel, true) : r.dir && move(at + 1)
    else if (e.key === 'left') {
      if (r.dir && expanded.has(r.rel)) onToggle(r.rel, false)
      else {
        const parent = r.rel.slice(0, r.rel.lastIndexOf('/'))
        if (parent) setFocus(parent)
      }
    } else if (e.key === 'enter' || e.key === 'space') press(r)
    else return
    e.preventDefault()
  }

  return (
    <div testId="file-tree" tabIndex={0} onKeyDown={onKeyDown} style={{ width, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRightWidth: 1, borderColor: m.border, keyboardFocusDim: false }}>
      <text style={{ height: 30, paddingLeft: 14, paddingTop: 8, fontSize: 11.5, lineHeight: 15, fontWeight: 500, color: m.textMuted, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{name}</text>
      <div ref={scroller} style={{ flexGrow: 1, minHeight: 0, overflowY: 'scroll', scrollbarColor: m.scrollbar, scrollbarWidth: 6 }}>
        <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, paddingLeft: 6, paddingRight: 6, paddingBottom: 12 }}>
          {rows.map((r) => {
            const selected = r.rel === current
            const marked = r.dir ? changedDirs.has(r.rel) : changed.has(r.rel)
            const ink = selected ? m.text : r.ignored ? m.textFaint : m.textUi
            return (
              <div
                key={r.rel}
                testId={`file-tree-row-${r.rel}`}
                onClick={() => press(r)}
                onMouseEnter={() => setHover(r.rel)}
                onMouseLeave={() => setHover((h) => (h === r.rel ? undefined : h))}
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  height: ROW,
                  flexShrink: 0,
                  paddingLeft: 6 + r.depth * INDENT,
                  paddingRight: 8,
                  borderRadius: 6,
                  backgroundColor: selected ? m.selected : hover === r.rel ? m.hover : '#00000000',
                  borderWidth: 1,
                  borderColor: focus === r.rel && !selected ? m.borderFocused : '#00000000',
                  cursor: 'pointer',
                }}
              >
                {r.dir ? <Icon name={expanded.has(r.rel) ? 'chevronDown' : 'chevronRight'} size={11} color={m.textFaint} /> : <FileIcon path={r.rel} size={12} />}
                <text style={{ flexGrow: 1, minWidth: 0, fontSize: 12.5, lineHeight: 16, color: ink, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{r.name}</text>
                {marked ? <div testId={`file-tree-changed-${r.rel}`} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: m.warning, flexShrink: 0 }} /> : null}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
