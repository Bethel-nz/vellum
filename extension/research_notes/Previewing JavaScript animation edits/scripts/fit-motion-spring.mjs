// fit-motion-spring.mjs: standalone port of Motion's spring maths, for fitting and previewing.
// What it proves: run directly, it prints Motion's resolution of {duration .55, bounce .16} (flora's
// carousel) and of the edited {duration 1.0, bounce .4}, the exact inverse back to duration/bounce, and the
// linear() string Motion would hand WAAPI. fit-flora-sample.mjs checks this port against Motion's own
// per-frame writes on flora.so; fit-local-models.mjs plays its linear() in Chromium and refits it.
// Run: node fit-motion-spring.mjs        (no dependencies, no network)
//
// Port of Motion's spring maths (motion-dom 14.14.0, 2026-11-13:
// dist/es/animation/generators/spring.mjs, waapi/utils/linear.mjs,
// generators/utils/calc-duration.mjs, generators/utils/create-generator-easing.mjs).
// Written from reading the source; no Motion code is imported or executed.
// Units: durations in ms unless the name says seconds; velocity in units/s.

const restSpeedGranular = 0.01, restSpeedDefault = 2
const restDeltaGranular = 0.005, restDeltaDefault = 0.5
const minDuration = 0.01, maxDuration = 10.0 // seconds
const minDamping = 0.05
const safeMin = 0.001
const rootIterations = 12
export const maxGeneratorDuration = 20000

const clamp = (min, max, v) => Math.min(Math.max(v, min), max)

/** SwiftUI-style: 0 critical, ->1 undamped, negative = overdamped (ratio 1/(1+bounce)). */
export const bounceToDampingRatio = (bounce) => bounce < 0 ? 1 / Math.max(1 + bounce, minDamping) : Math.max(1 - bounce, minDamping)
/** Inverse of bounceToDampingRatio (exact inside the clamp). */
export const dampingRatioToBounce = (ratio) => ratio > 1 ? 1 / ratio - 1 : 1 - ratio

function approximateRoot(envelope, derivative, initialGuess) {
  let result = initialGuess
  for (let i = 1; i < rootIterations; i++) result = result - envelope(result) / derivative(result)
  return result
}
const calcAngularFreq = (undampedFreq, dampingRatio) => undampedFreq * Math.sqrt(1 - dampingRatio * dampingRatio)

function overdampedFreqScale(dampingRatio, criticalFreqTime) {
  if (!(dampingRatio > 1)) return 1
  const root = Math.sqrt(dampingRatio * dampingRatio - 1)
  const slow = dampingRatio - root, fast = dampingRatio + root
  const target = 2 * root * Math.exp(-criticalFreqTime) * (1 + criticalFreqTime)
  return approximateRoot((ft) => fast * Math.exp(-slow * ft) - slow * Math.exp(-fast * ft) - target,
    (ft) => Math.exp(-fast * ft) - Math.exp(-slow * ft), criticalFreqTime) / criticalFreqTime
}

/** Motion's findSpring: {duration (ms), bounce} -> {stiffness, damping, duration (ms)}, mass 1, from rest. */
export function findSpring({ duration = 800, bounce = 0.3 }) {
  let envelope, derivative
  const dampingRatio = bounceToDampingRatio(bounce)
  duration = clamp(minDuration, maxDuration, duration / 1000)
  if (dampingRatio < 1) {
    envelope = (w) => { const a = w * dampingRatio; return safeMin - (a / calcAngularFreq(w, dampingRatio)) * Math.exp(-a * duration) }
    derivative = (w) => {
      const a = w * dampingRatio, delta = a * duration
      const e = dampingRatio * dampingRatio * w * w * duration
      const f = Math.exp(-delta)
      const g = calcAngularFreq(w * w, dampingRatio)
      const factor = -envelope(w) + safeMin > 0 ? -1 : 1
      return (factor * -e * f) / g
    }
  } else {
    envelope = (w) => -safeMin + Math.exp(-w * duration) * (w * duration + 1)
    derivative = (w) => Math.exp(-w * duration) * (-w * duration * duration)
  }
  const criticalFreq = approximateRoot(envelope, derivative, 5 / duration)
  const undampedFreq = criticalFreq * overdampedFreqScale(dampingRatio, criticalFreq * duration)
  const stiffness = undampedFreq * undampedFreq
  return { stiffness, damping: dampingRatio * 2 * Math.sqrt(stiffness), duration: duration * 1000 }
}

