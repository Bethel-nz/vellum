// Changes (⇧⌘D, or the count in the strip): every file Claude edited in this note, or the
// folder's uncommitted edits, in a sheet from the right. Rows read like an editor's review list:
// file-type glyph, name, folder in faint mono, +n −m, status. A row opens to its hunks; clicking a
// hunk's header selects it (violet wash and gutter tick). Clicking a line inside a hunk opens a
// comment field for that line. "Add" puts picked hunks in your draft as ± pills that carry the
// hunk and its comments (core/changes.ts hunkTags), and a comment on a hunk you didn't pick as a
// pill that carries only the line and what you said (commentTags); Claude gets them spelled out.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { EventPayload } from '@gpuix/react'
import { motion } from '../components/spring'
import { Button, CloseButton, iconButton, Dot, Field, FileIcon, Icon, Label, Menu, SidePanel } from '../components'
import { ChangeTotals } from '../components/ChangesSummary'
import { duration, ease, tween } from '../components/motion'
import { changeCount, chunkHunk, collectChanges, hunkRows, noteFor, noteLabel, noteRows, rowOf, splitHunks, type FileChange, type Hunk, type HunkRow } from '../core/changes'
import { uncommittedFiles, type GitFile } from '../core/gitsnap'
import type { HunkNote, Thread } from '../core/threads'
import { Meta, useM } from './kit'
import { concentric, diffHeaderClip, diffInk, diffTheme, font, radiusXl, scrollbarWidth } from './theme'
import { useAgent } from '../components/AgentContext'
import { useWindowed } from './windowed'
import { forDiff } from '../core/threads'

/** One row of the sheet's list. A hunk is a card drawn across rows: its header, its diff in
 *  chunks (a long hunk builds only the part in view), and its comments when it has any. */
type Chunk = { patch: string; from: number; rows: number }
type Row =
  | { kind: 'group'; key: string; label: string }
  | { kind: 'file'; key: string; file: FileChange }
  | { kind: 'head'; key: string; fileKey: string; hunk: Hunk; first: boolean }
  | { kind: 'chunk'; key: string; fileKey: string; hunk: Hunk; chunk: Chunk; end: boolean; last: boolean }
  | { kind: 'foot'; key: string; fileKey: string; hunk: Hunk; last: boolean }

/** Rows of diff per chunk: about a screen, so a chunk in view costs what a short hunk does. */
const CHUNK = 60

/** The rows being commented on, as indexes into the hunk's rows; `to` moves with ⇧-click. */
type Commenting = { hunkId: string; from: number; to: number }

