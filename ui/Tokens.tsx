// Context tokens on the page: chips in your paragraphs, a chip row under the paragraph being
// written, and the hover slice. Hovering a `#path:42` chip opens that one line beneath the
// paragraph (gutter, source, blue line wash); a plain file chip opens the head of the file.
// A line chip's slice carries "Read whole file", which widens the tag for this note. A hunk is a
// ± pill; hovering it opens the hunk itself and your comments on its lines.
//
// GPUIX has no inline spans (nested <text> breaks onto its own line, see
// spikes/inline-chips.tsx), so a read paragraph is a wrapping row of words and chip boxes.
// Slices are read when the paragraph renders, never on hover.

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from '@gpuix/react'
import { Button, Chip, HunkPill, Icon, Label } from '../components'
import { duration, ease, tween } from '../components/motion'
import { readSlice, tagText, tokens, widened, type Slice, type Token } from '../core/tags'
import { scopeKey, type Tag } from '../core/threads'
import { useM } from './kit'
import { concentric, diffHeaderClip, diffTheme, font, radiusBase, type } from './theme'

const SLICE_LINE = 19
const SLICE_PAD = 6
const WIDEN_ROW = 28
/** Leaving a chip closes its slice after this, so the pointer can reach "Read whole file". */
const LEAVE_MS = 160

export type TokenContext = {
  workspace: string
  scopes: Record<string, 'file'>
  /** Absent for read-only chips (Claude's replies). */
  onWiden?: (key: string) => void
}

const keyOf = (t: Tag) => `${t.type}:${tagText(t)}`
const chipKind = (t: Exclude<Tag, { type: 'hunk' }>) => (t.type === 'file' ? (t.line ? 'line' : 'file') : t.type)

/** Slices for every file tag in a paragraph, read once per text. */
function useSlices(tags: Tag[], workspace: string) {
  return useMemo(() => {
    const out = new Map<string, Slice>()
    for (const t of tags) {
      if (t.type !== 'file') continue
      const s = readSlice(workspace, t.value, t.line)
      if (s) out.set(keyOf(t), s)
    }
    return out
  }, [tags.map(keyOf).join('|'), workspace])
}

/** Which chip's slice is open; leaving waits a moment so the slice itself can be reached. */
function useHover() {
  const [open, setOpen] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clear = () => void (timer.current && clearTimeout(timer.current))
  useEffect(() => clear, [])
  return {
    open,
    enter: (key: string) => {
      clear()
      setOpen(key)
    },
    leave: () => {
      clear()
      timer.current = setTimeout(() => setOpen(null), LEAVE_MS)
    },
    close: () => {
      clear()
      setOpen(null)
    },
  }
}

function SlicePanel({ tag, slice, ctx, onEnter, onLeave }: { tag: Extract<Tag, { type: 'file' }>; slice: Slice; ctx: TokenContext; onEnter: () => void; onLeave: () => void }) {
  const m = useM()
  const wide = widened(tag, ctx.scopes)
  const canWiden = Boolean(tag.line && !wide && ctx.onWiden)
  const height = SLICE_PAD * 2 + slice.lines.length * SLICE_LINE + (canWiden || wide ? WIDEN_ROW : 0)
  const gutter = String(slice.start + slice.lines.length - 1).length * 7.4 + 10
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height }}
      transition={tween({ duration: duration.fast, ease: ease.enter })}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{ overflow: 'hidden', marginTop: 6, borderRadius: concentric(radiusBase, 2), backgroundColor: tag.line ? m.lineWash : m.codeBg, borderWidth: 1, borderColor: m.border }}
    >
      <div testId="token-slice" style={{ display: 'flex', flexDirection: 'column', paddingTop: SLICE_PAD, paddingBottom: SLICE_PAD }}>
        {slice.lines.map((line, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'row', height: SLICE_LINE, alignItems: 'center' }}>
            <text style={{ width: gutter, paddingRight: 8, fontFamily: font.mono, fontSize: 11.5, lineHeight: SLICE_LINE, color: m.textFaint, textAlign: 'right', flexShrink: 0 }}>{String(slice.start + i)}</text>
            <text style={{ flexGrow: 1, minWidth: 0, fontFamily: font.mono, ...type.mono, lineHeight: SLICE_LINE, color: m.text, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{line || ' '}</text>
          </div>
        ))}
      </div>
      {canWiden ? (
        <div style={{ height: WIDEN_ROW, display: 'flex', flexDirection: 'row', alignItems: 'center', paddingLeft: gutter - 8 }}>
          <Button testId="token-widen" title="Claude reads the whole file for this note" onPress={() => ctx.onWiden!(scopeKey(tag.value, tag.line!))}>
            <Label muted>Read whole file</Label>
          </Button>
        </div>
      ) : wide ? (
        <div style={{ height: WIDEN_ROW, display: 'flex', alignItems: 'center', paddingLeft: gutter }}>
          <text style={{ fontSize: 11.5, lineHeight: 15, color: m.textMuted }}>Claude reads the whole file</text>
        </div>
      ) : null}
    </motion.div>
  )
}