const isValidPhysics = (v, canBeZero) => (canBeZero ? v >= 0 : v > 0) && v < Infinity
const resolvePhysics = (v, canBeZero) => isValidPhysics(v, canBeZero) ? v : undefined

/** Motion's getSpringOptions: physics win over duration/bounce; visualDuration (seconds) skips findSpring. */
export function getSpringOptions(options) {
  const s = resolvePhysics(options.stiffness), d = resolvePhysics(options.damping, true), m = resolvePhysics(options.mass)
  const o = { ...options, stiffness: s ?? 100, damping: d ?? 10, mass: m ?? 1, isResolvedFromDuration: false,
    isTimeDefined: (s ?? d ?? m) === undefined && (options.duration !== undefined || options.bounce !== undefined) }
  if (o.isTimeDefined) {
    if (options.visualDuration) {
      const ratio = bounceToDampingRatio(options.bounce || 0)
      const root = ((2 * Math.PI) / (options.visualDuration * 1.2)) * overdampedFreqScale(ratio, (2 * Math.PI) / 1.2)
      o.stiffness = root * root
      o.damping = 2 * ratio * Math.sqrt(o.stiffness)
    } else {
      Object.assign(o, findSpring(o))
      o.isResolvedFromDuration = true
    }
    if (!isValidPhysics(o.stiffness) || !isValidPhysics(o.damping, true)) { o.stiffness = 100; o.damping = 10 }
  }
  return o
}

/**
 * Motion's spring generator. options: {keyframes:[from,to], velocity (units/s), stiffness, damping, mass,
 * duration (ms), bounce, visualDuration (s), restSpeed, restDelta}. next(t ms) -> {value, done}.
 */
