// fit-core.mjs: library-agnostic motion fitting used by the fit-*.mjs proofs (import it; it prints nothing).
// detectSegments/fillHolds find moves in a sampled channel; fitSpring fits a damped oscillator (t0, w0, zeta,
// optional v0, Huber loss) and converts it to Motion's {duration, bounce, visualDuration} and physics;
// fitBezier fits cubic-bezier + duration; fitSegment fits both and picks by BIC.
//
// Library-agnostic motion fitting: segment detection, damped-spring fit, cubic-bezier fit, model choice.
// Input: samples [{t (ms), v}] for one channel (e.g. translateX px). No dependencies.
import { oscillator, physicsToTime, dampingRatioToBounce } from './fit-motion-spring.mjs'

// ---------- Nelder-Mead ----------
export function nelderMead(f, x0, { step, iterations = 1500, tol = 1e-10 } = {}) {
  const n = x0.length
  let simplex = [x0.slice()]
  for (let i = 0; i < n; i++) { const x = x0.slice(); x[i] += step?.[i] ?? (Math.abs(x[i]) * 0.1 || 0.1); simplex.push(x) }
  let values = simplex.map(f)
  for (let it = 0; it < iterations; it++) {
    const order = values.map((v, i) => i).sort((a, b) => values[a] - values[b])
    simplex = order.map((i) => simplex[i]); values = order.map((i) => values[i])
    if (Math.abs(values[n] - values[0]) <= tol * (Math.abs(values[0]) + tol)) break
    const centroid = Array(n).fill(0)
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) centroid[j] += simplex[i][j] / n
    const at = (c) => centroid.map((v, j) => v + c * (simplex[n][j] - v))
    const reflected = at(-1), fr = f(reflected)
    if (fr < values[0]) { const expanded = at(-2), fe = f(expanded); if (fe < fr) { simplex[n] = expanded; values[n] = fe } else { simplex[n] = reflected; values[n] = fr } }
    else if (fr < values[n - 1]) { simplex[n] = reflected; values[n] = fr }
    else {
      const contracted = fr < values[n] ? at(-0.5) : at(0.5), fc = f(contracted)
      if (fc < Math.min(fr, values[n])) { simplex[n] = contracted; values[n] = fc }
      else for (let i = 1; i <= n; i++) { simplex[i] = simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j])); values[i] = f(simplex[i]) }
    }
  }
  const best = values.indexOf(Math.min(...values))
  return { x: simplex[best], value: values[best] }
}

// ---------- segment detection ----------
/**
 * Change-only streams (a MutationObserver on style, or a recorder that skips unchanged frames) have no
 * samples while the value holds. Put a held sample one frame after and one frame before each gap.
 */
export function fillHolds(samples, { holdMs = 90 } = {}) {
  const dts = samples.slice(1).map((s, i) => s.t - samples[i].t).filter((d) => d > 0).sort((a, b) => a - b)
  const frame = dts[Math.floor(dts.length / 2)] ?? 16.67
  const out = []
  for (let i = 0; i < samples.length; i++) {
    if (i && samples[i].t - samples[i - 1].t >= holdMs) {
      out.push({ t: samples[i - 1].t + frame, v: samples[i - 1].v, held: true }, { t: samples[i].t - frame, v: samples[i - 1].v, held: true })
    }
    out.push(samples[i])
  }
  return out
}

/**
 * Splits a sampled channel into motion segments. A segment runs from the last still sample before
 * movement to the first sample of a hold that lasts holdMs. Small steps at an overshoot's turnaround
 * don't split a segment because the hold must last holdMs.
 */
export function detectSegments(samples, { holdMs = 90, absEps = 0.05, relEps = 1e-4, minAmplitude = 1 } = {}) {
  const values = samples.map((s) => s.v)
  const range = Math.max(...values) - Math.min(...values)
  const eps = Math.max(absEps, relEps * range)
  const segments = []
  let i = 1
  while (i < samples.length) {
    if (Math.abs(samples[i].v - samples[i - 1].v) <= eps) { i++; continue }
    const start = i - 1 // last still sample
    let j = i, lastMove = i
    while (j < samples.length) {
      if (Math.abs(samples[j].v - samples[j - 1].v) > eps) lastMove = j
      else if (samples[j].t - samples[lastMove].t >= holdMs) break
      j++
    }
    const end = Math.min(lastMove + 1, samples.length - 1) // first still sample after
    const settled = j < samples.length
    const from = samples[start].v, to = samples[end].v
    if (Math.abs(to - from) >= minAmplitude || Math.max(...values.slice(start, end + 1).map((v) => Math.abs(v - from))) >= minAmplitude) {
      // one-frame steps bigger than 60% of the whole move with no motion either side are jumps, not motion
      const steps = []
      for (let k = start + 1; k <= end; k++) steps.push(Math.abs(samples[k].v - samples[k - 1].v))
      const jump = steps.length <= 2 && Math.abs(to - from) > 0
      segments.push({ start, end, from, to, settled, jump, tFrom: samples[start].t, tMoved: samples[start + 1].t, tEnd: samples[end].t, durationObserved: samples[end].t - samples[start].t })
    }
    i = Math.max(j, i + 1)
  }
  return segments
}

