// Springs the way SwiftUI and UIKit run them, for every `motion.div` in Vellum.
//
// GPUIX motion is tweens: a fixed curve over a fixed duration. Interrupt one and the new tween
// starts from rest, so a menu reversed mid-flight stops dead for a frame; and a curve can never
// overshoot (the renderer clamps it). Native UI runs springs instead: each value is pulled
// toward its target by a damped spring and keeps its speed when the target changes (WWDC18
// "Designing Fluid Interfaces", WWDC23 "Animate with springs").
//
// So `motion.div` here is a drop-in for GPUIX's, with the same initial/animate/exit/transition
// props, stepping the eight motion properties in JS on one shared ~120 Hz clock and handing the
// renderer plain styles. A transition with a `spring` uses it; any other converts to a smooth
// spring of about the same pace; `linear` and `material` loops (pulses, spinners) and
// duration-0 (reduced motion) stay with the renderer's own motion, which does those exactly.
//
// Exits work with GPUIX's AnimatePresence (`usePresence`). A surface with a box shadow scales
// the shadow's alpha with its opacity, so a fading popover no longer leaves its shadow painted
// at full strength (MOTION-CONTRACT.md §6): elevated surfaces can fade out too.

import { createContext, createElement, forwardRef, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  AnimatePresence as PresenceRoot,
  motion as native,
  usePresence,
  type MotionDivProps,
  type MotionStyle,
  type MotionTransition,
  type PublicInstance,
  type StyleDesc,
} from '@gpuix/react'

/** A spring by perceptual duration and bounce, as SwiftUI's `Spring(duration:bounce:)`. */
export type Spring = { duration: number; bounce: number }
export type SpringTransition = MotionTransition & { spring?: Spring }

/** SwiftUI's presets at desktop pace, plus the gesture hand-off spring. */
export const springs = {
  /** No overshoot: panels, sheets, layout. SwiftUI's default. */
  smooth: { duration: 0.42, bounce: 0 },
  /** A brisk tail: menus, popovers, toggles. */
  snappy: { duration: 0.3, bounce: 0.12 },
  /** Small things that should feel quick: badges, washes that move, indicators. */
  quick: { duration: 0.24, bounce: 0 },
  /** For motion that follows a gesture with momentum. */
  bouncy: { duration: 0.42, bounce: 0.25 },
} satisfies Record<string, Spring>

const keys = ['width', 'height', 'opacity', 'top', 'right', 'bottom', 'left', 'borderRadius'] as const
type Key = (typeof keys)[number]

/** Mass 1; stiffness (2π / duration)²; damping from bounce (WWDC23's conversion). */
function coefficients({ duration, bounce }: Spring) {
  const d = Math.max(0.05, duration)
  const k = (2 * Math.PI / d) ** 2
  const c = bounce >= 0 ? (4 * Math.PI * (1 - bounce)) / d : (4 * Math.PI) / (d * (1 + bounce))
  return { k, c }
}

/** One animated property. `unit`: a 0..1 value (opacity), not points. */
type Channel = { x: number; v: number; to: number; k: number; c: number; unit: boolean }
type Animation = { channels: Map<Key, Channel>; delayUntil: number; started: number; settleAfter: number; onFrame: () => void; onRest: () => void }

// One clock for every spring in the window: step all, then let React batch the re-renders.
const running = new Set<Animation>()
let timer: ReturnType<typeof setTimeout> | undefined
let last = 0
const FRAME_MS = 8

function tick() {
  timer = undefined
  const now = performance.now()
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
  for (const a of running) {
    if (now < a.delayUntil) continue
    let moving = false
    for (const ch of a.channels.values()) {
      // Semi-implicit Euler in 1/240 s steps: stable at every stiffness we use.
      let left = dt
      while (left > 0) {
        const h = Math.min(left, 1 / 240)
        ch.v += (-ch.k * (ch.x - ch.to) - ch.c * ch.v) * h
        ch.x += ch.v * h
        left -= h
      }
      // At rest once nothing visible is left: a quarter point, or a shade of opacity.
      const [near, slow] = ch.unit ? [0.002, 0.05] : [0.25, 6]
      if (Math.abs(ch.x - ch.to) > near || Math.abs(ch.v) > slow) moving = true
      else { ch.x = ch.to; ch.v = 0 }
    }
    a.onFrame()
    // At rest, or past the perceptual duration with what's left too small to see.
    if (!moving || now - a.started > a.settleAfter) {
      for (const ch of a.channels.values()) { ch.x = ch.to; ch.v = 0 }
      running.delete(a)
      a.onFrame()
      a.onRest()
    }
  }
  if (running.size) timer = setTimeout(tick, FRAME_MS)
}

function start(a: Animation) {
  running.add(a)
  if (!timer) {
    last = performance.now()
    timer = setTimeout(tick, FRAME_MS)
  }
}

/** The spring a transition asks for, or undefined when the renderer should run it as a tween. */
function springFor(t: SpringTransition | undefined): Spring | undefined {
  if (t?.spring) return t.spring
  const duration = t?.duration ?? 0.24
  if (duration === 0) return undefined
  if (t?.ease === 'linear' || isMaterial(t?.ease)) return undefined
  // A tween of d seconds reads as a spring of about 1.4 d: the spring's start is gentler.
  return { duration: Math.min(0.55, Math.max(0.18, duration * 1.4)), bounce: 0 }
}
const isMaterial = (ease: MotionTransition['ease']) => Array.isArray(ease) && ease[0] === 0.4 && ease[1] === 0 && ease[2] === 0.2 && ease[3] === 1