export function spring(options) {
  const origin = options.keyframes[0], target = options.keyframes.at(-1)
  const state = { done: false, value: origin }
  const { stiffness, damping, mass, duration, isResolvedFromDuration, isTimeDefined } = getSpringOptions({ ...options })
  // Duration springs start from rest (Motion 14.x); others inherit velocity. Motion's internal sign is negated.
  const inheritVelocity = (v) => isResolvedFromDuration ? 0 : -((v || 0) / 1000)
  const dampingRatio = damping / (2 * Math.sqrt(stiffness * mass))
  const w0 = Math.sqrt(stiffness / mass) / 1000 // rad/ms
  const decay = dampingRatio * w0
  const st = { target, delta: target - origin, velocity: inheritVelocity(options.velocity) || 0 }
  const granular = Math.abs(st.delta) < 5
  const restSpeed = options.restSpeed || (granular ? restSpeedGranular : restSpeedDefault)
  const restDelta = options.restDelta || (granular ? restDeltaGranular : restDeltaDefault)
  let resolveSpring, resolveVelocity
  if (dampingRatio < 1) {
    const wd = calcAngularFreq(w0, dampingRatio)
    const A = (st.velocity + decay * st.delta) / wd
    const sinC = decay * A + st.delta * wd, cosC = decay * st.delta - A * wd
    resolveSpring = (t) => st.target - Math.exp(-decay * t) * (A * Math.sin(wd * t) + st.delta * Math.cos(wd * t))
    resolveVelocity = (t) => Math.exp(-decay * t) * (sinC * Math.sin(wd * t) + cosC * Math.cos(wd * t))
  } else if (dampingRatio === 1) {
    const C = st.velocity + w0 * st.delta
    resolveSpring = (t) => st.target - Math.exp(-w0 * t) * (st.delta + (st.velocity + w0 * st.delta) * t)
    resolveVelocity = (t) => Math.exp(-w0 * t) * (w0 * C * t - st.velocity)
  } else {
    const wd = w0 * Math.sqrt(dampingRatio * dampingRatio - 1)
    const slow = decay - wd, fast = decay + wd
    const limit = wd < 1 || isTimeDefined ? Infinity : 300 / wd
    const decayAt = (rate, t) => Math.exp(t > limit ? (decay - rate) * limit - decay * t : -rate * t)
    const P = (st.velocity + decay * st.delta) / wd
    const S = (st.delta + P) / 2, F = (st.delta - P) / 2
    resolveSpring = (t) => st.target - S * decayAt(slow, t) - F * decayAt(fast, t)
    resolveVelocity = (t) => slow * S * decayAt(slow, t) + fast * F * decayAt(fast, t)
  }
  const generator = {
    stiffness, damping, mass, dampingRatio, isResolvedFromDuration,
    calculatedDuration: isResolvedFromDuration ? duration || null : null,
    velocity: (t) => resolveVelocity(t) * 1000,
    next: (t) => {
      const current = resolveSpring(t)
      if (!isResolvedFromDuration) {
        state.done = Math.abs(resolveVelocity(t) * 1000) <= restSpeed && Math.abs(st.target - current) <= restDelta
      } else state.done = t >= duration
      state.value = state.done ? st.target : current
      return state
    },
    toString: () => {
      const d = Math.min(calcGeneratorDuration(generator), maxGeneratorDuration)
      return d + 'ms ' + generateLinearEasing((p) => generator.next(d * p).value, d, 30)
    },
  }
  return generator
}

/** Motion's calcGeneratorDuration: steps of 50 ms until done (so durations are multiples of 50). */
export function calcGeneratorDuration(generator, timeStep = 50, maxDuration = maxGeneratorDuration) {
  let duration = 0
  let state = generator.next(duration)
  while (!state.done && duration < maxDuration) { duration += timeStep; state = generator.next(duration) }
  return duration >= maxDuration ? Infinity : duration
}

/** Motion's generateLinearEasing: evenly spaced points, one per `resolution` ms, 4 decimals. */
export function generateLinearEasing(easing, duration, resolution = 10) {
  let points = ''
  const n = Math.max(Math.round(duration / resolution), 2)
  for (let i = 0; i < n; i++) points += Math.round(easing(i / (n - 1)) * 10000) / 10000 + ', '
  return `linear(${points.substring(0, points.length - 2)})`
}

/**
 * What Motion hands WAAPI for a spring (createGeneratorEasing + mapEasingToNativeEasing): a 0..100 spring,
 * a duration rounded up to 50 ms steps, and a linear() string at 10 ms resolution.
 */
export function springToWaapi(options, resolution = 10) {
  const k = options.keyframes ?? [0, 1]
  const delta = k.at(-1) - k[0]
  const generator = spring({ ...options, velocity: options.velocity && delta ? (options.velocity * 100) / delta : options.velocity, keyframes: [0, 100] })
  const duration = Math.min(calcGeneratorDuration(generator), maxGeneratorDuration)
  const ease = (p) => generator.next(duration * p).value / 100
  return { duration, easing: generateLinearEasing(ease, duration, resolution), ease, generator }
}

