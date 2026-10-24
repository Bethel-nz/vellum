// Motion tokens, translated from arc-library (~/dev/arc-library/registry/motion-tokens.ts) to GPUIX.
//
// GPUIX motion is tweens only: width/height/top/right/bottom/left/opacity/borderRadius, with a
// duration, delay and cubic-bezier ease. There are no springs, scale or keyframes. Arc's springs
// are all critically damped (bounce 0), so each becomes a tween of the same visual duration on
// arc's enter curve, which settles the same way without overshooting.
//
// Every animation goes through `tween()`, which collapses to duration 0 under reduced motion.
// Full renderer and hit-testing rules: ../MOTION-CONTRACT.md.

import type { MotionTransition } from '@gpuix/react'
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
}

export const duration = { instant: 0.12, fast: 0.16, exit: 0.18, standard: 0.24, considered: 0.48 }

/** Arc's springs as tweens: snappy for presses, thumbs and indicators; smooth for panels; morph for shape changes. */
export const spring = {
  snappy: { duration: 0.26, ease: ease.enter },
  smooth: { duration: 0.4, ease: ease.enter },
  morph: { duration: 0.42, ease: ease.standard },
}

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
export function tween(t: MotionTransition): MotionTransition {
  return reduced ? { duration: 0 } : t
}

export const enter = (d: keyof typeof duration = 'standard', delay = 0) => tween({ duration: duration[d], ease: ease.enter, delay })
export const leave = (d: keyof typeof duration = 'exit') => tween({ duration: duration[d], ease: ease.standard })
/** Hover and press washes. */
export const wash = () => tween({ duration: 0.1, ease: ease.standard })