// ---------- shared ----------
const windowed = (samples, seg, padMs = 120) => samples.filter((s) => s.t >= seg.tFrom - padMs && s.t <= seg.tEnd + padMs)
function stats(rows, model, k) {
  let rss = 0, max = 0, mean = 0
  for (const r of rows) mean += r.v / rows.length
  let tss = 0
  for (const r of rows) { const e = model(r.t) - r.v; rss += e * e; max = Math.max(max, Math.abs(e)); tss += (r.v - mean) ** 2 }
  const n = rows.length
  return { n, k, rmse: Math.sqrt(rss / n), maxError: max, r2: 1 - rss / tss, bic: n * Math.log(Math.max(rss, 1e-12) / n) + k * Math.log(n) }
}

// ---------- spring fit ----------
/**
 * Fits x(t) = from for t < t0, damped oscillator from `from` (initial velocity v0) to `to` after.
 * Free: t0, w0 (rad/s), zeta, and v0 unless fixVelocity. from/to come from the holds.
 */
/** Huber loss (quadratic within `k` px, linear outside): one late frame from the page's own clock jitter can't pull the fit. */
const huber = (e, k) => { const a = Math.abs(e); return a <= k ? e * e : 2 * k * a - k * k }
export function fitSpring(samples, seg, { fixVelocity = false, padMs = 120, robust = 1 } = {}) {
  const rows = windowed(samples, seg, padMs)
  const { from, to } = seg
  const delta = to - from
  // rough frequency from the 50% crossing: for a mid-damped spring from rest, t50 ~ 1.7 / w0
  const half = rows.find((r) => Math.abs(r.v - from) >= Math.abs(delta) / 2)
  const t50 = Math.max(10, (half?.t ?? seg.tEnd) - seg.tFrom)
  const model = (p) => {
    const [t0, logW, logZ, vRel] = p
    const f = oscillator({ x0: from, x1: to, v0: fixVelocity ? 0 : vRel * delta, w0: Math.exp(logW), zeta: Math.exp(logZ) })
    return (t) => f((t - t0) / 1000)
  }
  const loss = (p) => { const m = model(p); let s = 0; for (const r of rows) { const e = m(r.t) - r.v; s += robust ? huber(e, robust) : e * e } return s }
  let best
  for (const zeta of [0.3, 0.6, 0.85, 1.0, 1.4]) for (const scale of [0.6, 1, 1.6]) for (const dt of [0, 8, 16]) {
    const start = [seg.tFrom + dt, Math.log((1.7 * scale) / (t50 / 1000)), Math.log(zeta), 0]
    const r = nelderMead(loss, start, { step: [6, 0.3, 0.2, 0.5] })
    if (!best || r.value < best.value) best = r
  }
  best = nelderMead(loss, best.x, { step: [1, 0.05, 0.05, 0.1], iterations: 4000 })
  const [t0, logW, logZ, vRel] = best.x
  const w0 = Math.exp(logW), zeta = Math.exp(logZ)
  const v0 = fixVelocity ? 0 : vRel * delta
  const time = physicsToTime({ stiffness: w0 * w0, damping: 2 * zeta * w0, mass: 1 })
  const overshoot = zeta < 1 ? Math.exp((-zeta * Math.PI) / Math.sqrt(1 - zeta * zeta)) : 0
  // 2% settling time from the fitted curve (numerical, includes velocity)
  const f = oscillator({ x0: from, x1: to, v0, w0, zeta })
  let settle = 0
  for (let t = 0; t < 10; t += 0.001) if (Math.abs(f(t) - to) > 0.02 * Math.abs(delta)) settle = t
  return {
    model: 'spring', t0, from, to, delta, v0,
    physics: { stiffness: w0 * w0, damping: 2 * zeta * w0, mass: 1, dampingRatio: zeta, undampedFreq: w0 },
    motion: { type: 'spring', duration: time.duration, bounce: time.bounce, visualDuration: time.visualDuration, velocity: v0 },
    overshootPercent: overshoot * 100, settle2PercentMs: settle * 1000,
    fit: stats(rows, model(best.x), fixVelocity ? 3 : 4),
    curve: model(best.x),
  }
}