/** Physics -> Motion's time options. duration inverts findSpring exactly (closed form of its envelope root). */
export function physicsToTime({ stiffness, damping, mass = 1 }) {
  const w0 = Math.sqrt(stiffness / mass)
  const ratio = damping / (2 * Math.sqrt(stiffness * mass))
  const bounce = dampingRatioToBounce(ratio)
  let duration
  if (ratio < 1) duration = -Math.log((safeMin * Math.sqrt(1 - ratio * ratio)) / ratio) / (ratio * w0)
  else {
    // critical envelope: e^{-wT}(wT+1) = safeMin; overdamped scales w by overdampedFreqScale, solved by bisection
    const solveCritical = () => { let lo = 0, hi = 100; for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (Math.exp(-m) * (m + 1) > safeMin) lo = m; else hi = m } return (lo + hi) / 2 }
    const x = solveCritical() // = criticalFreq * T
    duration = (x * overdampedFreqScale(ratio, x)) / w0
  }
  const visualDuration = ratio <= 1 ? (2 * Math.PI) / (1.2 * w0) : (2 * Math.PI * overdampedFreqScale(ratio, (2 * Math.PI) / 1.2)) / (1.2 * w0)
  return { duration, bounce, visualDuration, dampingRatio: ratio, undampedFreq: w0 }
}

/** Generic damped-oscillator position (any library): from x0 with v0 (units/s) toward x1, physics in s^-1. */
export function oscillator({ x0, x1, v0 = 0, w0, zeta }) {
  const d = x0 - x1
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta)
    const B = (v0 + zeta * w0 * d) / wd
    return (t) => t <= 0 ? x0 : x1 + Math.exp(-zeta * w0 * t) * (d * Math.cos(wd * t) + B * Math.sin(wd * t))
  }
  if (zeta === 1) return (t) => t <= 0 ? x0 : x1 + Math.exp(-w0 * t) * (d + (v0 + w0 * d) * t)
  const r = w0 * Math.sqrt(zeta * zeta - 1)
  const s1 = -zeta * w0 + r, s2 = -zeta * w0 - r
  const c2 = (v0 - s1 * d) / (s2 - s1), c1 = d - c2
  return (t) => t <= 0 ? x0 : x1 + c1 * Math.exp(s1 * t) + c2 * Math.exp(s2 * t)
}

// ---- self-test when run directly ----
if (import.meta.url === new URL(process.argv[1], 'file://').href || process.argv[1]?.endsWith('fit-motion-spring.mjs')) {
  const show = (label, o) => console.log(label.padEnd(34), JSON.stringify(o, (k, v) => typeof v === 'number' ? +v.toFixed(4) : v))
  const flora = findSpring({ duration: 550, bounce: 0.16 })
  show('findSpring(550 ms, bounce .16)', flora)
  show('  back to time options', physicsToTime(flora))
  const edited = findSpring({ duration: 1000, bounce: 0.4 })
  show('findSpring(1000 ms, bounce .4)', edited)
  show('  back to time options', physicsToTime(edited))
  const v = getSpringOptions({ keyframes: [0, 1], visualDuration: 0.55, bounce: 0.16 })
  show('visualDuration .55, bounce .16', { stiffness: v.stiffness, damping: v.damping })
  for (const [label, o] of [['flora as WAAPI', { duration: 550, bounce: 0.16 }], ['edited as WAAPI', { duration: 1000, bounce: 0.4 }], ['physics 100/10/1 as WAAPI', { stiffness: 100, damping: 10, mass: 1 }]]) {
    const w = springToWaapi({ keyframes: [0, 1], ...o })
    console.log(label.padEnd(34), `${w.duration}ms`, w.easing.slice(0, 90) + '…', `(${w.easing.length} chars)`)
  }
  const g = spring({ keyframes: [-288, -576], duration: 550, bounce: 0.16 })
  let peak = 0
  for (let t = 0; t <= 550; t++) peak = Math.min(peak, g.next(t).value + 576)
  console.log('flora move -288 -> -576'.padEnd(34), `overshoot ${peak.toFixed(2)} px, value at 549 ms ${g.next(549).value.toFixed(3)}, at 550 ms ${g.next(550).value} (snaps: duration springs end at t >= duration)`)
}
