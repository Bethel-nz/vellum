// Pure state + geometry for inline (anchored) and floating (companion) panels.
// No GPUIX imports: testable with `bun test`. UI lives in ui/QuickPanels.tsx.
//
// Reference measurements (see evidence/chatgpt-panels-ledger.md):
//   - spotlight window 760x640, hotkeyWindowHome 320x140, hotkeyWindowThread 400x400
//   - floating surfaces: fixed, z-30, max-h calc(100dvh - toolbar - 2rem), max-w 50vw,
//     resizable handles, hover-only minimize button, single-line compact mode
//   - inline surfaces: single-popover provider, anchor + hoverContainer, close reasons
//     pointer_exit / other_popover_opened / page_hidden / unmounted
// This file owns the invariants; the UI only renders them.

export type PanelMode = 'closed' | 'inline' | 'floating'

export interface Rect { x: number; y: number; width: number; height: number }
export interface Viewport { width: number; height: number }

export interface InlinePlacement {
  x: number
  y: number
  side: 'top' | 'bottom'
  width: number
  maxHeight: number
}

export interface FloatingPlacement { x: number; y: number; width: number; height: number }

export interface PanelState {
  mode: PanelMode
  /** Unsent text. Survives inline<->floating transitions and dismiss/restore. */
  draft: string
  /** Anchor identity for focus/position restore; never a live element reference. */
  anchorId?: string
  streaming: boolean
  /** Floating expanded from compact launcher (320x140-ish) to thread (400x480-ish). */
  expanded: boolean
}

export const INLINE_WIDTH = 360
export const INLINE_GAP = 6
export const INLINE_MARGIN = 8
export const FLOATING_LAUNCHER = { width: 360, height: 148 }
export const FLOATING_THREAD = { width: 400, height: 480 }
export const FLOATING_MARGIN = 12

export type PanelEvent =
  | { type: 'OPEN_INLINE'; anchorId?: string }
  | { type: 'OPEN_FLOATING'; anchorId?: string }
  | { type: 'EXPAND' }
  | { type: 'COLLAPSE' }
  | { type: 'DOCK' } // floating -> inline
  | { type: 'CLOSE' }
  | { type: 'ESCAPE' }
  | { type: 'OUTSIDE' } // pointer down outside an inline panel
  | { type: 'BLUR_WINDOW' }
  | { type: 'SET_DRAFT'; draft: string }
  | { type: 'STREAM_START' }
  | { type: 'STREAM_END' }

export function initialPanel(): PanelState {
  return { mode: 'closed', draft: '', streaming: false, expanded: false }
}

/**
 * Next state. Rules (why in SKILL.md):
 * - Inline closes on outside/Escape/blur; floating never closes on outside.
 * - Draft is never cleared by a transition, only by an explicit send (owner clears).
 * - Streaming pins the panel open: dismiss requests are ignored until STREAM_END.
 *   The owner is expected to queue the close and apply it then.
 * - Rapid toggle is a single retarget: OPEN in the same mode keeps draft and anchor.
 */
export function reducePanel(s: PanelState, e: PanelEvent): PanelState {
  switch (e.type) {
    case 'SET_DRAFT':
      return { ...s, draft: e.draft }
    case 'STREAM_START':
      return { ...s, streaming: true }
    case 'STREAM_END':
      return { ...s, streaming: false }
    case 'OPEN_INLINE':
      if (s.mode === 'inline') return { ...s, anchorId: e.anchorId ?? s.anchorId }
      return { ...s, mode: 'inline', anchorId: e.anchorId ?? s.anchorId, expanded: false }
    case 'OPEN_FLOATING':
      if (s.mode === 'floating') return { ...s, anchorId: e.anchorId ?? s.anchorId }
      return { ...s, mode: 'floating', anchorId: e.anchorId ?? s.anchorId }
    case 'EXPAND':
      if (s.mode !== 'floating') return s
      return { ...s, expanded: true }
    case 'COLLAPSE':
      if (s.mode !== 'floating') return s
      return { ...s, expanded: false }
    case 'DOCK':
      if (s.mode !== 'floating') return s
      return { ...s, mode: 'inline', expanded: false }
    case 'CLOSE':
      if (s.streaming) return s
      return { ...s, mode: 'closed', expanded: false }
    case 'ESCAPE':
      if (s.streaming) return s
      if (s.mode === 'floating' && s.expanded) return { ...s, expanded: false }
      return { ...s, mode: 'closed', expanded: false }
    case 'OUTSIDE':
      // Floating is a window: outside presses do not dismiss it.
      if (s.mode !== 'inline') return s
      if (s.streaming) return s
      return { ...s, mode: 'closed', expanded: false }
    case 'BLUR_WINDOW':
      // Inline is anchored to this window; a window blur dismisses it.
      // Floating persists across app blur like a native companion window.
      if (s.mode !== 'inline') return s
      if (s.streaming) return s
      return { ...s, mode: 'closed', expanded: false }
  }
}

/** Clamp helper: keep [pos, pos+size] inside [min, max-total]. */
function clampPos(pos: number, size: number, min: number, maxTotal: number): number {
  if (size >= maxTotal - min * 2) return min
  return Math.min(Math.max(pos, min), maxTotal - min - size)
}

/**
 * Place an anchored panel against `anchor` in `view`.
 * Picks the side with more room, clamps horizontally, caps height to the room
 * available minus gap and margin. Never invents a third position.
 */
export function placeInline(anchor: Rect, view: Viewport, width = INLINE_WIDTH): InlinePlacement {
  const w = Math.min(width, view.width - INLINE_MARGIN * 2)
  const x = clampPos(anchor.x, w, INLINE_MARGIN, view.width)
  const below = view.height - (anchor.y + anchor.height) - INLINE_GAP - INLINE_MARGIN
  const above = anchor.y - INLINE_GAP - INLINE_MARGIN
  const side = below >= above ? 'bottom' : 'top'
  const room = Math.max(120, side === 'bottom' ? below : above)
  const y = side === 'bottom' ? anchor.y + anchor.height + INLINE_GAP : anchor.y - INLINE_GAP
  // Cap growth: ChatGPT thread panels cap around 400-480 tall; inline caps lower.
  const maxHeight = Math.min(420, room)
  return { x, y, side, width: w, maxHeight }
}

/** Center `size` in `view`, clamped to the margin. Deterministic: no cascade. */
export function placeFloating(view: Viewport, size = FLOATING_THREAD): FloatingPlacement {
  const width = Math.min(size.width, view.width - FLOATING_MARGIN * 2)
  const height = Math.min(size.height, view.height - FLOATING_MARGIN * 2)
  return {
    x: Math.round((view.width - width) / 2),
    y: Math.round((view.height - height) / 2),
    width,
    height,
  }
}

/** Keep a dragged/resized floating rect fully reachable inside the window. */
export function clampFloating(r: FloatingPlacement, view: Viewport, margin = FLOATING_MARGIN): FloatingPlacement {
  const width = Math.min(r.width, view.width - margin * 2)
  const height = Math.min(r.height, view.height - margin * 2)
  return {
    width,
    height,
    x: clampPos(r.x, width, margin, view.width),
    y: clampPos(r.y, height, margin, view.height),
  }
}

/** Streaming guard used by the UI: dismiss requests while streaming are queued. */
export function canDismiss(s: PanelState): boolean {
  return !s.streaming
}
