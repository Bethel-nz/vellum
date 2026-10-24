// Changes (⇧⌘D, or the count in the strip): every file Claude edited in this note, in a sheet
// from the right. Rows read like an editor's review list: file-type glyph, name, folder in
// faint mono, +n −m, status. A row opens to its hunks; clicking a hunk's header selects it
// (violet wash and gutter tick). Clicking a line inside a hunk opens a comment field for that
// line, and a comment selects its hunk. "Add n hunks" puts them in your draft as ± pills that
// carry the hunk and its comments (core/changes.ts hunkTags); Claude gets them spelled out.

import { useMemo, useRef, useState } from 'react'
import type { EventPayload } from '@gpuix/react'
import { motion } from '@gpuix/react'
import { Button, Dot, Field, FileIcon, Icon, Label, Scroll, SidePanel } from '../components'
import { duration, ease, tween } from '../components/motion'
import { collectChanges, hunkRows, noteFor, noteLabel, noteRows, rowOf, type FileChange, type Hunk } from '../core/changes'
import type { HunkNote, Thread } from '../core/threads'
import { Meta, useM } from './kit'
import { concentric, diffHeaderClip, diffInk, diffTheme, font, radiusXl } from './theme'

/** The rows being commented on, as indexes into the hunk's rows; `to` moves with ⇧-click. */
type Commenting = { hunkId: string; from: number; to: number }

export function Changes({ open, onClose, thread, onAdd }: { open: boolean; onClose: () => void; thread?: Thread; onAdd: (hunks: Hunk[], notes: Record<string, HunkNote[]>) => void }) {
  const m = useM()
  const groups = useMemo(() => (thread ? collectChanges(thread) : []), [thread])
  const all = groups.flatMap((g) => g.files.flatMap((f) => f.hunks))
  const [openFiles, setOpenFiles] = useState<Record<string, boolean>>({})
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [notes, setNotes] = useState<Record<string, HunkNote[]>>({})
  const [commenting, setCommenting] = useState<Commenting | null>(null)
  const selected = all.filter((h) => picked[h.id])
  const noteCount = selected.reduce((n, h) => n + (notes[h.id]?.length ?? 0), 0)
  const toggleFile = (key: string) => setOpenFiles((o) => ({ ...o, [key]: !o[key] }))
  const toggleHunk = (id: string) => setPicked((p) => ({ ...p, [id]: !p[id] }))
  const comments: Comments = {
    notes,
    commenting,
    start: setCommenting,
    save: (text) => {
      const hunk = commenting && all.find((h) => h.id === commenting.hunkId)
      if (!commenting || !hunk || !text.trim()) return setCommenting(null)
      const note = noteFor(hunkRows(hunk.patch), commenting.from, commenting.to, text.trim())
      const same = (x: HunkNote) => x.side === note.side && x.line === note.line && x.endLine === note.endLine
      setNotes((n) => ({ ...n, [hunk.id]: [...(n[hunk.id] ?? []).filter((x) => !same(x)), note] }))
      const hunkId = hunk.id
      setPicked((p) => ({ ...p, [hunkId]: true }))
      setCommenting(null)
    },
    remove: (hunkId, i) => setNotes((n) => ({ ...n, [hunkId]: (n[hunkId] ?? []).filter((_, j) => j !== i) })),
  }

  return (
    <SidePanel open={open} onClose={onClose} width={520} testId="changes">
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, height: 52, paddingLeft: 18, paddingRight: 10, flexShrink: 0 }}>
        <text style={{ fontSize: 17, lineHeight: 22, fontWeight: 600, color: m.text }}>Changes</text>
        <text testId="changes-count" style={{ fontSize: 12.5, lineHeight: 16, color: m.textMuted }}>{`${selected.length} of ${all.length} hunks selected${noteCount ? ` · ${noteCount === 1 ? '1 comment' : `${noteCount} comments`}` : ''}`}</text>
        <div style={{ flexGrow: 1 }} />
        <Button onPress={onClose} testId="changes-close" title="Close (esc)" style={{ width: 26, paddingLeft: 0, paddingRight: 0 }}>
          <Icon name="x" size={13} />
        </Button>
      </div>
      <Scroll style={{ flexGrow: 1 }} padding={{ left: 8, right: 8, bottom: 8 }}>
        {groups.length === 0 ? (
          <div style={{ padding: 14 }}>
            <text style={{ fontSize: 13, lineHeight: 18, color: m.textMuted }}>Claude hasn't changed any files in this note.</text>
          </div>
        ) : null}
        {groups.map((g) => (
          <div key={g.label} style={{ display: 'flex', flexDirection: 'column', gap: 1, paddingTop: 8 }}>
            <div style={{ paddingLeft: 10, paddingBottom: 4 }}>
              <text style={{ fontSize: 12, lineHeight: 16, color: m.textMuted, fontWeight: 500 }}>{g.label}</text>
            </div>
            {g.files.map((f) => {
              const key = `${g.label}:${f.path}`
              return <FileRow key={key} file={f} open={Boolean(openFiles[key])} onToggle={() => toggleFile(key)} picked={picked} onPick={toggleHunk} comments={comments} />
            })}
          </div>
        ))}
      </Scroll>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, height: 50, paddingLeft: 12, paddingRight: 12, borderTopWidth: 1, borderColor: m.border, flexShrink: 0 }}>
        <Button onPress={() => setPicked(selected.length === all.length ? {} : Object.fromEntries(all.map((h) => [h.id, true])))} testId="changes-select-all" disabled={!all.length}>
          <Label muted>{selected.length === all.length && all.length ? 'Select none' : 'Select all'}</Label>
        </Button>
        <div style={{ flexGrow: 1 }} />
        <Button
          variant="solid"
          disabled={!selected.length}
          testId="changes-add"
          onPress={() => {
            onAdd(selected, notes)
            setPicked({})
            setNotes({})
          }}
        >
          <Label variant="solid">{selected.length === 1 ? 'Add 1 hunk to the note' : `Add ${selected.length} hunks to the note`}</Label>
        </Button>
      </div>
    </SidePanel>
  )
}

