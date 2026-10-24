// The note's timeline: one tick per paragraph you sent, at the far left of the page, once a
// note has a few. Ticks near the pointer widen like a dock, and the one under it previews the
// paragraph with its time; the preview stays while you move onto it, with Go there and Edit. A
// click on a tick scrolls the note there, a double-click also puts the caret in the paragraph.
// The tick for the paragraph you're reading stays bright as the note scrolls.
//
// The rail scrolls on its own once it's taller than the page (a long note), with no scrollbar;
// the preview follows it.

import { useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react'
import { motion, useGpuixRequired, type PublicInstance } from '@gpuix/react'
import type { Thread } from '../core/threads'
import { ease, tween } from '../components/motion'
import { editParagraph } from './blocks'
import { Meta, Quiet, useM } from './kit'
import { elevation, radiusBase, type } from './theme'

/** Fewer than this, and the note is short enough to see at a glance. */
export const TIMELINE_MIN = 3
const ROW = 12
const BAR = 3
const NARROW = 14
const WIDE = 34
/** How fast the widening falls off with distance from the pointer, per tick. */
const FALLOFF = 0.3
const PREVIEW_W = 280
/** The list's own first row is the spacer above the title; blocks follow it one row each. */
const HEAD_ROWS = 1

/**
 * Which of the note's rows are on screen. Kept outside React state, so scrolling the note
 * re-renders only the timeline, not the app.
 */
export function watchRows() {
  // Unknown until the list first scrolls; it opens at its end (followTail).
  let value: [number, number] | undefined
  const subs = new Set<() => void>()
  return {
    set: (r: [number, number]) => {
      if (value && r[0] === value[0] && r[1] === value[1]) return
      value = r
      for (const f of subs) f()
    },
    get: () => value,
    subscribe: (f: () => void) => {
      subs.add(f)
      return () => void subs.delete(f)
    },
  }
}
export type RowWatch = ReturnType<typeof watchRows>

export type TimelineItem = { id: string; row: number; text: string; at: string; images: number }

export function timelineItems(t: Thread): TimelineItem[] {
  return t.blocks.flatMap((b, i) => (b.kind === 'user' ? [{ id: b.id, row: HEAD_ROWS + i, text: b.text, at: b.at, images: b.images?.length ?? 0 }] : []))
}

/** The paragraph you're reading: the first one on screen, else the last one above it. */
export function currentItem(items: TimelineItem[], visible: [number, number] | undefined): string | undefined {
  if (!visible) return items.at(-1)?.id
  const [start, end] = visible
  return (items.find((it) => it.row >= start && it.row < end) ?? items.filter((it) => it.row < start).at(-1))?.id
}

export function Timeline({ thread, list, rows }: { thread: Thread; list: RefObject<PublicInstance | null>; rows: RowWatch }) {
  const m = useM()
  const visible = useSyncExternalStore(rows.subscribe, rows.get)
  const renderer = useGpuixRequired()
  const items = useMemo(() => timelineItems(thread), [thread])
  const [hover, setHover] = useState<number | undefined>(undefined)
  const [scrollY, setScrollY] = useState(0)
  const [railH, setRailH] = useState(0)
  // Leaving a tick for its preview crosses a gap; the preview keeps itself open once reached.
  // Enter and leave can arrive in either order, so the preview also says when the pointer is on it.
  const leaving = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const onPreview = useRef(false)
  const stay = () => clearTimeout(leaving.current)
  const leave = () => {
    clearTimeout(leaving.current)
    leaving.current = setTimeout(() => !onPreview.current && setHover(undefined), 160)
  }
  if (items.length < TIMELINE_MIN) return null
  const current = currentItem(items, visible)

  const go = (it: TimelineItem, edit: boolean) => {
    if (!list.current) return
    // A little above the paragraph, so your picture and the line before it show too.
    renderer.scrollToItem?.(list.current.id, it.row, -24)
    if (!edit) return
    // The row may only mount once the list has scrolled to it.
    let tries = 0
    const attempt = () => {
      if (!editParagraph(it.id) && ++tries < 10) setTimeout(attempt, 50)
    }
    setTimeout(attempt, 30)
  }

  const shown = hover === undefined ? undefined : items[hover]
  return (
    <div testId="timeline" onLayout={(e) => setRailH(e.height ?? 0)} style={{ position: 'absolute', left: 12, top: 60, bottom: 120, width: WIDE + 12, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <div
        onMouseLeave={leave}
        onScrollChange={(e) => setScrollY(-(e.scrollY ?? 0))}
        style={{ display: 'flex', flexDirection: 'column', maxHeight: '100%', overflowY: 'scroll', scrollbarWidth: 0 }}
      >
        {items.map((it, i) => {
          const near = hover === undefined ? 0 : Math.max(0, 1 - Math.abs(i - hover) * FALLOFF)
          const on = it.id === current
          return (
            <div key={it.id} testId={`timeline-${it.id}`} style={{ position: 'relative', height: ROW, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
              <motion.div
                initial={false}
                animate={{ width: NARROW + (WIDE - NARROW) * near + (on && !near ? 6 : 0) }}
                transition={tween({ duration: 0.16, ease: ease.enter })}
                style={{ height: BAR, borderRadius: BAR / 2, backgroundColor: on || hover === i ? m.text : m.textFaint, opacity: on || hover === i ? 1 : 0.55 }}
              />
              {/* The hit area lies over the bar: a motion.div takes presses from the element around it. */}
              <div
                onMouseEnter={() => {
                  stay()
                  setHover(i)
                }}
                // On press, not release: the response should be immediate.
                onMouseDown={(e) => go(it, (e.clickCount ?? 1) >= 2)}
                style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, cursor: 'pointer' }}
              />
            </div>
          )
        })}
      </div>
      {shown ? (
        <Preview
          item={shown}
          top={previewTop(items.length, hover!, scrollY, railH)}
          onEnter={() => {
            onPreview.current = true
            stay()
          }}
          onLeave={() => {
            onPreview.current = false
            leave()
          }}
          onGo={() => go(shown, false)}
          onEdit={() => {
            go(shown, true)
            onPreview.current = false
            setHover(undefined)
          }}
        />
      ) : null}
    </div>
  )
}

/** Where the hovered tick sits in the column, which is centred in the rail and may be scrolled. */
function previewTop(count: number, i: number, scrollY: number, railH: number) {
  const column = Math.min(count * ROW, railH)
  return Math.max(0, (railH - column) / 2 + i * ROW - scrollY - 10)
}

function Preview({ item, top, onEnter, onLeave, onGo, onEdit }: { item: TimelineItem; top: number; onEnter: () => void; onLeave: () => void; onGo: () => void; onEdit: () => void }) {
  const m = useM()
  const at = new Date(item.at)
  const time = Number.isNaN(at.getTime()) ? '' : `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  const text = item.text.trim() || (item.images ? (item.images === 1 ? 'An image' : `${item.images} images`) : '')
  return (
    <div
      testId="timeline-preview"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{
        position: 'absolute',
        left: WIDE + 16,
        top,
        width: PREVIEW_W,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: 10,
        borderRadius: radiusBase,
        borderWidth: 1,
        borderColor: m.border,
        backgroundColor: m.popup,
        boxShadow: elevation(m, 'popover'),
      }}
    >
      <div onClick={onGo} style={{ cursor: 'pointer' }}>
        <text style={{ ...type.body, fontSize: 13, lineHeight: 19, color: m.text, lineClamp: 4 }}>{text}</text>
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: -6 }}>
        <Quiet onPress={onGo} testId="timeline-go" title="Scroll the note to this paragraph">
          <Meta color={m.textMuted}>Go there</Meta>
        </Quiet>
        <Quiet onPress={onEdit} testId="timeline-edit" title="Go there and edit this paragraph">
          <Meta color={m.textMuted}>Edit</Meta>
        </Quiet>
        <div style={{ flexGrow: 1 }} />
        <Meta color={m.textFaint}>{time}</Meta>
      </div>
    </div>
  )
}
