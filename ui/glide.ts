// Scrolling the note to its end smoothly: when you write, send or come back to the composer
// while it's scrolled out of view. GPUIX has no animated scroll, only `scrollToItem` (a jump)
// and `getListScrollTop` (the anchor gpui scrolls by: item, offset in it, viewport height), so
// this steps the anchor every frame (spikes/list-glide.tsx).
//
// Both resolve synchronously, so the end can be read and the anchor put back in the same tick,
// before anything paints. The glide is laid out from the end: each frame reads where the end is
// now (a streaming reply moves it) and sits the viewport `r` px above it, `r` easing to 0. From
// further than about a page away it starts a page away. The last step lands on the end itself,
// so the list follows the tail again. A scroll of your own stops it.

import type { useGpuixRequired } from '@gpuix/react'
import { duration, ease, reducedMotion } from '../components/motion'

type Renderer = ReturnType<typeof useGpuixRequired>
type Anchor = [number, number, number]

/** Past the last item: gpui clamps it to the end. */
const END = 1e9
/** A glide starts at most this many viewports from the end. */
const FAR = 1.25
const FRAME_MS = 16

const before = (a: Anchor, b: Anchor) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1])
const same = (a: Anchor | null, b: Anchor | null) => !!a && !!b && a[0] === b[0] && Math.abs(a[1] - b[1]) < 0.5

function anchorOf(r: Renderer, list: number): Anchor | null {
  return (r.getListScrollTop?.(list) as Anchor | null | undefined) ?? null
}

/** Where the list is when it sits `above` px over its end (gpui resolves a negative offset). */
function endAnchor(r: Renderer, list: number, above = 0): Anchor | null {
  r.scrollToItem?.(list, END, 0)
  const end = anchorOf(r, list)
  if (!end || !above) return end
  r.scrollToItem?.(list, end[0], end[1] - above)
  return anchorOf(r, list)
}

/**
 * How far the viewport is above the end, in px, searched up to `cap`: `cap` or more means at
 * least that far. Leaves the list where it was.
 */
export function distanceToEnd(r: Renderer, list: number, cap: number): number {
  const now = anchorOf(r, list)
  if (!now) return 0
  // Already there (or too short to scroll): leave it on the end itself, which keeps it following
  // the tail, rather than on an anchor that only happens to be the end right now.
  if (same(endAnchor(r, list), now)) return 0
  let lo = 0
  let hi = cap
  const far = endAnchor(r, list, cap)
  if (far && before(now, far)) hi = lo = cap
  while (hi - lo > 1) {
    const mid = (lo + hi) / 2
    const at = endAnchor(r, list, mid)
    if (at && before(at, now)) hi = mid
    else lo = mid
  }
  r.scrollToItem?.(list, now[0], now[1])
  return Math.round(lo)
}

/**
 * Glides the list to its end, `from` px above it (`distanceToEnd`). Returns a stop function, or
 * null when it jumped there at once (reduced motion, already there); `onDone` runs when a glide
 * ends, stopped or not. A scroll of your own stops it.
 */
export function glideToEnd(r: Renderer, list: number, from: number, onDone?: () => void): (() => void) | null {
  const now = anchorOf(r, list)
  const viewport = now?.[2] ?? 0
  if (!now || reducedMotion() || from < 1) {
    r.scrollToItem?.(list, END, 0)
    return null
  }
  from = Math.min(from, viewport * FAR)
  const seconds = from < viewport * 0.75 ? duration.standard : duration.considered
  const curve = bezier(ease.standard)
  const start = Date.now()
  let set: Anchor | null = now
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  const step = () => {
    if (stopped) return
    // Someone scrolled since the last frame: they win.
    if (!same(anchorOf(r, list), set)) return stop()
    const t = Math.min(1, (Date.now() - start) / (seconds * 1000))
    if (t >= 1) {
      r.scrollToItem?.(list, END, 0)
      stopped = true
      onDone?.()
      return
    }
    set = endAnchor(r, list, from * (1 - curve(t)))
    timer = setTimeout(step, FRAME_MS)
  }
  const stop = () => {
    stopped = true
    clearTimeout(timer)
    onDone?.()
  }
  step()
  return stop
}

/** A CSS-style cubic-bezier easing: progress for time `t` in [0, 1]. */
function bezier([x1, y1, x2, y2]: [number, number, number, number]) {
  const at = (a: number, b: number, s: number) => 3 * a * (1 - s) ** 2 * s + 3 * b * (1 - s) * s ** 2 + s ** 3
  const slope = (a: number, b: number, s: number) => 3 * a * (1 - s) ** 2 + 6 * (b - a) * (1 - s) * s + 3 * (1 - b) * s ** 2
  return (t: number) => {
    if (t <= 0 || t >= 1) return t <= 0 ? 0 : 1
    let s = t
    for (let i = 0; i < 6; i++) {
      const d = slope(x1, x2, s)
      if (Math.abs(d) < 1e-6) break
      s = Math.min(1, Math.max(0, s - (at(x1, x2, s) - t) / d))
    }
    return at(y1, y2, s)
  }
}

/**
 * Glides to the end when the viewport sits more than `slack` px above it; else does nothing.
 * Returns the glide's stop function, or null when there is no glide running.
 */
export function revealEnd(r: Renderer, list: number, slack: number, onDone?: () => void): (() => void) | null {
  const viewport = anchorOf(r, list)?.[2] ?? 0
  const from = distanceToEnd(r, list, viewport * FAR)
  return from > slack ? glideToEnd(r, list, from, onDone) : null
}
