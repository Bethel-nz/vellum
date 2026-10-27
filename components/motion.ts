// Motion tokens, translated from arc-library (~/dev/arc-library/registry/motion-tokens.ts) to GPUIX.
//
// GPUIX motion animates width/height/top/right/bottom/left/opacity/borderRadius. Its own motion
// is tweens only, so `motion.div` in Vellum is components/spring.tsx: the same props, run as
// springs that keep their speed when retargeted, the way SwiftUI and UIKit animate. A transition
// may name its spring (`spring.*` below do); any other tween converts to a smooth spring of
// about the same pace. `duration`/`ease` stay on each token for the renderer's fallback.
//
// Every animation goes through `tween()`, which collapses to duration 0 under reduced motion.
// Full renderer and hit-testing rules: ../MOTION-CONTRACT.md.

import { springs, type SpringTransition } from './spring'
import { useSyncExternalStore } from 'react'
import { systemReduceMotion } from '../core/platform'

type Bezier = [number, number, number, number]

export const ease = {
  enter: [0.16, 1, 0.3, 1] as Bezier,
  exit: [0.7, 0, 0.84, 0] as Bezier,
  standard: [0.22, 1, 0.36, 1] as Bezier,
  /** Elements that move while already on screen. */
  inOut: [0.65, 0, 0.35, 1] as Bezier,
  /** Loops such as the running-agent pulse. */
  material: [0.4, 0, 0.2, 1] as Bezier,
  /**
   * Arc's `smooth` spring itself (critically damped from rest, visual duration .4s), fitted
   * within 1%: it starts gently, where `enter` jumps 75% of the way in the first fifth.
   * For panels whose entrance should read as a slide, not a pop.
   */
  spring: [0.25, 0.2, 0.15, 0.95] as Bezier,
}

export const duration = { instant: 0.12, fast: 0.16, exit: 0.18, standard: 0.24, considered: 0.48 }

/** Arc's springs as tweens: snappy for presses, thumbs and indicators; smooth for panels; morph for shape changes. */
export const spring = {
  snappy: { duration: 0.26, ease: ease.enter, spring: springs.snappy },
  smooth: { duration: 0.4, ease: ease.enter, spring: springs.smooth },
  morph: { duration: 0.42, ease: ease.standard, spring: springs.smooth },
  /** Docked panels opening their space (components/DockPanel.tsx): arc's drawer motion. */
  panel: { duration: 0.4, ease: ease.spring, spring: springs.smooth },
} satisfies Record<string, SpringTransition>

/** Stagger steps in seconds; only the first few items stagger so the total stays short. */
export const stagger = { item: 0.035, maxItems: 4 }

/** Popovers and menus start this far toward their trigger, dialogs and toasts a little further. */
export const offset = { menu: 5, tooltip: 3, dialog: 8, toast: 16 }

let reduced = systemReduceMotion()
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The system's "Reduce motion", unless the settings sheet overrides it. */
export function reducedMotion() {
  return reduced
}

export function setReducedMotion(value: boolean | undefined) {
  const next = value ?? systemReduceMotion()
  if (next === reduced) return
  reduced = next
  for (const listener of listeners) listener()
}

/** Repaint mounted controls too when the settings override changes. */
export const useReducedMotion = () => useSyncExternalStore(subscribe, reducedMotion, reducedMotion)

/** A transition that respects reduced motion. */
export function tween(t: SpringTransition): SpringTransition {
  return reduced ? { duration: 0 } : t
}

export const enter = (d: keyof typeof duration = 'standard', delay = 0) => tween({ duration: duration[d], ease: ease.enter, delay })
export const leave = (d: keyof typeof duration = 'exit') => tween({ duration: duration[d], ease: ease.standard })
/** Hover and press washes. */
export const wash = () => tween({ duration: 0.1, ease: ease.standard })