/** `onAdd` gets the hunks you picked, every comment, and the hunks you only commented on. */
export function Changes({ open, onClose, thread, onAdd }: { open: boolean; onClose: () => void; thread?: Thread; onAdd: (hunks: Hunk[], notes: Record<string, HunkNote[]>, commented: Hunk[]) => void }) {
  const m = useM()
  const agent = useAgent()
  const [scope, setScope] = useState<'note' | 'uncommitted'>('note')
  const [scopeOpen, setScopeOpen] = useState(false)
  const [working, setWorking] = useState<GitFile[]>()
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [revision, setRevision] = useState(0)
  const groups = useMemo(() => scope === 'note' ? (thread ? collectChanges(thread) : []) : working?.length ? [{ label: 'Uncommitted', files: working.map((file) => ({ ...file, status: 'ok' as const, hunks: splitHunks(`uncommitted:${file.path}`, file.path, file.patch) })) }] : [], [scope, thread, working])
  const all = groups.flatMap((g) => g.files.flatMap((f) => f.hunks))
  const [openFiles, setOpenFiles] = useState<Record<string, boolean>>({})
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [notes, setNotes] = useState<Record<string, HunkNote[]>>({})
  const [commenting, setCommenting] = useState<Commenting | null>(null)
  const selected = all.filter((h) => picked[h.id])
  const noteCount = all.reduce((n, h) => n + (notes[h.id]?.length ?? 0), 0)
  // A comment goes on its own, as its line and what you said, when its hunk isn't picked.
  const commented = all.filter((h) => !picked[h.id] && notes[h.id]?.length)
  const loose = commented.reduce((n, h) => n + notes[h.id]!.length, 0)
  const totals = groups.flatMap((group) => group.files).reduce((sum, file) => ({ added: sum.added + file.added, removed: sum.removed + file.removed }), { added: 0, removed: 0 })
  useEffect(() => {
    setPicked({})
    setNotes({})
    setCommenting(null)
  }, [scope, thread?.id, revision])
  useEffect(() => {
    if (!open) setScopeOpen(false)
    // A note with no changes of its own opens on the folder's, whoever made them.
    else if (thread && !changeCount(thread)) setScope('uncommitted')
  }, [open])
  useEffect(() => {
    // Closing keeps what's shown: the panel stays up, frozen, while the scrim lifts.
    if (!open) return
    setWorking(undefined)
    setLoadError(false)
    if (scope !== 'uncommitted' || !thread?.workspace) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    uncommittedFiles(thread.workspace).then((files) => {
      if (cancelled) return
      setWorking(files)
      setLoadError(!files)
      setLoading(false)
    }).catch(() => { if (!cancelled) { setLoadError(true); setLoading(false) } })
    return () => { cancelled = true }
  }, [open, scope, thread?.workspace, thread?.id, revision])
  // One list for the whole sheet: each group's label, its files, and the hunks of the open ones.
  // Only a window of it is mounted, so a long review scrolls as fast as a short one.
  const rows = useMemo(() => {
    const out: Row[] = []
    for (const group of groups) {
      out.push({ kind: 'group', key: `group:${group.label}`, label: group.label })
      for (const file of group.files) {
        const key = `${group.label}:${file.path}`
        out.push({ kind: 'file', key, file })
        if (!openFiles[key]) continue
        file.hunks.forEach((hunk, i) => {
          const lastHunk = i === file.hunks.length - 1
          const foot = Boolean(notes[hunk.id]?.length || commenting?.hunkId === hunk.id)
          out.push({ kind: 'head', key: `${key}:${hunk.id}`, fileKey: key, hunk, first: i === 0 })
          const chunks = chunkHunk(hunk.patch, CHUNK)
          chunks.forEach((chunk, c) => {
            const end = c === chunks.length - 1 && !foot
            out.push({ kind: 'chunk', key: `${key}:${hunk.id}:${c}`, fileKey: key, hunk, chunk, end, last: end && lastHunk })
          })
          if (foot) out.push({ kind: 'foot', key: `${key}:${hunk.id}:foot`, fileKey: key, hunk, last: lastHunk })
        })
      }
    }
    return out
  }, [groups, openFiles, notes, commenting?.hunkId])
  const win = useWindowed(rows.length, 40, [scope, thread?.id, revision, open])
  // The file whose hunks are fading in; cleared once they have.
  const [opening, setOpening] = useState<string>()
  useEffect(() => {
    if (!opening) return
    const timer = setTimeout(() => setOpening(undefined), duration.standard * 1000 + 100)
    return () => clearTimeout(timer)
  }, [opening])
  const toggleFile = (key: string) => {
    if (!openFiles[key]) setOpening(key)
    setOpenFiles((o) => ({ ...o, [key]: !o[key] }))
  }
  const toggleHunk = (id: string) => setPicked((p) => ({ ...p, [id]: !p[id] }))
  // The comment being written, and whether ⇧ was down at the press before a line click (the
  // diff's lineClick carries no modifiers). One comment is open at a time, so the sheet keeps them.
  const [draft, setDraft] = useState('')
  const shift = useRef(false)
  const hunkRowsOf = useMemo(() => new Map(all.map((h) => [h.id, hunkRows(h.patch)])), [all])
  const comments: Comments = {
    notes,
    commenting,
    draft,
    setDraft,
    shift,
    rowsOf: (hunk) => hunkRowsOf.get(hunk.id) ?? hunkRows(hunk.patch),
    start: setCommenting,
    save: (text) => {
      const hunk = commenting && all.find((h) => h.id === commenting.hunkId)
      if (!commenting || !hunk || !text.trim()) return setCommenting(null)
      const note = noteFor(hunkRows(hunk.patch), commenting.from, commenting.to, text.trim())
      const same = (x: HunkNote) => x.side === note.side && x.line === note.line && x.endLine === note.endLine
      setNotes((n) => ({ ...n, [hunk.id]: [...(n[hunk.id] ?? []).filter((x) => !same(x)), note] }))
      setCommenting(null)
    },
    remove: (hunkId, i) => setNotes((n) => ({ ...n, [hunkId]: (n[hunkId] ?? []).filter((_, j) => j !== i) })),
  }

  // One text edge at 18: the list's 8 plus each row's 10. The chip, the empty line and the
  // footer's count line up on it.
  return (
    <SidePanel open={open} onClose={onClose} width={520} testId="changes">
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, height: 48, paddingLeft: 10, paddingRight: 10, borderBottomWidth: 1, borderColor: m.border, flexShrink: 0 }}>
        <div style={{ position: 'relative' }}>
          <Button testId="changes-scope" title="Changes scope" onPress={() => setScopeOpen(!scopeOpen)} style={{ height: 28, minHeight: 28, borderRadius: 14, paddingLeft: 8, paddingRight: 10, gap: 7, backgroundColor: m.chipBg }}>
            <text style={{ fontSize: 12, lineHeight: 17, color: m.textUi, fontWeight: 500 }}>{scope === 'note' ? 'This note' : 'Uncommitted'}</text>
            <Icon name="chevronDown" size={10} color={m.textMuted} />
            {!loading && !loadError ? <ChangeTotals {...totals} /> : null}
          </Button>
          <Menu open={scopeOpen} onClose={() => setScopeOpen(false)} side="bottom" align="start" width={290} testId="changes-scope-menu" items={[
            { label: 'This note', hint: `Edits ${agent.title} made here`, checked: scope === 'note', testId: 'changes-scope-note', onSelect: () => setScope('note') },
            { label: 'Uncommitted', hint: 'Working tree vs HEAD', checked: scope === 'uncommitted', testId: 'changes-scope-uncommitted', onSelect: () => setScope('uncommitted') },
          ]} />
        </div>
        <div style={{ flexGrow: 1 }} />
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 2, padding: 2, borderRadius: 15, backgroundColor: m.chipBg }}>
          {scope === 'uncommitted' ? <Button onPress={() => setRevision((value) => value + 1)} testId="changes-refresh" title="Refresh working-tree changes" disabled={loading} style={iconButton}><Icon name="refresh" size={14} /></Button> : null}
          <CloseButton onPress={onClose} testId="changes-close" />
        </div>
      </div>
      {groups.length === 0 ? (
        <div style={{ flexGrow: 1, paddingTop: 14, paddingLeft: 18, paddingRight: 18 }}>
          <text style={{ fontSize: 13, lineHeight: 18, color: m.textMuted }}>{loading ? 'Reading working-tree changes…' : loadError ? 'Couldn’t read Git changes in this folder.' : scope === 'uncommitted' ? 'No uncommitted changes.' : `${agent.title} hasn't changed any files in this note.`}</text>
        </div>
      ) : (
        <virtual-list {...win.props} testId="changes-rows" alignment="top" estimatedItemHeight={120} overdraw={600} style={{ flexGrow: 1, minHeight: 0, width: '100%', scrollbarColor: m.scrollbar, scrollbarWidth }}>
          {rows.slice(win.start, win.end).map((row, k) => {
            const last = win.start + k === rows.length - 1
            // The list's own inset (8 a side, 8 under the last row), on each row.
            const pad = { paddingLeft: 8, paddingRight: 8, paddingBottom: last ? 8 : 0 }
            if (row.kind === 'group') return (
              <div key={row.key} style={{ ...pad, paddingTop: 8 }}>
                <text style={{ paddingLeft: 10, paddingBottom: 4, fontSize: 12, lineHeight: 16, color: m.textMuted, fontWeight: 500 }}>{row.label}</text>
              </div>
            )
            if (row.kind === 'file') return (
              <div key={row.key} style={{ ...pad, paddingTop: 1 }}>
                <FileRow file={row.file} open={Boolean(openFiles[row.key])} onToggle={() => toggleFile(row.key)} />
              </div>
            )
            const piece = row.kind === 'head'
              ? <HunkHead hunk={row.hunk} picked={Boolean(picked[row.hunk.id])} onPick={() => toggleHunk(row.hunk.id)} />
              : row.kind === 'chunk'
                ? <HunkChunk hunk={row.hunk} chunk={row.chunk} end={row.end} picked={Boolean(picked[row.hunk.id])} comments={comments} />
                : <HunkFoot hunk={row.hunk} picked={Boolean(picked[row.hunk.id])} comments={comments} />
            const top = row.kind === 'head' ? (row.first ? 4 : 8) : 0
            const bottom = (row.kind === 'chunk' || row.kind === 'foot') && row.last ? Math.max(pad.paddingBottom, 10) : pad.paddingBottom
            return (
              <div key={row.key} style={{ ...pad, paddingTop: top, paddingBottom: bottom }}>
                <motion.div
                  // Fades in with its file's opening, not each time scrolling mounts it again.
                  initial={opening === row.fileKey ? { opacity: 0 } : false}
                  animate={{ opacity: 1 }}
                  transition={tween({ duration: duration.standard, ease: ease.enter })}
                  style={{ paddingLeft: 10, paddingRight: 6 }}
                >
                  {piece}
                </motion.div>
              </div>
            )
          })}
        </virtual-list>
      )}
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, height: 50, paddingLeft: 18, paddingRight: 10, borderTopWidth: 1, borderColor: m.border, flexShrink: 0 }}>
        <text testId="changes-count" style={{ fontSize: 11.5, lineHeight: 16, color: m.textMuted }}>{`${selected.length} of ${all.length} hunks selected${noteCount ? ` · ${noteCount === 1 ? '1 comment' : `${noteCount} comments`}` : ''}`}</text>
        <Button onPress={() => setPicked(selected.length === all.length ? {} : Object.fromEntries(all.map((h) => [h.id, true])))} testId="changes-select-all" disabled={!all.length}>
          <Label muted>{selected.length === all.length && all.length ? 'Select none' : 'Select all'}</Label>
        </Button>
        <div style={{ flexGrow: 1 }} />
        <Button
          variant="solid"
          disabled={!selected.length && !loose}
          testId="changes-add"
          onPress={() => {
            onAdd(selected, notes, commented)
            setPicked({})
            setNotes({})
          }}
        >
          <Label variant="solid">{addLabel(selected.length, loose)}</Label>
        </Button>
      </div>
    </SidePanel>
  )
}

