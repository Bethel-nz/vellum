// The note's folder as a tree, an inset card down the left of the file pane (ui/FilePreview.tsx).
// Its header is the folder's name, then search, new file and new folder. Folders open in place,
// read as they open (core/filetree.ts); a file opens in the pane. The open file is selected, and
// the folders it sits in open with it. What git ignores is dimmed, and each file carries its git
// status as a letter (M, A, U for untracked, R, D), the folders above it a dot. Outside a git repo
// the letters are this note's own changes instead.
//
// Search keeps the tree: folders holding a match open, the rest collapse, and matching names are
// washed. It looks through the whole folder (the `#` picker's file list); ↵ opens the first match.
// A right click on a row offers Open, Add to note, a new file or folder there, Copy path, Show in
// Finder and Rename. New file, new folder and rename ask for the name in the row itself.
//
// Keys, once the tree has focus: ↑↓ move, → opens a folder (or steps in), ← closes it (or steps
// out), ↵ opens a file.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useGpuixRequired, type EventPayload, type KeyEvent, type PublicInstance } from '@gpuix/react'
import { Button, Icon, Menu, type MenuItem } from '../components'
import { ancestors, createEntry, gitStatus, listDir, matchFiles, renameEntry, type GitMark, type TreeEntry } from '../core/filetree'
import { copyText, revealFile } from '../core/platform'
import { invalidateFiles, workspaceFiles } from '../core/tags'
import { FileIcon, useM } from './kit'
import { font } from './theme'
import { useWindowed } from './windowed'

const ROW = 24
const INDENT = 12
const TREE_HEADER = 40

type Row = TreeEntry & { depth: number }
/** A letter for a changed file: git's status, or this note's own A and M. */
export type FileMark = GitMark