function TokenChip({ token, hover, testId }: { token: Extract<Token, { kind: 'tag' }>; hover: ReturnType<typeof useHover>; testId?: string }) {
  const key = keyOf(token.tag)
  if (token.tag.type === 'hunk') {
    const h = token.tag
    return <HunkPill path={h.path} added={h.added} removed={h.removed} notes={h.notes?.length} line={h.comments ? h.notes?.[0]?.line : undefined} testId={testId} onHover={(inside) => (inside ? hover.enter(key) : hover.leave())} />
  }
  const label = token.tag.type === 'skill' ? token.tag.value : token.text.replace(/^[#@]/, '')
  return (
    <Chip kind={chipKind(token.tag)} path={token.tag.type === 'file' ? token.tag.value : undefined} testId={testId} onHover={token.tag.type === 'file' ? (inside) => (inside ? hover.enter(key) : hover.leave()) : undefined}>
      {label}
    </Chip>
  )
}

/** A hunk pill's hover: the diff, clipped to a dozen lines, then each line comment. */
function HunkPanel({ tag, onEnter, onLeave }: { tag: Extract<Tag, { type: 'hunk' }>; onEnter: () => void; onLeave: () => void }) {
  const m = useM()
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={tween({ duration: duration.fast, ease: ease.enter })}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{ marginTop: 6, display: 'flex', flexDirection: 'column', borderRadius: concentric(radiusBase, 2), backgroundColor: m.codeBg, borderWidth: 1, borderColor: m.border, overflow: 'hidden' }}
    >
      <div testId="hunk-slice" style={{ overflow: 'hidden', paddingTop: 4 }}>
        <diff patch={`--- a/${tag.path}\n+++ b/${tag.path}\n${tag.patch}`} wordDiff maxLines={12} theme={diffTheme(m)} style={{ marginTop: -diffHeaderClip }} />
      </div>
      {tag.notes?.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 10, paddingRight: 10, paddingTop: 8, paddingBottom: 8, borderTopWidth: 1, borderColor: m.border }}>
          {tag.notes.map((n, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
              <Icon name="comment" size={11} color={m.blue} />
              <text style={{ fontSize: 11.5, lineHeight: 16, color: m.textFaint, fontFamily: font.mono, flexShrink: 0 }}>{`${n.side === 'old' ? '−' : '+'}${n.line}`}</text>
              <text style={{ fontSize: 12.5, lineHeight: 16, color: m.textUi, flexGrow: 1, minWidth: 0 }}>{n.text}</text>
            </div>
          ))}
        </div>
      ) : null}
    </motion.div>
  )
}

function OpenSlice({ tags, slices, hover, ctx }: { tags: Tag[]; slices: Map<string, Slice>; hover: ReturnType<typeof useHover>; ctx: TokenContext }) {
  const tag = tags.find((t) => keyOf(t) === hover.open)
  if (tag?.type === 'hunk') return <HunkPanel key={hover.open!} tag={tag} onEnter={() => hover.enter(hover.open!)} onLeave={hover.leave} />
  const slice = hover.open ? slices.get(hover.open) : undefined
  if (!tag || tag.type !== 'file' || !slice) return null
  return <SlicePanel key={hover.open!} tag={tag} slice={slice} ctx={ctx} onEnter={() => hover.enter(hover.open!)} onLeave={hover.leave} />
}

/** Your paragraph, read: words and chips wrapping together. Click to edit the source. */
export function TokenText({ text, tags, ctx, onPress, color, testId }: { text: string; tags: Tag[]; ctx: TokenContext; onPress: () => void; color: string; testId?: string }) {
  const hover = useHover()
  const found = useMemo(() => tokens(text, tags), [text, tags])
  const present = useMemo(() => found.flatMap((t) => (t.kind === 'tag' ? [t.tag] : [])), [found])
  const slices = useSlices(present, ctx.workspace)
  // One wrapping row per source line; each word is its own run so chips sit between them.
  const lines: Token[][] = [[]]
  for (const t of found) {
    if (t.kind === 'tag') {
      lines[lines.length - 1]!.push(t)
      continue
    }
    t.text.split('\n').forEach((part, i) => {
      if (i > 0) lines.push([])
      if (part) lines[lines.length - 1]!.push({ kind: 'text', text: part })
    })
  }
  let chip = 0
  return (
    <div testId={testId} onClick={onPress} style={{ display: 'flex', flexDirection: 'column', cursor: 'text' }}>
      {lines.map((line, li) => (
        <div key={li} style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 4, minHeight: type.user.lineHeight }}>
          {line.flatMap((t, ti) =>
            t.kind === 'tag'
              ? [<TokenChip key={`${ti}`} token={t} hover={hover} testId={`chip-${chip++}`} />]
              : t.text
                  .split(/\s+/)
                  .filter(Boolean)
                  .map((w, wi) => (
                    <text key={`${ti}-${wi}`} style={{ ...type.user, fontWeight: 500, color }}>
                      {w}
                    </text>
                  )),
          )}
        </div>
      ))}
      <OpenSlice tags={present} slices={slices} hover={hover} ctx={ctx} />
    </div>
  )
}

/** The tokens in the paragraph being written, as a row of chips under the composer. */
export function TokenRow({ tags, ctx, testId }: { tags: Tag[]; ctx: TokenContext; testId?: string }) {
  const hover = useHover()
  const slices = useSlices(tags, ctx.workspace)
  if (!tags.length) return null
  return (
    <div testId={testId} style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
        {tags.map((t, i) => (
          <TokenChip key={keyOf(t)} token={{ kind: 'tag', tag: t, text: tagText(t) }} hover={hover} testId={testId ? `${testId}-${i}` : undefined} />
        ))}
      </div>
      <OpenSlice tags={tags} slices={slices} hover={hover} ctx={ctx} />
    </div>
  )
}