/** "Add 2 hunks to the note", "Add 1 comment to the note", "Add 1 hunk and 2 comments". */
function addLabel(hunks: number, comments: number) {
  const h = hunks === 1 ? '1 hunk' : `${hunks} hunks`
  const c = comments === 1 ? '1 comment' : `${comments} comments`
  if (hunks && comments) return `Add ${h} and ${c}`
  return `Add ${comments ? c : h} to the note`
}

type Comments = {
  notes: Record<string, HunkNote[]>
  commenting: Commenting | null
  draft: string
  setDraft: (text: string) => void
  shift: { current: boolean }
  rowsOf: (hunk: Hunk) => HunkRow[]
  start: (at: Commenting | null) => void
  save: (text: string) => void
  remove: (hunkId: string, index: number) => void
}

function FileRow({ file, open, onToggle }: { file: FileChange; open: boolean; onToggle: () => void }) {
  const m = useM()
  const parts = file.path.split('/')
  const name = parts.pop()!
  const dir = parts.length ? `${parts.join('/')}/` : ''
  return (
    <Button onPress={onToggle} testId={`change-${file.path}`} style={{ height: 36, gap: 9, paddingLeft: 10, paddingRight: 8, borderRadius: concentric(radiusXl, 8), justifyContent: 'flex-start' }}>
      <FileIcon path={file.path} size={14} />
      <text style={{ fontSize: 13.5, lineHeight: 18, fontWeight: 500, color: m.text, whiteSpace: 'nowrap', flexShrink: 0 }}>{name}</text>
      <text style={{ fontSize: 12, lineHeight: 16, color: m.textFaint, fontFamily: font.mono, whiteSpace: 'nowrap', textOverflow: 'ellipsis-start', flexShrink: 1, minWidth: 0 }}>{dir}</text>
      <div style={{ flexGrow: 1 }} />
      <text style={{ fontSize: 12, lineHeight: 16, color: diffInk(m).add, fontFamily: font.mono, flexShrink: 0 }}>{`+${file.added}`}</text>
      <text style={{ fontSize: 12, lineHeight: 16, color: diffInk(m).del, fontFamily: font.mono, flexShrink: 0 }}>{`−${file.removed}`}</text>
      {file.status === 'running' ? <Dot color={m.accent} size={6} pulse /> : file.status === 'error' ? <Icon name="info" size={13} color={m.danger} /> : null}
      <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} color={m.textFaint} />
    </Button>
  )
}