/** `#rrggbbaa` (or `#rrggbb`) with its alpha scaled by `k`. */
function fadeColor(color: string, k: number) {
  if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(color)) return color
  const a = color.length === 9 ? parseInt(color.slice(7), 16) : 255
  return color.slice(0, 7) + Math.round(a * Math.max(0, Math.min(1, k))).toString(16).padStart(2, '0')
}
function fadeShadow(shadow: StyleDesc['boxShadow'], k: number): StyleDesc['boxShadow'] {
  if (!shadow || k >= 1) return shadow
  const one = (s: Exclude<StyleDesc['boxShadow'], undefined | unknown[]>) => ({ ...s, color: fadeColor(s.color, k * k) })
  return Array.isArray(shadow) ? shadow.map(one) : one(shadow as Exclude<StyleDesc['boxShadow'], undefined | unknown[]>)
}

// `<AnimatePresence initial={false}>`: children there at its first render skip their entrance.
const SkipInitial = createContext(false)

export function AnimatePresence({ children, initial = true, onExitComplete }: { children?: ReactNode; initial?: boolean; onExitComplete?: () => void }) {
  const first = useRef(true)
  useEffect(() => { first.current = false }, [])
  return createElement(SkipInitial.Provider, { value: !initial && first.current }, createElement(PresenceRoot, { initial, onExitComplete }, children))
}

const SpringDiv = forwardRef<PublicInstance, MotionDivProps>(function SpringDiv({ initial, animate, exit, transition, onMotionComplete, style, ...rest }, ref) {
  const [isPresent, safeToRemove] = usePresence()
  const skip = useContext(SkipInitial)
  const exiting = !isPresent && exit !== undefined
  const target = exiting ? exit : animate
  const asked = springFor(transition as SpringTransition)
  // Dismissals run quicker than presentations and never bounce (Apple's sheets and menus).
  const spring = asked && exiting ? { duration: asked.duration * 0.8, bounce: 0 } : asked
  const from = skip || initial === false ? animate : { ...animate, ...initial }
  const values = useRef<Partial<Record<Key, number>>>(spring ? { ...from } : { ...target })
  const anim = useRef<Animation | undefined>(undefined)
  const [, redraw] = useState(0)
  const done = useRef({ onMotionComplete, isPresent, safeToRemove })
  done.current = { onMotionComplete, isPresent, safeToRemove }

  // Retarget on every change of target: channels keep their position and speed.
  const key = keys.map((k) => target[k]).join(',')
  useLayoutEffect(() => {
    // No exit style, or no spring: leave at once, as GPUIX's motion does (an atomic close).
    if (!spring || (!isPresent && !exit)) {
      if (!isPresent) safeToRemove?.()
      return
    }
    const { k, c } = coefficients(spring)
    const a: Animation = anim.current ?? {
      channels: new Map(),
      delayUntil: 0,
      started: 0,
      settleAfter: 0,
      onFrame: () => {
        for (const [name, ch] of a.channels) values.current[name] = ch.x
        redraw((n) => n + 1)
      },
      onRest: () => {
        done.current.onMotionComplete?.({ motionGeneration: 0 } as never)
        if (!done.current.isPresent) done.current.safeToRemove?.()
      },
    }
    anim.current = a
    let changed = false
    for (const name of keys) {
      const to = target[name]
      if (to === undefined) continue
      const ch = a.channels.get(name)
      const at = ch?.x ?? values.current[name] ?? to
      if (ch) { ch.to = to; ch.k = k; ch.c = c }
      else a.channels.set(name, { x: at, v: 0, to, k, c, unit: name === 'opacity' })
      if (at !== to) changed = true
    }
    if (!changed) {
      // Nothing to move (or already there): still settle an exit, and report completion.
      if (!running.has(a)) a.onRest()
      return
    }
    const now = performance.now()
    a.delayUntil = now + (transition?.delay ?? 0) * 1000
    a.started = a.delayUntil
    // Done by the perceptual duration, not the long tail: an exit leaves at 1.2× (about 1%
    // left, with its opacity faded to nothing); an entrance lands its last fraction exactly.
    a.settleAfter = spring.duration * 1000 * (exiting ? 1.2 : spring.bounce > 0 ? 2 : 1.4)
    start(a)
  }, [key, isPresent, spring?.duration, spring?.bounce, exiting])

  useEffect(() => () => { if (anim.current) running.delete(anim.current) }, [])

  // Without a spring, the renderer's own motion runs it (loops, reduced motion).
  if (!spring) return createElement(native.div, { ref, initial, animate, exit, transition, onMotionComplete, style, ...rest })
  const now = values.current
  const opacity = now.opacity
  const merged: StyleDesc = { ...style, ...now }
  if (opacity !== undefined && opacity < 1 && style?.boxShadow) merged.boxShadow = fadeShadow(style.boxShadow, opacity)
  return createElement('div', { ref, ...rest, style: merged })
})

/** Drop-in for GPUIX's `motion`: the same props, run as springs. */
export const motion = { div: SpringDiv }
export type { MotionDivProps, MotionStyle }