// ---------- cubic-bezier ----------
export function cubicBezier(x1, y1, x2, y2) {
  const bx = (s) => 3 * x1 * s * (1 - s) ** 2 + 3 * x2 * s * s * (1 - s) + s ** 3
  const by = (s) => 3 * y1 * s * (1 - s) ** 2 + 3 * y2 * s * s * (1 - s) + s ** 3
  return (x) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let lo = 0, hi = 1, s = x
    for (let i = 0; i < 40; i++) { s = (lo + hi) / 2; if (bx(s) < x) lo = s; else hi = s }
    return by(s)
  }
}
const sigmoid = (z) => 1 / (1 + Math.exp(-z))
const logit = (p) => Math.log(p / (1 - p))

export function fitBezier(samples, seg, { padMs = 120 } = {}) {
  const rows = windowed(samples, seg, padMs)
  const { from, to } = seg
  const delta = to - from
  const model = (p) => {
    const [t0, logD, a, b, c, d] = p
    const ease = cubicBezier(sigmoid(a), b, sigmoid(c), d)
    const D = Math.exp(logD)
    return (t) => from + delta * ease((t - t0) / D)
  }
  const loss = (p) => { const m = model(p); let s = 0; for (const r of rows) { const e = m(r.t) - r.v; s += e * e } return s }
  let best
  const starts = [[0.25, 0.1, 0.25, 1], [0, 0, 0.58, 1], [0.2, 0.8, 0.2, 1], [0.3, 1.3, 0.3, 1], [0.34, 1.56, 0.64, 1], [0.42, 0, 0.58, 1]]
  for (const [x1, y1, x2, y2] of starts) for (const k of [0.7, 1]) {
    const start = [seg.tFrom, Math.log(Math.max(30, seg.durationObserved * k)), logit(Math.min(0.99, Math.max(0.01, x1))), y1, logit(Math.min(0.99, Math.max(0.01, x2))), y2]
    const r = nelderMead(loss, start, { step: [6, 0.2, 0.5, 0.2, 0.5, 0.2] })
    if (!best || r.value < best.value) best = r
  }
  best = nelderMead(loss, best.x, { step: [1, 0.05, 0.2, 0.05, 0.2, 0.05], iterations: 4000 })
  const [t0, logD, a, b, c, d] = best.x
  const points = [sigmoid(a), b, sigmoid(c), d].map((v) => Math.round(v * 1000) / 1000)
  return { model: 'cubic-bezier', t0, from, to, delta, duration: Math.exp(logD), points, css: `cubic-bezier(${points.join(', ')})`, fit: stats(rows, model(best.x), 6), curve: model(best.x) }
}

/** Fits both and picks by BIC; counts overshoot extrema since a bezier can bend past its end only once. */
export function fitSegment(samples, seg) {
  // Nested: from rest (Motion 14 duration springs, CSS-like) vs with initial velocity (interrupted or physics springs).
  const rest = fitSpring(samples, seg, { fixVelocity: true })
  const moving = fitSpring(samples, seg)
  const spring = moving.fit.bic < rest.fit.bic - 6 ? moving : rest
  const bezier = fitBezier(samples, seg)
  const rows = windowed(samples, seg, 0)
  let extrema = 0
  for (let i = 1; i < rows.length - 1; i++) {
    const a = rows[i].v - rows[i - 1].v, b = rows[i + 1].v - rows[i].v
    if (a * b < 0 && Math.abs(rows[i].v - seg.to) > 0.05) extrema++
  }
  const dBIC = bezier.fit.bic - spring.fit.bic
  const choice = Math.abs(dBIC) < 6 ? (extrema > 0 ? 'spring' : 'either') : dBIC > 0 ? 'spring' : 'cubic-bezier'
  return { choice, deltaBIC: dBIC, extrema, spring, bezier }
}

export const describe = (r) => ({
  choice: r.choice, deltaBIC: +r.deltaBIC.toFixed(1), extrema: r.extrema,
  spring: { motion: { duration: +r.spring.motion.duration.toFixed(4), bounce: +r.spring.motion.bounce.toFixed(4), visualDuration: +r.spring.motion.visualDuration.toFixed(4), velocity: +r.spring.v0.toFixed(1) }, physics: Object.fromEntries(Object.entries(r.spring.physics).map(([k, v]) => [k, +v.toFixed(3)])), overshootPercent: +r.spring.overshootPercent.toFixed(3), settle2PercentMs: Math.round(r.spring.settle2PercentMs), fit: { rmse: +r.spring.fit.rmse.toFixed(3), maxError: +r.spring.fit.maxError.toFixed(3), r2: +r.spring.fit.r2.toFixed(6), bic: +r.spring.fit.bic.toFixed(1), n: r.spring.fit.n } },
  bezier: { css: r.bezier.css, duration: Math.round(r.bezier.duration), fit: { rmse: +r.bezier.fit.rmse.toFixed(3), maxError: +r.bezier.fit.maxError.toFixed(3), r2: +r.bezier.fit.r2.toFixed(6), bic: +r.bezier.fit.bic.toFixed(1) } },
})