/** The card's sides, shared by its pieces: the header has the top, the last piece the bottom. */
function card(m: ReturnType<typeof useM>, picked: boolean, top: boolean, bottom: boolean) {
  const r = concentric(radiusXl, 6)
  return {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    overflow: 'hidden' as const,
    backgroundColor: m.codeBg,
    borderColor: picked ? m.accent + '88' : m.border,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderTopWidth: top ? 1 : 0,
    borderBottomWidth: bottom ? 1 : 0,
    borderTopLeftRadius: top ? r : 0,
    borderTopRightRadius: top ? r : 0,
    borderBottomLeftRadius: bottom ? r : 0,
    borderBottomRightRadius: bottom ? r : 0,
  }
}

function HunkHead({ hunk, picked, onPick }: { hunk: Hunk; picked: boolean; onPick: () => void }) {
  const m = useM()
  const ink = diffInk(m)
  return (
    <div style={card(m, picked, true, false)}>
      <Button onPress={onPick} testId={`hunk-${hunk.id}`} title={picked ? 'Deselect this hunk' : 'Select this hunk'} style={{ height: 28, gap: 8, paddingLeft: 10, paddingRight: 10, borderRadius: 0, justifyContent: 'flex-start', backgroundColor: picked ? m.skillBg : '#00000000' }}>
        <Icon name={picked ? 'check' : 'plus'} size={12} color={picked ? m.accent : m.textFaint} />
        <text style={{ fontSize: 11.5, lineHeight: 15, color: picked ? m.textUi : m.textFaint, fontFamily: font.mono, whiteSpace: 'nowrap' }}>{hunk.header}</text>
        <div style={{ flexGrow: 1 }} />
        <text style={{ fontSize: 11.5, lineHeight: 15, color: ink.add, fontFamily: font.mono }}>{`+${hunk.added}`}</text>
        <text style={{ fontSize: 11.5, lineHeight: 15, color: ink.del, fontFamily: font.mono }}>{`−${hunk.removed}`}</text>
      </Button>
    </div>
  )
}