type Comments = {
  notes: Record<string, HunkNote[]>
  commenting: Commenting | null
  start: (at: Commenting | null) => void
  save: (text: string) => void
  remove: (hunkId: string, index: number) => void
}

function FileRow({ file, open, onToggle, picked, onPick, comments }: { file: FileChange; open: boolean; onToggle: () => void; picked: Record<string, boolean>; onPick: (id: string) => void; comments: Comments }) {
  const m = useM()
  const parts = file.path.split('/')
  const name = parts.pop()!
  const dir = parts.length ? `${parts.join('/')}/` : ''
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
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
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={tween({ duration: duration.standard, ease: ease.enter })}
          style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 10, paddingRight: 6, paddingTop: 4, paddingBottom: 10 }}
        >
          {file.hunks.map((h) => (
            <HunkView key={h.id} hunk={h} picked={Boolean(picked[h.id])} onPick={() => onPick(h.id)} comments={comments} />
          ))}
        </motion.div>
      ) : null}
    </div>
  )
}

function HunkView({ hunk, picked, onPick, comments }: { hunk: Hunk; picked: boolean; onPick: () => void; comments: Comments }) {
  const m = useM()
  const ink = diffInk(m)
  const notes = comments.notes[hunk.id] ?? []
  const here = comments.commenting?.hunkId === hunk.id ? comments.commenting : null
  const [text, setText] = useState('')
  const rows = useMemo(() => hunkRows(hunk.patch), [hunk.patch])
  const [rowH, setRowH] = useState(0)
  // <diff>'s lineClick carries no modifiers, so the press just before it says whether ⇧ was held.
  const shift = useRef(false)
  // A line's numbers say its side: only an old number is a removed line. ⇧-click extends the
  // range being commented on; a plain click starts a new one.
  const onLine = (e: EventPayload & { oldLine?: number; newLine?: number }) => {
    const line = e.newLine ?? e.oldLine
    if (!line) return
    const i = rowOf(rows, { side: e.newLine ? 'new' : 'old', line })
    if (i < 0) return
    if (shift.current && here) return comments.start({ ...here, to: i })
    const existing = notes.find((n) => noteRows(rows, n)?.[0] === i)
    setText(existing?.text ?? '')
    comments.start({ hunkId: hunk.id, from: i, to: i })
  }
  const span = here ? [Math.min(here.from, here.to), Math.max(here.from, here.to)] as const : undefined
  const washes = notes.map((n) => noteRows(rows, n)).filter((x): x is [number, number] => Boolean(x))
  const selLabel = span ? noteLabel(noteFor(rows, span[0], span[1], '')) : ''
  // One card per hunk: its header row, then the diff. No card inside a card.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', borderRadius: concentric(radiusXl, 6), borderWidth: 1, borderColor: picked ? m.accent + '88' : m.border, backgroundColor: m.codeBg, overflow: 'hidden' }}>
      <Button onPress={onPick} testId={`hunk-${hunk.id}`} title={picked ? 'Deselect this hunk' : 'Select this hunk'} style={{ height: 28, gap: 8, paddingLeft: 10, paddingRight: 10, borderRadius: 0, justifyContent: 'flex-start', backgroundColor: picked ? m.skillBg : '#00000000' }}>
        <Icon name={picked ? 'check' : 'plus'} size={12} color={picked ? m.accent : m.textFaint} />
        <text style={{ fontSize: 11.5, lineHeight: 15, color: picked ? m.textUi : m.textFaint, fontFamily: font.mono, whiteSpace: 'nowrap' }}>{hunk.header}</text>
        <div style={{ flexGrow: 1 }} />
        <text style={{ fontSize: 11.5, lineHeight: 15, color: ink.add, fontFamily: font.mono }}>{`+${hunk.added}`}</text>
        <text style={{ fontSize: 11.5, lineHeight: 15, color: ink.del, fontFamily: font.mono }}>{`−${hunk.removed}`}</text>
      </Button>
      <div
        testId={`hunk-diff-${hunk.id}`}
        // The diff's rows are all one height, so its visible height over the row count is that height.
        onLayout={(e) => rows.length && setRowH((e.height ?? 0) / rows.length)}
        onMouseDown={(e) => void (shift.current = Boolean(e.modifiers?.shift))}
        style={{ position: 'relative', overflow: 'hidden', borderTopWidth: 1, borderColor: m.border }}
      >
        <diff patch={`--- a/${hunk.path}\n+++ b/${hunk.path}\n${hunk.patch}`} wordDiff theme={diffTheme(m)} onLineClick={onLine} style={{ marginTop: -diffHeaderClip }} />
        {/* GPUIX can't tint a diff row, so commented and selected rows get a wash laid over them. */}
        {rowH
          ? [...washes.map((w) => ({ w, live: false })), ...(span ? [{ w: span, live: true }] : [])].map(({ w, live }, i) => (
              <div
                key={`${live ? 'sel' : 'note'}-${i}`}
                testId={live ? 'hunk-selection' : undefined}
                style={{ position: 'absolute', left: 0, right: 0, top: w[0] * rowH, height: (w[1] - w[0] + 1) * rowH, pointerEvents: 'none', backgroundColor: m.blue + (live ? '2e' : '14'), borderLeftWidth: 2, borderColor: live ? m.blue : m.blue + '66' }}
              />
            ))
          : null}
      </div>
      {notes.length || here ? (
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
                value={text}
                autoFocus
                placeholder="e.g. Clamp this at zero"
                onChange={setText}
                onSubmit={() => {
                  comments.save(text)
                  setText('')
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
      ) : null}
    </div>
  )
}
