// Context tokens on the page: chips in your paragraphs, and in the draft while you're not writing
// in it (ui/Composer.tsx). Pressing a file chip opens the file beside the note, at its lines (ui/FilePreview.tsx).
// A hunk is a ± pill; hovering it opens the hunk itself and your comments on its lines.
//
// A read paragraph is a wrapping row of words and chip boxes (no inline spans).

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from '../components/spring'
import { Chip, HunkPill, Icon } from '../components'
import { duration, ease, tween } from '../components/motion'
import { tagText, tokens, type Token } from '../core/tags'
import type { Tag } from '../core/threads'
import { useM } from './kit'
import { concentric, diffHeaderClip, diffTheme, font, radiusBase, type } from './theme'
import { forDiff } from '../core/threads'

/** Leaving a hunk pill closes its diff after this, so the pointer can reach the diff. */
const LEAVE_MS = 160

export type TokenContext = {
  workspace: string
  /** Opens a file chip's file beside the note. */
  onOpen?: (file: string, line?: number, endLine?: number) => void
}

const keyOf = (t: Tag) => `${t.type}:${tagText(t)}`

/**
 * When a chip last opened its file. A click bubbles from the chip to its paragraph,
 * so the paragraph skips a click a chip just took.
 */
let chipPressedAt = 0
const chipTookClick = () => Date.now() - chipPressedAt < 100
const chipKind = (t: Exclude<Tag, { type: 'hunk' }>) => (t.type === 'file' ? (t.line ? 'line' : 'file') : t.type)

/** Which hunk pill's diff is open; leaving waits a moment so the diff itself can be reached. */
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

function TokenChip({ token, hover, ctx, testId }: { token: Extract<Token, { kind: 'tag' }>; hover: ReturnType<typeof useHover>; ctx: TokenContext; testId?: string }) {
  const key = keyOf(token.tag)
  if (token.tag.type === 'hunk') {
    const h = token.tag
    return <HunkPill path={h.path} added={h.added} removed={h.removed} notes={h.notes?.length} line={h.comments ? h.notes?.[0]?.line : undefined} testId={testId} onHover={(inside) => (inside ? hover.enter(key) : hover.leave())} />
  }
  const label = token.tag.type === 'skill' ? token.tag.value : token.text.replace(/^[#@]/, '')
  const file = token.tag.type === 'file' ? token.tag : undefined
  const open = file && ctx.onOpen ? () => ((chipPressedAt = Date.now()), hover.close(), ctx.onOpen!(file.value, file.line, file.endLine)) : undefined
  return (
    <Chip kind={chipKind(token.tag)} path={file?.value} testId={testId} onPress={open}>
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
        <diff patch={forDiff(`--- a/${tag.path}\n+++ b/${tag.path}\n${tag.patch}`)} wordDiff maxLines={12} theme={diffTheme(m)} style={{ marginTop: -diffHeaderClip }} />
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

function OpenHunk({ tags, hover }: { tags: Tag[]; hover: ReturnType<typeof useHover> }) {
  const tag = tags.find((t) => keyOf(t) === hover.open)
  return tag?.type === 'hunk' ? <HunkPanel key={hover.open!} tag={tag} onEnter={() => hover.enter(hover.open!)} onLeave={hover.leave} /> : null
}

/** Your paragraph, read: words and chips wrapping together. Click to edit the source. */
export function TokenText({ text, tags, ctx, onPress, color, testId, chipPrefix = 'chip' }: { text: string; tags: Tag[]; ctx: TokenContext; onPress: () => void; color: string; testId?: string; chipPrefix?: string }) {
  const hover = useHover()
  const found = useMemo(() => tokens(text, tags), [text, tags])
  const present = useMemo(() => found.flatMap((t) => (t.kind === 'tag' ? [t.tag] : [])), [found])
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
    <div testId={testId} onClick={() => chipTookClick() || onPress()} style={{ display: 'flex', flexDirection: 'column', cursor: 'text' }}>
      {lines.map((line, li) => (
        <div key={li} style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 4, minHeight: type.user.lineHeight }}>
          {line.flatMap((t, ti) =>
            t.kind === 'tag'
              ? [<TokenChip key={`${ti}`} token={t} hover={hover} ctx={ctx} testId={`${chipPrefix}-${chip++}`} />]
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
      <OpenHunk tags={present} hover={hover} />
    </div>
  )
}