/** Rows `chunk.from` on of a hunk's diff. Line clicks and washes speak in the hunk's own rows. */
function HunkChunk({ hunk, chunk, end, picked, comments }: { hunk: Hunk; chunk: Chunk; end: boolean; picked: boolean; comments: Comments }) {
  const m = useM()
  const rows = comments.rowsOf(hunk)
  const notes = comments.notes[hunk.id] ?? []
  const here = comments.commenting?.hunkId === hunk.id ? comments.commenting : null
  const [rowH, setRowH] = useState(0)
  // A line's numbers say its side: only an old number is a removed line. ⇧-click extends the
  // range being commented on; a plain click starts a new one.
  const onLine = (e: EventPayload & { oldLine?: number; newLine?: number }) => {
    const line = e.newLine ?? e.oldLine
    if (!line) return
    const i = rowOf(rows, { side: e.newLine ? 'new' : 'old', line })
    if (i < 0) return
    if (comments.shift.current && here) return comments.start({ ...here, to: i })
    const existing = notes.find((n) => noteRows(rows, n)?.[0] === i)
    comments.setDraft(existing?.text ?? '')
    comments.start({ hunkId: hunk.id, from: i, to: i })
  }
  const span = here ? [Math.min(here.from, here.to), Math.max(here.from, here.to)] as const : undefined
  const washes = [...notes.map((n) => ({ w: noteRows(rows, n), live: false })), ...(span ? [{ w: span, live: true }] : [])]
    .filter((x): x is { w: [number, number]; live: boolean } => Boolean(x.w))
    // This chunk's part of each, in its own rows.
    .map(({ w, live }) => ({ w: [Math.max(w[0], chunk.from) - chunk.from, Math.min(w[1], chunk.from + chunk.rows - 1) - chunk.from] as const, live }))
    .filter(({ w }) => w[0] <= w[1])
  return (
    <div style={card(m, picked, false, end)}>
      <div
        testId={chunk.from === 0 ? `hunk-diff-${hunk.id}` : undefined}
        // The diff's rows are all one height, so its visible height over the row count is that height.
        onLayout={(e) => chunk.rows && setRowH((e.height ?? 0) / chunk.rows)}
        onMouseDown={(e) => void (comments.shift.current = Boolean(e.modifiers?.shift))}
        style={{ position: 'relative', overflow: 'hidden', ...(chunk.from === 0 ? { borderTopWidth: 1, borderColor: m.border } : {}) }}
      >
        <diff patch={forDiff(`--- a/${hunk.path}\n+++ b/${hunk.path}\n${chunk.patch}`)} wordDiff theme={diffTheme(m)} onLineClick={onLine} style={{ marginTop: -diffHeaderClip }} />
        {/* GPUIX can't tint a diff row, so commented and selected rows get a wash laid over them. */}
        {rowH
          ? washes.map(({ w, live }, i) => (
              <div
                key={`${live ? 'sel' : 'note'}-${i}`}
                testId={live ? 'hunk-selection' : undefined}
                style={{ position: 'absolute', left: 0, right: 0, top: w[0] * rowH, height: (w[1] - w[0] + 1) * rowH, pointerEvents: 'none', backgroundColor: m.blue + (live ? '2e' : '14'), borderLeftWidth: 2, borderColor: live ? m.blue : m.blue + '66' }}
              />
            ))
          : null}
      </div>
    </div>
  )
}

