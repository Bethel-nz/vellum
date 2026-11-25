// clock-vclock.mjs - the virtual page clock under test (MAIN world, self-contained function).
// Proves nothing alone; every clock-*.mjs experiment injects installVirtualClock via clockSource.
// virtual = anchorV + (real - anchorR) * rate, clamped monotonic; pause = frozen anchor; step = anchor += 16.67 ms.
// Patches performance.now, Date.now / new Date(), Event#timeStamp, rAF/cAF, setTimeout/setInterval/clear*,
// scales document.getAnimations() playbackRate (waapi), translates Animation#startTime writes (translateStartTime).
// uninstall() restores natives (clear* stay pass-through until takeover-era ids end); release() = 1x, then
// uninstall when the scope element is quiet. In the extension this would ship as packaged code run with
// chrome.scripting.executeScript({ world: 'MAIN', func: installVirtualClock, args: [options] }).

export function installVirtualClock(options) {
  const KEY = (options && options.key) || '__vclock'
  if (window[KEY]) return 'already'
  const P = Performance.prototype
  const nativeNow = P.now
  const realNow = () => nativeNow.call(performance)
  const NativeDate = Date
  const nativeDateNow = NativeDate.now
  const native = {
    raf: window.requestAnimationFrame, caf: window.cancelAnimationFrame,
    st: window.setTimeout, ct: window.clearTimeout, si: window.setInterval, ci: window.clearInterval,
  }
  const evDesc = Object.getOwnPropertyDescriptor(Event.prototype, 'timeStamp')
  const tlDesc = Object.getOwnPropertyDescriptor(AnimationTimeline.prototype, 'currentTime')
  const waStartDesc = Object.getOwnPropertyDescriptor(Animation.prototype, 'startTime')
  const rafCall = (cb) => native.raf.call(window, cb)
  const stCall = (fn, ms) => native.st.call(window, fn, ms)
  const ctCall = (id) => native.ct.call(window, id)

  let active = true
  let rate = 1, paused = false
  let anchorR = realNow(), anchorV = anchorR, lastV = anchorR
  const epoch = nativeDateNow() - anchorR // virtual Date.now = epoch + virtual perf time
  const toVirtual = (r) => paused ? anchorV : anchorV + (r - anchorR) * rate
  const vnow = () => { const v = toVirtual(realNow()); if (v > lastV) lastV = v; return lastV }
  const reanchor = () => { anchorV = vnow(); anchorR = realNow() }

  // --- time reads
  const now = function now() { return active ? vnow() : realNow() }
  performance.now = now
  const dateNow = function now() { return active ? Math.floor(epoch + vnow()) : nativeDateNow() }
  NativeDate.now = dateNow
  const DateProxy = new Proxy(NativeDate, {
    construct(t, args, nt) { return Reflect.construct(t, args.length || !active ? args : [dateNow()], nt) },
    apply(t, self, args) { return active ? new t(dateNow()).toString() : t() },
  })
  window.Date = DateProxy
  Object.defineProperty(Event.prototype, 'timeStamp', { configurable: true, enumerable: evDesc.enumerable,
    get() { const r = evDesc.get.call(this); return active ? toVirtual(r) : r } })

  // --- rAF: every callback of one real frame gets the same virtual timestamp
  let rafSeq = 0; const rafMap = new Map()
  const raf = function requestAnimationFrame(cb) {
    if (!active) return native.raf.call(window, cb)
    const id = ++rafSeq + 0x40000000
    rafMap.set(id, rafCall((ts) => { rafMap.delete(id); const v = Math.max(lastV, toVirtual(ts)); lastV = v; cb(v) }))
    return id
  }
  const caf = function cancelAnimationFrame(id) {
    if (rafMap.has(id)) { native.caf.call(window, rafMap.get(id)); rafMap.delete(id) } else native.caf.call(window, id)
  }
  window.requestAnimationFrame = raf; window.cancelAnimationFrame = caf

  // --- timers on a virtual heap, one real wake-up for the earliest due timer
  let timerSeq = 0x50000000; const timers = new Map(); let wake = null
  const schedule = () => {
    if (wake !== null) { ctCall(wake); wake = null }
    if (!timers.size) return
    let due = Infinity; for (const t of timers.values()) if (t.due < due) due = t.due
    const v = vnow()
    if (due <= v) { wake = stCall(run, 0); return }
    if (paused || rate === 0) return // waits for step/resume
    wake = stCall(run, Math.max(0, (due - v) / rate))
  }
  const run = () => {
    wake = null
    const v = vnow()
    const ready = [...timers.values()].filter((t) => t.due <= v).sort((a, b) => a.due - b.due || a.id - b.id)
    for (const t of ready) {
      if (!timers.has(t.id)) continue
      if (t.interval) t.due = Math.max(t.due + t.delay, v) ; else timers.delete(t.id)
      try { t.fn.apply(window, t.args) } catch (e) { stCall(() => { throw e }, 0) }
    }
    schedule()
  }
  const make = (interval) => function (fn, delay, ...args) {
    if (!active || typeof fn !== 'function') return (interval ? native.si : native.st).call(window, fn, delay, ...args)
    const d = Math.max(0, Number(delay) || 0)
    const id = ++timerSeq
    timers.set(id, { id, fn, args, delay: interval ? Math.max(d, 1) : d, due: vnow() + d, interval })
    schedule(); return id
  }
  const clear = function (id) { if (timers.delete(id)) schedule(); else native.ct.call(window, id) }
  const st = make(false), si = make(true)
  Object.defineProperty(st, 'name', { value: 'setTimeout' }); Object.defineProperty(si, 'name', { value: 'setInterval' })
  window.setTimeout = st; window.setInterval = si; window.clearTimeout = clear; window.clearInterval = clear

  // --- WAAPI / CSS animations: scale each animation's own rate by ours
  const base = new Map() // Animation -> page's own playbackRate
  const syncAnimations = () => {
    const eff = paused ? 0 : rate
    for (const a of document.getAnimations()) {
      if (!base.has(a)) base.set(a, a.playbackRate)
      const want = base.get(a) * eff
      if (a.playbackRate !== want) a.playbackRate = want
    }
  }
  const pump = () => { if (!active || !options?.waapi) return; syncAnimations(); rafCall(pump) }
  if (options && options.waapi) rafCall(pump)
  // Libraries (Motion's NativeAnimation) write animation.startTime = performance.now()-based
  // values. Those are virtual now, but document.timeline is real, so translate: the page means
  // "local time is (vnow - v) * its rate", which is what currentTime expresses on any rate.
  if (options && options.translateStartTime) {
    Object.defineProperty(Animation.prototype, 'startTime', { configurable: true, enumerable: waStartDesc.enumerable,
      get() { const r = waStartDesc.get.call(this); if (!active || r === null || !base.has(this) || !base.get(this)) return r; return vnow() - Number(this.currentTime) / base.get(this) },
      set(v) {
        if (!active || v === null || !(this.timeline === document.timeline)) return waStartDesc.set.call(this, v)
        if (!base.has(this)) base.set(this, this.playbackRate)
        const b = base.get(this); this.playbackRate = b * (paused ? 0 : rate)
        if (this.playState !== 'running') this.play()
        this.currentTime = (vnow() - v) * b
      } })
  }

  const api = {
    get rate() { return paused ? 0 : rate }, get paused() { return paused }, now: vnow, realNow,
    lag: () => realNow() - vnow(), pendingTimers: () => timers.size,
    setRate(r) { reanchor(); rate = r; paused = false; if (options?.waapi) syncAnimations(); schedule() },
    pause() { reanchor(); paused = true; if (options?.waapi) syncAnimations(); schedule() },
    resume() { reanchor(); paused = false; if (options?.waapi) syncAnimations(); schedule() },
    step(ms = 1000 / 60) {
      if (!paused) { reanchor(); paused = true }
      anchorV += ms; lastV = Math.max(lastV, anchorV)
      if (options?.waapi) for (const a of document.getAnimations()) { if (!base.has(a)) base.set(a, a.playbackRate); a.playbackRate = 0; if (a.currentTime !== null) a.currentTime = Number(a.currentTime) + ms * base.get(a) }
      schedule()
    },
    // Recommended restore: back to 1x at once (no jump), then uninstall when the scope has gone
    // quiet (no style/class writes for quietMs), so the forward jump lands while nothing moves.
    release({ scope, quietMs = 250, maxWaitMs = 8000 } = {}) {
      const el = (typeof scope === 'string' ? document.querySelector(scope) : scope) || document.documentElement
      api.setRate(1)
      return new Promise((resolve) => {
        const t0 = realNow(); let last = t0
        const mo = new MutationObserver(() => { last = realNow() })
        mo.observe(el, { attributes: true, subtree: true, attributeFilter: ['style', 'class'] })
        const check = () => {
          const n = realNow()
          if (n - last < quietMs && n - t0 < maxWaitMs) return rafCall(check)
          mo.disconnect()
          resolve({ ...api.uninstall(), waited: Math.round(n - t0), forced: n - last < quietMs })
        }
        rafCall(check)
      })
    },
    // Hand the real clock back. Timers still pending move to native timers with their
    // remaining virtual delay. jump = how far performance.now moves forward at that instant.
    uninstall() {
      const v = vnow(), jump = realNow() - v
      active = false
      delete performance.now
      NativeDate.now = nativeDateNow
      window.Date = NativeDate
      Object.defineProperty(Event.prototype, 'timeStamp', evDesc)
      window.requestAnimationFrame = native.raf; window.cancelAnimationFrame = native.caf
      if (wake !== null) ctCall(wake)
      const moved = new Map(), movedKinds = []
      const settle = () => { if (!moved.size && window.clearTimeout === passClear) { window.clearTimeout = native.ct; window.clearInterval = native.ci } }
      for (const t of timers.values()) {
        const remaining = Math.max(0, t.due - v)
        movedKinds.push(`${t.interval ? 'interval' : 'timeout'} ${Math.round(t.delay)}ms, next in ${Math.round(remaining)}ms`)
        if (t.interval) moved.set(t.id, stCall(function first() { const nid = native.si.call(window, t.fn, t.delay, ...t.args); moved.set(t.id, nid); t.fn.apply(window, t.args) }, remaining))
        else moved.set(t.id, stCall(() => { moved.delete(t.id); settle(); t.fn.apply(window, t.args) }, remaining))
      }
      timers.clear()
      // Ids handed out during the takeover keep working through a pass-through clear
      // until the last one ends; with none outstanding the native functions come back.
      function passClear(id) { if (moved.has(id)) { ctCall(moved.get(id)); native.ci.call(window, moved.get(id)); moved.delete(id); if (!moved.size) { window.clearTimeout = native.ct; window.clearInterval = native.ci } } else native.ct.call(window, id) }
      window.setTimeout = native.st; window.setInterval = native.si
      if (moved.size) { window.clearTimeout = passClear; window.clearInterval = passClear } else { window.clearTimeout = native.ct; window.clearInterval = native.ci }
      if (options && options.translateStartTime) Object.defineProperty(Animation.prototype, 'startTime', waStartDesc)
      for (const [a, r] of base) { try { a.playbackRate = r } catch {} }
      base.clear()
      delete window[KEY]
      return { jump: Math.round(jump), movedTimers: moved.size, movedKinds }
    },
  }
  Object.defineProperty(window, KEY, { value: api, configurable: true })
  return 'installed'
}

export const clockSource = installVirtualClock.toString()
