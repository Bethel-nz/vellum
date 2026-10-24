// A long list mounted a window at a time. <virtual-list> with `itemCount` and `windowStart` keeps
// the room of the rows that aren't mounted by estimate; this keeps the window around what's in
// view, a few screens' worth, and moves it as the list scrolls. `reveal` brings a row into view,
// moving the window to it first: a row that isn't mounted can't be scrolled to.
//
// Past notes (ui/SearchResults.tsx), the file pane's code and markdown (ui/CodeLines.tsx) and the
// file tree use it. The note itself mounts every block (app.tsx Document): its rows stream.

import { useEffect, useRef, useState } from 'react'
import { useGpuixRequired, type EventPayload, type PublicInstance } from '@gpuix/react'

export function useWindowed(total: number, span: number, reset: unknown[]) {
  const renderer = useGpuixRequired()
  const list = useRef<PublicInstance>(null)
  // The rows in view, as the list last said: [first, past the last).
  const seen = useRef<[number, number]>([0, 0])
  const [wanted, setStart] = useState(0)
  // A list that got shorter (a folder closed) keeps its window inside it.
  const start = Math.max(0, Math.min(wanted, total - span))
  useEffect(() => {
    setStart(0)
    seen.current = [0, 0]
  }, reset)
  const at = (first: number) => Math.max(0, Math.min(first - Math.floor(span / 4), total - span))
  const margin = Math.floor(span / 8)
  const follow = (first: number, last: number) => {
    seen.current = [first, last]
    const low = start > 0 && first < start + margin
    const high = start + span < total && last > start + span - margin
    if (low || high) setStart(at(first))
  }
  /** Brings row `index` into view, `offset` points into it; with `ifHidden`, only when it isn't. */
  const reveal = (index: number, offset = 0, ifHidden = false) => {
    const [first, last] = seen.current
    if (ifHidden && index >= first && index < last) return
    if (index < start || index >= start + span) setStart(at(index))
    const id = list.current?.id
    if (id === undefined) return
    // Once the window has the row.
    setTimeout(() => renderer.scrollToItem?.(id, index, offset), 16)
  }
  return {
    start,
    end: Math.min(total, start + span),
    reveal,
    props: { ref: list, itemCount: total, windowStart: start, onVisibleRange: (e: EventPayload) => follow(e.startIndex ?? 0, e.endIndex ?? 0) },
  }
}