/** The hunk's comments, and the field for the one being written. */
function HunkFoot({ hunk, picked, comments }: { hunk: Hunk; picked: boolean; comments: Comments }) {
  const m = useM()
  const rows = comments.rowsOf(hunk)
  const notes = comments.notes[hunk.id] ?? []
  const here = comments.commenting?.hunkId === hunk.id ? comments.commenting : null
  const span = here ? [Math.min(here.from, here.to), Math.max(here.from, here.to)] as const : undefined
  const selLabel = span ? noteLabel(noteFor(rows, span[0], span[1], '')) : ''
  return (
    <div style={card(m, picked, false, true)}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 10, paddingRight: 8, paddingTop: 8, paddingBottom: 8, borderTopWidth: 1, borderColor: m.border }}>
        {notes.map((n, i) => (
          <div key={`${n.side}${n.line}-${n.endLine ?? ''}`} testId={`hunk-note-${i}`} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 22 }}>
            <Icon name="comment" size={12} color={m.blue} />
            <text style={{ fontSize: 11.5, lineHeight: 15, color: m.textFaint, fontFamily: font.mono, flexShrink: 0 }}>{noteLabel(n)}</text>
            <text style={{ fontSize: 12.5, lineHeight: 17, color: m.textUi, flexGrow: 1, minWidth: 0 }}>{n.text}</text>
            <Button onPress={() => comments.remove(hunk.id, i)} title="Remove this comment" style={{ width: 20, height: 20, minHeight: 20, paddingLeft: 0, paddingRight: 0 }}>
              <Icon name="x" size={11} />
            </Button>
          </div>
        ))}
        {here ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Meta>{`${span && span[1] > span[0] ? 'Lines' : 'Line'} ${selLabel} · ⇧-click to extend · ↵ saves · esc cancels`}</Meta>
            <Field
              testId="hunk-comment"
              value={comments.draft}
              autoFocus
              placeholder="e.g. Clamp this at zero"
              onChange={comments.setDraft}
              onSubmit={() => {
                comments.save(comments.draft)
                comments.setDraft('')
              }}
              onKeyDown={(e) => {
                if (e.key !== 'escape') return
                // esc leaves the comment, not the sheet.
                e.preventDefault()
                e.stopPropagation()
                comments.start(null)
              }}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}