export function FileTree({ workspace, name, current, marks, expanded, version, width, radius, onToggle, onOpen, onMention }: {
  workspace: string
  /** The folder's own name, over the tree. */
  name: string
  /** The open file, from the note's folder. */
  current?: string
  /** This note's changes, for a folder that isn't a git repo. */
  marks: Map<string, FileMark>
  expanded: Set<string>
  /** Changes when the note does, so folders are read again. */
  version: string
  width: number
  radius: number
  onToggle: (rel: string, open: boolean) => void
  onOpen: (rel: string) => void
  /** Add to note: a file or a folder, by its path from the note's folder. */
  onMention: (rel: string, dir: boolean) => void
}) {
  const m = useM()
  const renderer = useGpuixRequired()
  const root = useRef<PublicInstance>(null)
  const [hover, setHover] = useState<string>()
  const [focus, setFocus] = useState<string>()
  const [query, setQuery] = useState<string>()
  const [files, setFiles] = useState<string[]>([])
  // A name being typed: a new file or folder in `dir`, or a new name for `rel`.
  const [naming, setNaming] = useState<{ kind: 'file' | 'folder' | 'rename'; dir: string; rel?: string; name: string; error?: string }>()
  const [menu, setMenu] = useState<{ row: Row; x: number; y: number }>()
  // Something made or renamed here: read the folders again.
  const [made, setMade] = useState(0)
  const [git, setGit] = useState<Map<string, GitMark>>()
  useEffect(() => {
    let live = true
    void gitStatus(workspace).then((s) => live && setGit(s))
    return () => void (live = false)
  }, [workspace, version, made])
  const shownMarks = git ?? marks

  // One read per folder until the note changes again.
  const cache = useMemo(() => new Map<string, TreeEntry[]>(), [workspace, version, made])
  const read = (rel: string) => {
    let entries = cache.get(rel)
    if (!entries) cache.set(rel, (entries = listDir(workspace, rel)))
    return entries
  }

  useEffect(() => {
    if (query === undefined) return
    void workspaceFiles(workspace).then(setFiles)
  }, [query === undefined, workspace, made])
  const q = query?.trim() ?? ''
  const found = useMemo(() => (q ? matchFiles(files, q, 1000) : []), [files, q])
  const matched = useMemo(() => new Set(found), [found])
  // Searching, the folders holding a match open and every other one closes. A folder pressed
  // while searching opens or closes on top of that until the search changes.
  const holding = useMemo(() => new Set(found.flatMap(ancestors)), [found])
  const [pressed, setPressed] = useState(new Map<string, boolean>())
  useEffect(() => setPressed(new Map()), [q])
  const isOpen = (rel: string) => (q ? (pressed.get(rel) ?? holding.has(rel)) : expanded.has(rel))

  const rows: Row[] = []
  const walk = (rel: string, depth: number) => {
    for (const e of read(rel)) {
      rows.push({ ...e, depth })
      if (e.dir && isOpen(e.rel)) walk(e.rel, depth + 1)
    }
  }
  walk('', 0)
  const markedDirs = useMemo(() => new Set([...shownMarks.keys()].flatMap(ancestors)), [shownMarks])


  const toggle = (r: Row) => {
    if (q) setPressed((all) => new Map(all).set(r.rel, !isOpen(r.rel)))
    else onToggle(r.rel, !expanded.has(r.rel))
  }
  const press = (r: Row) => {
    setFocus(r.rel)
    if (r.dir) toggle(r)
    else onOpen(r.rel)
  }
  /** The folder a new thing goes in, from a row: the folder itself, or the file's. */
  const folderOf = (rel?: string) => {
    const row = rows.find((r) => r.rel === rel)
    return row?.dir ? row.rel : rel && rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
  }
  const startNaming = (kind: 'file' | 'folder', dir = folderOf(focus ?? current)) => {
    if (dir) onToggle(dir, true)
    setQuery(undefined)
    setNaming({ kind, dir, name: '' })
  }
  const finishNaming = () => {
    if (!naming) return
    const out = naming.kind === 'rename' ? renameEntry(workspace, naming.rel!, naming.name) : createEntry(workspace, naming.dir, naming.name, naming.kind)
    if ('error' in out) return setNaming({ ...naming, error: out.error })
    setNaming(undefined)
    invalidateFiles(workspace)
    setMade((n) => n + 1)
    for (const dir of ancestors(out.rel)) onToggle(dir, true)
    setFocus(out.rel)
    if (naming.kind === 'file' || (naming.kind === 'rename' && naming.rel === current)) onOpen(out.rel)
    else if (naming.kind === 'folder') onToggle(out.rel, true)
  }

  const openMenu = (r: Row, e: EventPayload) => {
    if (!e.isRightClick && e.button !== 2) return
    const b = root.current ? renderer.getElementBounds?.(root.current.id) : null
    setFocus(r.rel)
    setMenu({ row: r, x: (e.x ?? 0) - (b?.x ?? 0), y: (e.y ?? 0) - (b?.y ?? 0) })
  }
  const menuItems = (r: Row): MenuItem[] => {
    const dir = r.dir ? r.rel : folderOf(r.rel)
    return [
      ...(r.dir ? [] : [{ label: 'Open', icon: 'file' as const, testId: 'file-tree-menu-open', onSelect: () => onOpen(r.rel) }]),
      { label: 'Add to note', icon: 'plus', testId: 'file-tree-menu-mention', onSelect: () => onMention(r.rel, r.dir) },
      { kind: 'separator' },
      { label: 'New file here', icon: 'filePlus', testId: 'file-tree-menu-new-file', onSelect: () => startNaming('file', dir) },
      { label: 'New folder here', icon: 'folderPlus', testId: 'file-tree-menu-new-folder', onSelect: () => startNaming('folder', dir) },
      { kind: 'separator' },
      { label: 'Copy path', icon: 'copy', testId: 'file-tree-menu-copy', onSelect: () => void copyText(r.rel) },
      { label: 'Show in Finder', icon: 'folder', testId: 'file-tree-menu-reveal', onSelect: () => revealFile(`${workspace}/${r.rel}`) },
      { label: 'Rename…', icon: 'pencil', testId: 'file-tree-menu-rename', onSelect: () => { setQuery(undefined); setNaming({ kind: 'rename', dir: folderOf(r.rel), rel: r.rel, name: r.name }) } },
    ]
  }

  const onKeyDown = (e: KeyEvent) => {
    if (query !== undefined || naming) return
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
  // Esc in a field ends it, not the pane.
  const fieldKeys = (end: () => void) => (e: KeyEvent) => {
    if (e.key !== 'escape') return
    e.preventDefault()
    e.stopPropagation()
    end()
  }

  const iconButton = { width: 26, height: 26, minHeight: 26, paddingLeft: 0, paddingRight: 0, borderRadius: 7 }
  const field = { flexGrow: 1, minWidth: 0, height: 22, fontSize: 12.5, color: m.text, backgroundColor: m.pane, borderWidth: 1, borderColor: m.borderFocused, borderRadius: 5, paddingLeft: 6, paddingRight: 6 }
  const folderIcon = (open: boolean) => <Icon name={open ? 'folderOpen' : 'folderClosed'} size={13} color={m.textMuted} />
  const nameRow = (depth: number, icon: React.ReactNode) =>
    naming ? (
      <div key="naming" style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0, paddingTop: 1, paddingBottom: 1 }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, height: ROW, paddingLeft: 6 + depth * INDENT, paddingRight: 4 }}>
          {icon}
          <input
            testId="file-tree-name"
            value={naming.name}
            autoFocus
            placeholder={naming.kind === 'folder' ? 'Folder name' : naming.kind === 'file' ? 'File name' : 'New name'}
            onChange={(e) => setNaming({ ...naming, name: e.value ?? '', error: undefined })}
            onSubmit={finishNaming}
            onKeyDown={fieldKeys(() => setNaming(undefined))}
            style={field}
          />
        </div>
        {naming.error ? <text testId="file-tree-error" style={{ paddingLeft: 25 + depth * INDENT, fontSize: 11.5, lineHeight: 15, color: m.danger }}>{naming.error}</text> : null}
      </div>
    ) : null
  const making = naming && naming.kind !== 'rename' ? naming : undefined
  const newRow = making ? nameRow(making.dir ? making.dir.split('/').length : 0, making.kind === 'folder' ? folderIcon(false) : <FileIcon path={making.name || 'x.txt'} size={12} />) : null

  const items = [
    ...(making && !making.dir ? [newRow!] : []),
    ...rows.flatMap((r) => {
    if (naming?.kind === 'rename' && naming.rel === r.rel) return [nameRow(r.depth, r.dir ? folderIcon(isOpen(r.rel)) : <FileIcon path={naming.name || r.rel} size={12} />)!]
    const selected = r.rel === current
    const mark = r.dir ? undefined : shownMarks.get(r.rel)
    const tone = mark === 'A' || mark === 'U' ? m.success : mark === 'D' ? m.danger : mark ? m.blue : undefined
    const ink = selected ? m.blue : (tone ?? (r.ignored ? m.textFaint : m.textUi))
    const row = (
      <div
        key={r.rel}
        testId={`file-tree-row-${r.rel}`}
        onClick={() => press(r)}
        onAuxClick={(e) => openMenu(r, e)}
        onMouseEnter={() => setHover(r.rel)}
        onMouseLeave={() => setHover((h) => (h === r.rel ? undefined : h))}
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          height: ROW,
          flexShrink: 0,
          paddingLeft: 6 + r.depth * INDENT,
          paddingRight: 8,
          borderRadius: 6,
          backgroundColor: selected ? m.lineWash : hover === r.rel || menu?.row.rel === r.rel ? m.hover : '#00000000',
          borderWidth: 1,
          borderColor: focus === r.rel && !selected ? m.borderFocused : '#00000000',
          cursor: 'pointer',
        }}
      >
        {/* A guide down each folder it sits in. */}
        {Array.from({ length: r.depth }, (_, k) => (
          <div key={k} style={{ position: 'absolute', left: 12 + k * INDENT, top: 0, bottom: 0, width: 1, backgroundColor: m.borderFocused }} />
        ))}
        {r.dir ? folderIcon(isOpen(r.rel)) : <FileIcon path={r.rel} size={12} />}
        <text highlight={q && matched.has(r.rel) ? { query: q, color: m.selection } : undefined} style={{ flexGrow: 1, minWidth: 0, fontSize: 12.5, lineHeight: 16, color: ink, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          {r.name}
        </text>
        {mark ? (
          <text testId={`file-tree-mark-${r.rel}`} style={{ fontFamily: font.mono, fontSize: 11, lineHeight: 14, fontWeight: 600, color: tone, flexShrink: 0 }}>{mark}</text>
        ) : r.dir && markedDirs.has(r.rel) ? (
          <div testId={`file-tree-mark-${r.rel}`} style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: m.textMuted, flexShrink: 0 }} />
        ) : null}
      </div>
    )
    return making && making.dir === r.rel ? [row, newRow!] : [row]
    }),
    <div key="end" style={{ height: 12 }} />,
  ]
  // Rows are mounted a window at a time (ui/windowed.ts): a folder can hold thousands.
  const win = useWindowed(items.length, 80, [workspace])
  // The open file comes into view once its folders have opened, a few rows down from the top.
  useEffect(() => {
    const i = items.findIndex((it) => it.key === current)
    if (current && !q && i >= 0) win.reveal(Math.max(0, i - 4), 0)
  }, [current, made])
  // Searching, the first match.
  useEffect(() => {
    const i = items.findIndex((it) => it.key === found[0])
    if (q && i >= 0) win.reveal(Math.max(0, i - 3), 0)
  }, [found])
  // And a row the arrows move to.
  useEffect(() => {
    const i = items.findIndex((it) => it.key === focus)
    if (focus && i >= 0) win.reveal(i, 0, true)
  }, [focus])

  return (
    <div ref={root} testId="file-tree" tabIndex={0} onKeyDown={onKeyDown} style={{ position: 'relative', width, flexGrow: 1, flexBasis: 0, minHeight: 0, display: 'flex', flexDirection: 'column', backgroundColor: m.popup, borderWidth: 1, borderColor: m.border, borderRadius: radius, overflow: 'hidden', keyboardFocusDim: false }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 2, height: TREE_HEADER, paddingLeft: 12, paddingRight: 6, flexShrink: 0 }}>
        <text testId="file-tree-name-label" style={{ flexGrow: 1, minWidth: 0, fontSize: 12.5, lineHeight: 16, fontWeight: 500, color: m.text, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{name}</text>
        <Button testId="file-tree-search" selected={query !== undefined} title="Find a file" onPress={() => { setNaming(undefined); setQuery(query === undefined ? '' : undefined) }} style={iconButton}>
          <Icon name="search" size={13} />
        </Button>
        <Button testId="file-tree-new-file" title="New file" onPress={() => startNaming('file')} style={iconButton}>
          <Icon name="filePlus" size={13} />
        </Button>
        <Button testId="file-tree-new-folder" title="New folder" onPress={() => startNaming('folder')} style={iconButton}>
          <Icon name="folderPlus" size={13} />
        </Button>
      </div>
      {query !== undefined ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 8, paddingRight: 8, paddingBottom: 6, flexShrink: 0 }}>
          <input
            testId="file-tree-query"
            value={query}
            autoFocus
            placeholder="Find a file"
            onChange={(e) => setQuery(e.value ?? '')}
            onSubmit={() => found[0] && onOpen(found[0])}
            onKeyDown={fieldKeys(() => setQuery(undefined))}
            style={{ ...field, height: 26 }}
          />
          {q ? (
            <text testId="file-tree-count" style={{ paddingLeft: 2, fontSize: 11, lineHeight: 15, color: m.textFaint }}>
              {found.length ? (found.length === 1 ? '1 file' : `${found.length >= 1000 ? '1000+' : found.length} files`) : `No file matches “${q}”`}
            </text>
          ) : null}
        </div>
      ) : null}
      <virtual-list {...win.props} testId="file-tree-rows" alignment="top" estimatedItemHeight={ROW} overdraw={300} style={{ flexGrow: 1, minHeight: 0, width: '100%', scrollbarColor: m.scrollbar, scrollbarWidth: 6 }}>
        {items.slice(win.start, win.end).map((it) => (
          <div key={it.key} style={{ paddingLeft: 6, paddingRight: 6 }}>
            {it}
          </div>
        ))}
      </virtual-list>
      {menu ? (
        <div style={{ position: 'absolute', left: menu.x, top: menu.y, width: 1, height: 1 }}>
          <Menu open onClose={() => setMenu(undefined)} items={menuItems(menu.row)} width={190} testId="file-tree-menu" closeKey="file-tree-menu" />
        </div>
      ) : null}
    </div>
  )
}
