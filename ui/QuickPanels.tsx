// Quick inline + floating panels for Vellum.
//
// Primitives:
//   - Inline  = FloatingLayer (anchored popover) + DismissableLayer. Closes on
//     Escape / outside press / window blur. Single instance: opening a second
//     inline panel retargets the first.
//   - Floating = window-fill overlay emulating a native companion window.
//     The floating panel lives in the window layer:
//     centered, draggable, Escape to collapse/close, and — unlike inline — it
//     never closes on outside presses and survives window blur.
//
// Motion (components/motion.ts + MOTION-CONTRACT.md):
//   - Enter: opacity + 5px rise (inline) / 8px (floating) on `enter`, fast.
//   - Close: instant unmount (elevated shadow cannot fade with the panel).
//   - Interruptible: springs retarget; no isAnimating guards; reduced motion = 0.
// Geometry: core/panels.ts (placeInline / placeFloating / clampFloating).

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { DismissableLayer, useGpuixRequired, type PublicInstance } from '@gpuix/react'
import { FloatingLayer } from '@gpuix/react/floating'
import { PopoverBackdrop } from '../components/PopoverBackdrop'
import { motion } from '../components/spring'
import { concentric, elevation, radiusBase } from './theme'
import { enter, offset, useReducedMotion } from '../components/motion'
import { useM } from '../components/theme'
import { clampFloating, placeFloating, type FloatingPlacement, type PanelState } from '../core/panels'

const PAD = 5
const INLINE_WIDTH = 360

export function InlinePanel({
  state,
  anchor,
  onClose,
  onDockHint,
  header,
  children,
  testId = 'quick-inline',
}: {
  state: PanelState
  /** Anchor rect in window coordinates, from onLayout. */
  anchor: { x: number; y: number; width: number; height: number } | null
  onClose: () => void
  onDockHint?: string
  header?: ReactNode
  children: ReactNode
  testId?: string
}) {
  const m = useM()
  const reduced = useReducedMotion()
  if (state.mode !== 'inline') return null
  // Side follows the roomier direction; FloatingLayer does the native clamp.
  // placeInline is the source of truth for width/cap; side is re-derived here
  // from the same anchor so the two never disagree about direction.
  const side = anchor && anchor.y > 420 ? 'top' : 'bottom'
  const from = side === 'bottom' ? -offset.menu : offset.menu
  return (
    <DismissableLayer onEscapeKeyDown={onClose}>
      <FloatingLayer side={side} align="start" sideOffset={6} style={{ width: INLINE_WIDTH, borderRadius: radiusBase + PAD, backgroundColor: '#00000000' }}>
        <PopoverBackdrop onClose={onClose} testId={testId ? `${testId}-backdrop` : undefined} />
        <div
          testId={testId}
          role="dialog"
          aria-label="Quick ask"
          style={{ position: 'relative', keyboardFocusDim: false }}
        >
          <motion.div
            initial={reduced ? false : { opacity: 0, top: from }}
            animate={{ opacity: 1, top: 0 }}
            transition={enter('fast')}
            style={{
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: m.popup,
              borderRadius: concentric(radiusBase + PAD, 0),
              borderWidth: 1,
              borderColor: m.border,
              boxShadow: elevation(m, 'popover'),
              overflow: 'hidden',
              pointerEvents: 'auto',
            }}
          >
            {header}
            <div style={{ display: 'flex', flexDirection: 'column', padding: PAD, gap: 6, maxHeight: 420, overflow: 'scroll' }}>
              {children}
            </div>
            {onDockHint ? (
              <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-end', paddingLeft: 10, paddingRight: 10, paddingBottom: 7 }}>
                <text style={{ fontSize: 11.5, lineHeight: 14, color: m.textFaint }}>{onDockHint}</text>
              </div>
            ) : null}
          </motion.div>
        </div>
      </FloatingLayer>
    </DismissableLayer>
  )
}

export function FloatingPanel({
  state,
  view,
  onClose,
  onCollapse,
  onExpand,
  onMove,
  header,
  children,
  testId = 'quick-floating',
}: {
  state: PanelState
  /** Window size from useWindowSize; used to center and clamp. */
  view: { width: number; height: number }
  onClose: () => void
  onCollapse: () => void
  onExpand: () => void
  onMove?: (r: FloatingPlacement) => void
  header?: (drag: (e: { x: number; y: number }) => void) => ReactNode
  children: ReactNode
  testId?: string
}) {
  const m = useM()
  const reduced = useReducedMotion()
  const renderer = useGpuixRequired()
  const [rect, setRect] = useState<FloatingPlacement>(() =>
    clampFloating(placeFloating(view, state.expanded ? { width: 400, height: 480 } : { width: 360, height: 148 }), view),
  )
  const dragFrom = useRef<{ x: number; y: number; rx: number; ry: number } | null>(null)

  // Retarget (don't jump) when expand/collapse or window size changes.
  useEffect(() => {
    setRect((r) => {
      const want = state.expanded ? { width: 400, height: 480 } : { width: 360, height: 148 }
      const next = clampFloating({ x: r.x, y: r.y, ...want }, view)
      // Keep centered when the window grows around a centered panel.
      if (Math.abs(r.x - Math.round((view.width - r.width) / 2)) < 4) next.x = Math.round((view.width - next.width) / 2)
      return next
    })
  }, [state.expanded, view.width, view.height])

  const emit = useCallback(
    (r: FloatingPlacement) => {
      setRect(r)
      onMove?.(r)
    },
    [onMove],
  )

  const onHeaderMove = useCallback(
    (e: { x?: number; y?: number }) => {
      const d = dragFrom.current
      if (!d || e.x == null || e.y == null) return
      renderer.clearSelection?.()
      emit(clampFloating({ ...rect, x: d.rx + (e.x - d.x), y: d.ry + (e.y - d.y) }, view))
    },
    [emit, rect, renderer, view],
  )

  const body = useRef<PublicInstance>(null)
  const dims = useMemo(() => ({ width: rect.width, height: state.expanded ? rect.height : 148 }), [rect, state.expanded])

  if (state.mode !== 'floating') return null
  return (
    <DismissableLayer
      onEscapeKeyDown={() => (state.expanded ? onCollapse() : onClose())}
      initialFocus={() => body.current?.id ?? null}
    >
      {/* Window-fill layer: the companion window's stand-in. Outside presses land here and are ignored. */}
      <div testId={`${testId}-layer`} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', left: rect.x, top: rect.y, width: dims.width, height: dims.height, pointerEvents: 'auto' }}>
        <motion.div
          initial={reduced ? false : { opacity: 0, top: offset.dialog }}
          animate={{ opacity: 1, top: 0 }}
          transition={enter('standard')}
          style={{ position: 'relative', width: '100%', height: '100%', pointerEvents: 'none' }}
        >
          <div
            ref={body}
            testId={testId}
            role="dialog"
            aria-label={state.expanded ? 'Companion thread' : 'Companion launcher'}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'escape') {
                e.preventDefault()
                if (state.expanded) onCollapse()
                else onClose()
              }
            }}
            style={{
              display: 'flex',
              flexDirection: 'column',
              width: dims.width,
              height: dims.height,
              backgroundColor: m.popup,
              // Nested corners share a center: outer 14, inset 5 -> inner 9.
              borderRadius: concentric(14, 0),
              borderWidth: 1,
              borderColor: m.border,
              boxShadow: elevation(m, 'card'),
              overflow: 'hidden',
              keyboardFocusDim: false,
              pointerEvents: 'auto',
            }}
          >
            <div
              onMouseDown={(e) => {
                dragFrom.current = { x: e.x ?? 0, y: e.y ?? 0, rx: rect.x, ry: rect.y }
              }}
              onMouseMove={onHeaderMove}
              onMouseUp={() => {
                dragFrom.current = null
              }}
              style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingLeft: 12, paddingRight: 8, flexShrink: 0, cursor: 'grab' }}
            >
              {header ? (
                header(onHeaderMove)
              ) : (
                <text style={{ flexGrow: 1, fontSize: 13, lineHeight: 16, fontWeight: 600, color: m.text }}>Ask Vellum</text>
              )}
              <div
                testId={`${testId}-expand`}
                aria-label={state.expanded ? 'Collapse (Esc)' : 'Expand'}
                role="button"
                onMouseDown={() => (state.expanded ? onCollapse() : onExpand())}
                style={{ minHeight: 24, height: 24, paddingLeft: 8, paddingRight: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: 6 }}
              >
                <text style={{ fontSize: 12, color: m.textMuted }}>{state.expanded ? '–' : '+'}</text>
              </div>
              <div
                testId={`${testId}-close`}
                aria-label="Close (Esc)"
                role="button"
                onMouseDown={onClose}
                style={{ minHeight: 24, height: 24, paddingLeft: 8, paddingRight: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: 6 }}
              >
                <text style={{ fontSize: 12, color: m.textMuted }}>✕</text>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, paddingLeft: 10, paddingRight: 10, paddingBottom: 10, gap: 6, overflow: 'scroll' }}>
              {children}
            </div>
          </div>
        </motion.div>
        </div>
      </div>
    </DismissableLayer>
  )
}
