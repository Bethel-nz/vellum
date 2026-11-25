/**
 * EXPERIMENTAL. Live editing of Motion (framer-motion / motion) transitions and GSAP tweens on the page's
 * own elements. Neither library offers a public API for this: it relies on Motion's internal
 * VisualElement and React's fiber fields, and on GSAP's private `_ease`, which a release of either could
 * rename or remove. Anything it doesn't recognise is reported as not found, never guessed at.
 *
 * `pageMotion` runs in the page's JavaScript world (`chrome.scripting.executeScript({ world: 'MAIN' })`),
 * where React's `__reactFiber$…` expandos and Motion's objects are visible; Snapshot's content script
 * runs in Chrome's isolated world and can't see them. Chrome sends the function to the page as source
 * text, so it must not use anything from module scope: no imports, no helpers outside its body.
 *
 * Path, measured on a production React 19 + Motion 14 site (research_notes/Previewing JavaScript
 * animation edits/scripts/library-flora-motion-fiber.mjs):
 * - DOM node → `__reactFiber$<random>` → `.return` to the MotionContext.Provider whose
 *   `value.visualElement.current` is the node (fallback: a useRef holding it in the hooks of the fiber
 *   whose type carries `Symbol.for('motionComponentSymbol')`). Same shape in framer-motion 11 → 14.
 * - An edit shadows `getDefaultTransition` on that VisualElement instance. Motion reads it at every
 *   animation start, and React re-renders replace `props` without touching the instance, so the edit
 *   holds until `delete` puts the prototype method back.
 * - Replay jumps each moved value back to where its last move started, forgets the resolved target and
 *   lets Motion's own `animationState.animateChanges()` run the move again.
 *
 * GSAP, when no Motion element is found (research_notes/…/scripts/library-gsap-swiper.mjs):
 * - `window.gsap` is installed even from bundled builds; `gsap.getTweensOf(node)` returns live tweens.
 * - An edit sets the tween's `duration()` and its parsed ease (`_ease`, no `invalidate()`, so start values
 *   aren't re-recorded), and while any edit is on, `gsap.to/from/fromTo` are wrapped so tweens the site
 *   creates later on the same targets (a hover, a click) get it too. Revert restores each tween and
 *   unwraps the methods.
 * - Replay restarts the tween, or the top-level timeline it belongs to. Scroll-driven ones can't replay.
 *
 * Results are page-controlled data: the caller treats them as display values only.
 */

export type MotionForm = 'duration' | 'visualDuration' | 'physics' | 'tween' | 'gsap'
export type MotionValue = number | number[] | string
export type MotionEdit = { form: MotionForm; values: Record<string, MotionValue> }
export type PageMotionAction = 'read' | 'edit' | 'replay' | 'reset' | 'revert' | 'revert-all'
export type PageMotionInfo =
  | { found: false; reason: 'gone' | 'no-react' | 'no-motion' | 'error'; message?: string }
  | {
    found: true
    library: 'motion' | 'gsap'
    /** GSAP only: the tween sits in a timeline, or a ScrollTrigger drives it. */
    context?: 'timeline' | 'scroll'
    /** The element that's animated, e.g. `div.absolute`, and where it sits relative to the selection. */
    owner: string; relation: 'self' | 'parent' | 'ancestor' | 'child'
    key: string; keys: string[]
    /** `default`: no transition in the source; Motion's built-in one is shown. `inline`: set in `animate` or a variant. */
    source: 'transition' | 'per-value' | 'default' | 'inline'
    form: MotionForm | 'other'; editable: boolean
    /** The transition as written in the source (or Motion's default), JSON-safe. */
    original: Record<string, unknown> | null
    /** The dials' starting values, in the source's own form. */
    values: Record<string, MotionValue>
    edited: boolean; moved: boolean; replayed?: boolean
  }

export function pageMotion(ref: string, action: PageMotionAction, edit: MotionEdit | null): PageMotionInfo {
  type Relation = 'self' | 'parent' | 'ancestor' | 'child'
  type Entry = {
    kind: 'motion'; ve: any; node: Element; relation: Relation
    original: () => unknown; own?: PropertyDescriptor; edit: Record<string, unknown> | null
    path: string | null; from: Record<string, number | string>; stop: Array<() => void>
  }
  /** `saved` holds each tween's own duration and ease, for every tween an edit has touched. */
  type GsapEntry = {
    kind: 'gsap'; node: Element; relation: Relation; tween: any; targets: Set<unknown>
    edit: { duration: number; ease: string } | null; saved: Map<any, { duration: number; ease: unknown; hadEase: boolean; parsed: unknown }>
  }
  type AnyEntry = Entry | GsapEntry
  const w = window as any
  // `owners` outlives a revert: React may replace the selected element (a carousel recycling its slides)
  // while the element Motion animates stays, so a lifted edit can still be put back on reopen.
  const store: { entries: Map<string, AnyEntry>; owners: Map<string, { node: Element; relation: Relation }>; gsapWrapped?: Record<string, unknown> } = w[Symbol.for('vellum.snapshot.motion')] ??= { entries: new Map(), owners: new Map() }
  // EXPERIMENTAL: everything from here to `info()` reads React and Motion internals (fiber `return`,
  // `memoizedProps`, `memoizedState`, VisualElement `getDefaultTransition`/`animationState`/`latestValues`).
  // They have held from framer-motion 11 to Motion 14, but none of them are public API.
  const MOTION = Symbol.for('motionComponentSymbol')
  const fiberOf = (node: Element): any => { for (const key of Object.keys(node)) if (key.startsWith('__reactFiber$')) return (node as any)[key]; return null }
  const isVE = (value: any) => Boolean(value && typeof value === 'object' && typeof value.getDefaultTransition === 'function' && typeof value.getValue === 'function' && 'latestValues' in value && value.animationState)
  let sawReact = false
  function veFor(node: Element) {
    let fiber = fiberOf(node)
    if (fiber) sawReact = true
    for (let depth = 0; fiber && depth < 25; fiber = fiber.return, depth++) {
      const value = fiber.memoizedProps?.value?.visualElement
      if (isVE(value) && value.current === node) return value
      if (fiber.elementType?.[MOTION]) {
        for (let hook = fiber.memoizedState, index = 0; hook && index < 60; hook = hook.next, index++) {
          const held = hook.memoizedState?.current
          if (isVE(held) && held.current === node) return held
        }
        return null
      }
    }
    return null
  }
  function locate(start: Element): { ve: any; node: Element; relation: Relation } | null {
    // Clicking into a card usually selects text or an image well inside the element that moves, so the
    // search climbs; above the selection only a Motion element that animates something counts.
    let node: Element | null = start
    for (let hops = 0; node && hops < 12; node = node.parentElement, hops++) {
      const ve = veFor(node)
      if (ve && (hops === 0 || keysOf(ve).length)) return { ve, node, relation: hops === 0 ? 'self' : hops === 1 ? 'parent' : 'ancestor' }
    }
    const walker = document.createTreeWalker(start, NodeFilter.SHOW_ELEMENT)
    for (let next = walker.nextNode(), count = 0; next && count < 1500; next = walker.nextNode(), count++) {
      const ve = veFor(next as Element)
      if (ve) return { ve, node: next as Element, relation: 'child' }
    }
    return null
  }
  function plain(value: unknown, depth = 0): unknown {
    if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
    if (typeof value === 'string') return value.slice(0, 200)
    if (typeof value === 'function') return '[function]'
    if (depth > 3 || typeof value !== 'object') return undefined
    if (Array.isArray(value)) return value.slice(0, 8).map((item) => plain(item, depth + 1))
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).slice(0, 24)) { const item = plain((value as any)[key], depth + 1); if (item !== undefined) out[key] = item }
    return out
  }
  function describe(node: Element) {
    const classes = typeof node.className === 'string' ? node.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : []
    return node.tagName.toLowerCase() + (node.id ? `#${node.id}` : '') + classes.map((name) => `.${name}`).join('')
  }
  function teardown(entry: AnyEntry) {
    if (entry.kind === 'gsap') { gsapRestore(entry); return }
    for (const stop of entry.stop) { try { stop() } catch { /* The value may be gone. */ } }
    if (entry.own) Object.defineProperty(entry.ve, 'getDefaultTransition', entry.own)
    else delete entry.ve.getDefaultTransition
  }

  // ---- GSAP
  const gsap = w.gsap && typeof w.gsap.getTweensOf === 'function' ? w.gsap : null
  const CONTROL = /^(duration|ease|delay|repeat|repeatDelay|yoyo|yoyoEase|stagger|paused|overwrite|immediateRender|lazy|id|data|callbackScope|inherit|runBackwards|startAt|keyframes|reversed|defaults|scrollTrigger|onComplete.*|onStart.*|onUpdate.*|onRepeat.*|onReverseComplete.*|onInterrupt.*|callbackScope|parent)$/
  function liveTweens(node: Element): any[] {
    try { return (gsap.getTweensOf(node) as any[]).filter((tween) => typeof tween.duration === 'function' && tween.duration() > 0) } catch { return [] }
  }
  // The tween to edit: a running one, else one that repeats, else the latest.
  const chooseTween = (tweens: any[]) => tweens.find((tween) => tween.isActive?.()) ?? tweens.find((tween) => tween.repeat?.() !== 0) ?? tweens.at(-1)
  function gsapLocate(start: Element): { tween: any; node: Element; relation: Relation } | null {
    if (!gsap) return null
    let node: Element | null = start
    for (let hops = 0; node && hops < 12; node = node.parentElement, hops++) {
      const tweens = liveTweens(node)
      if (tweens.length) return { tween: chooseTween(tweens), node, relation: hops === 0 ? 'self' : hops === 1 ? 'parent' : 'ancestor' }
    }
    const walker = document.createTreeWalker(start, NodeFilter.SHOW_ELEMENT)
    for (let next = walker.nextNode(), count = 0; next && count < 1500; next = walker.nextNode(), count++) {
      const tweens = liveTweens(next as Element)
      if (tweens.length) return { tween: chooseTween(tweens), node: next as Element, relation: 'child' }
    }
    return null
  }
  const easeName = (tween: any) => {
    const ease = tween.vars?.ease ?? tween.parent?.vars?.defaults?.ease
    if (typeof ease === 'string') return ease
    if (ease === undefined) { const fallback = gsap?.defaults?.().ease; return typeof fallback === 'string' ? fallback : 'power1.out' }
    return 'custom'
  }
  const scrollDriven = (tween: any) => { for (let item = tween; item && item !== gsap.globalTimeline; item = item.parent) if (item.scrollTrigger || item.vars?.scrollTrigger) return true; return false }
  // EXPERIMENTAL: `_ease` is GSAP's private parsed ease. Setting it changes the curve without
  // `invalidate()`, which would re-record start values and make a running tween jump.
  function gsapEdit(entry: GsapEntry, tween: any) {
    if (!entry.edit) return
    if (!entry.saved.has(tween)) entry.saved.set(tween, { duration: tween.duration(), ease: tween.vars?.ease, hadEase: Object.hasOwn(tween.vars ?? {}, 'ease'), parsed: tween._ease })
    tween.duration(entry.edit.duration)
    if (entry.edit.ease !== 'custom') {
      const parsed = gsap.parseEase?.(entry.edit.ease)
      if (typeof parsed === 'function') { tween.vars.ease = entry.edit.ease; if ('_ease' in tween) tween._ease = parsed }
    }
  }
  function gsapRestore(entry: GsapEntry) {
    for (const [tween, saved] of entry.saved) {
      try {
        tween.duration(saved.duration)
        if (saved.hadEase) tween.vars.ease = saved.ease; else delete tween.vars.ease
        // A tween edited before its first frame had no parsed ease yet: rebuild it from its own settings
        // rather than leave a running tween without one.
        if ('_ease' in tween) {
          const own = tween.vars.ease ?? tween.parent?.vars?.defaults?.ease ?? gsap.defaults?.().ease ?? 'power1.out'
          tween._ease = typeof saved.parsed === 'function' ? saved.parsed : typeof own === 'function' ? own : gsap.parseEase(own)
        }
      } catch { /* The tween may have been killed. */ }
    }
    entry.saved.clear()
  }
  // While any GSAP edit is on, tweens the page creates later on an edited element's targets get it too.
  function gsapWrap() {
    const editing = [...store.entries.values()].some((entry) => entry.kind === 'gsap' && entry.edit)
    if (editing && !store.gsapWrapped) {
      const originals: Record<string, unknown> = {}
      for (const name of ['to', 'from', 'fromTo']) {
        const original = gsap[name]
        if (typeof original !== 'function') continue
        originals[name] = original
        gsap[name] = function (this: unknown, ...args: unknown[]) {
          const tween = original.apply(this, args)
          try {
            const targets = typeof tween?.targets === 'function' ? tween.targets() : []
            for (const entry of (w[Symbol.for('vellum.snapshot.motion')]?.entries ?? new Map()).values()) {
              if (entry.kind !== 'gsap' || !entry.edit || !targets.some((target: unknown) => entry.targets.has(target))) continue
              entry.tween = tween
              if (!entry.saved.has(tween)) entry.saved.set(tween, { duration: tween.duration(), ease: tween.vars?.ease, hadEase: Object.hasOwn(tween.vars ?? {}, 'ease'), parsed: tween._ease })
              tween.duration(entry.edit.duration)
              if (entry.edit.ease !== 'custom') { const parsed = w.gsap.parseEase?.(entry.edit.ease); if (typeof parsed === 'function') { tween.vars.ease = entry.edit.ease; if ('_ease' in tween) tween._ease = parsed } }
            }
          } catch { /* The page's tween is returned untouched. */ }
          return tween
        }
      }
      store.gsapWrapped = originals
    } else if (!editing && store.gsapWrapped) {
      for (const [name, original] of Object.entries(store.gsapWrapped)) gsap[name] = original
      store.gsapWrapped = undefined
    }
  }
  function gsapInfo(entry: GsapEntry, extra?: { replayed?: boolean }): PageMotionInfo {
    const tween = entry.tween
    const saved = entry.saved.get(tween)
    const duration = Math.round((saved ? saved.duration : tween.duration()) * 1000) / 1000
    const ease = saved ? (typeof saved.ease === 'string' ? saved.ease : saved.ease === undefined ? easeName({ vars: {}, parent: tween.parent }) : 'custom') : easeName(tween)
    const keys = Object.keys(tween.vars ?? {}).filter((key) => !CONTROL.test(key) && !key.startsWith('on')).slice(0, 8)
    const context = scrollDriven(tween) ? 'scroll' : tween.parent && tween.parent !== gsap.globalTimeline ? 'timeline' : undefined
    return {
      found: true, library: 'gsap', ...(context ? { context } : {}), owner: describe(entry.node), relation: entry.relation,
      key: keys[0] ?? '', keys, source: 'transition', form: 'gsap', editable: true,
      original: { duration, ease }, values: entry.edit ? { ...entry.edit } : { duration, ease },
      edited: Boolean(entry.edit), moved: true, ...extra,
    }
  }
  function gsapReplay(entry: GsapEntry): boolean {
    const tween = entry.tween
    if (scrollDriven(tween)) return false
    let top = tween
    while (top.parent && top.parent !== gsap.globalTimeline) top = top.parent
    top.restart()
    return true
  }
  function keysOf(ve: any): string[] {
    const keys = new Set<string>()
    const animate = ve.props?.animate
    if (animate && typeof animate === 'object' && !Array.isArray(animate)) for (const key of Object.keys(animate)) if (key !== 'transition' && key !== 'transitionEnd') keys.add(key)
    const resolved = ve.animationState?.getState?.().animate?.prevResolvedValues
    if (resolved) for (const key of Object.keys(resolved)) keys.add(key)
    return [...keys].filter((key) => ve.latestValues?.[key] !== undefined).slice(0, 12)
  }
  function entryFor(create: boolean): AnyEntry | null {
    let current = store.entries.get(ref)
    if (current && (!current.node.isConnected || (current.kind === 'motion' && current.ve.current !== current.node))) { teardown(current); store.entries.delete(ref); current = undefined }
    if (current || !create) return current ?? null
    const element = document.querySelector(`[data-vellum-ref="${CSS.escape(ref)}"]`)
    const owner = store.owners.get(ref)
    const kept = owner?.node.isConnected ? veFor(owner.node) : null
    const found = element ? locate(element) : kept && owner ? { ve: kept, node: owner.node, relation: owner.relation } : null
    if (!found) {
      const keptTweens = !element && owner?.node.isConnected ? liveTweensOrNone(owner.node) : []
      const tweened = element ? gsapLocate(element) : keptTweens.length && owner ? { tween: chooseTween(keptTweens), node: owner.node, relation: owner.relation } : null
      if (!tweened) return null
      store.owners.set(ref, { node: tweened.node, relation: tweened.relation })
      const created: GsapEntry = { kind: 'gsap', ...tweened, targets: new Set(tweened.tween.targets?.() ?? [tweened.node]), edit: null, saved: new Map() }
      store.entries.set(ref, created)
      return created
    }
    store.owners.set(ref, { node: found.node, relation: found.relation })
    const ve = found.ve
    const entry: Entry = { kind: 'motion', ...found, original: ve.getDefaultTransition, own: Object.getOwnPropertyDescriptor(ve, 'getDefaultTransition'), edit: null, path: null, from: {}, stop: [] }
    for (const key of keysOf(ve)) {
      const value = ve.getValue(key, ve.latestValues[key])
      if (!value?.on) continue
      const target = entry
      target.stop.push(value.on('animationStart', () => { const at = value.get(); if (typeof at === 'number' || typeof at === 'string') target.from[key] = at }))
    }
    store.entries.set(ref, entry)
    return entry
  }
  const liveTweensOrNone = (node: Element) => gsap ? liveTweens(node) : []
  // The transition that applies to `key`, the way Motion's getValueTransition picks it.
  function pick(base: any, key: string): { transition: any; path: string | null } {
    if (base && typeof base === 'object' && base[key] && typeof base[key] === 'object') return { transition: base[key], path: key }
    if (base && typeof base === 'object' && base.default && typeof base.default === 'object') return { transition: base.default, path: 'default' }
    return { transition: base ?? null, path: null }
  }
  const BEZIERS: Record<string, number[]> = { linear: [0, 0, 1, 1], easeIn: [.42, 0, 1, 1], easeOut: [0, 0, .58, 1], easeInOut: [.42, 0, .58, 1] }
  function formOf(transition: any, key: string): { form: MotionForm | 'other'; values: Record<string, number | number[]>; fallback?: Record<string, unknown> } {
    if (!transition) {
      // Motion's own defaults when the source sets no transition (motion-dom default-transitions).
      if (/^(x|y|z|rotate[XYZ]?|translate[XYZ]?)$/.test(key)) return { form: 'physics', values: { stiffness: 500, damping: 25, mass: 1 }, fallback: { type: 'spring', stiffness: 500, damping: 25, restSpeed: 10 } }
      if (/^scale[XY]?$/.test(key)) return { form: 'physics', values: { stiffness: 550, damping: 46.9, mass: 1 }, fallback: { type: 'spring', stiffness: 550, damping: 46.9, restSpeed: 10 } }
      return { form: 'tween', values: { duration: .3, ease: [.25, .1, .35, 1] }, fallback: { type: 'keyframes', duration: .3, ease: [.25, .1, .35, 1] } }
    }
    const num = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback
    const springy = transition.type === 'spring' || (transition.type === undefined && ['stiffness', 'damping', 'mass', 'bounce', 'visualDuration'].some((name) => transition[name] !== undefined))
    if (springy) {
      if (transition.visualDuration !== undefined) return { form: 'visualDuration', values: { visualDuration: num(transition.visualDuration, .3), bounce: num(transition.bounce, .3) } }
      if (transition.stiffness !== undefined || transition.damping !== undefined || transition.mass !== undefined) return { form: 'physics', values: { stiffness: num(transition.stiffness, 100), damping: num(transition.damping, 10), mass: num(transition.mass, 1) } }
      return { form: 'duration', values: { duration: num(transition.duration, .8), bounce: num(transition.bounce, .3) } }
    }
    if (transition.type === undefined || transition.type === 'tween' || transition.type === 'keyframes') {
      if (transition.times || Array.isArray(transition.ease?.[0])) return { form: 'other', values: {} }
      const ease = Array.isArray(transition.ease) && transition.ease.length === 4 && transition.ease.every((n: unknown) => typeof n === 'number') ? transition.ease : BEZIERS[transition.ease ?? 'easeOut']
      if (!ease) return { form: 'other', values: {} }
      return { form: 'tween', values: { duration: num(transition.duration, .3), ease } }
    }
    return { form: 'other', values: {} }
  }
  function inline(ve: any) {
    const animate = ve.props?.animate
    if (animate && typeof animate === 'object' && !Array.isArray(animate) && animate.transition) return true
    const names = typeof animate === 'string' ? [animate] : Array.isArray(animate) ? animate : []
    return names.some((name: unknown) => typeof name === 'string' && ve.props?.variants?.[name]?.transition)
  }
  function info(entry: Entry, extra?: { replayed?: boolean }): PageMotionInfo {
    const keys = keysOf(entry.ve)
    const key = keys.find((name) => entry.from[name] !== undefined) ?? keys[0] ?? 'x'
    const base = entry.original.call(entry.ve)
    const picked = pick(base, key)
    const shape = formOf(picked.transition, key)
    const source = inline(entry.ve) ? 'inline' : !picked.transition ? 'default' : picked.path ? 'per-value' : 'transition'
    entry.path = picked.path
    return {
      found: true, library: 'motion', owner: describe(entry.node), relation: entry.relation, key, keys, source,
      form: shape.form, editable: source !== 'inline' && shape.form !== 'other',
      original: (plain(picked.transition ?? shape.fallback ?? null) as Record<string, unknown> | null),
      values: shape.values, edited: Boolean(entry.edit), moved: Object.keys(entry.from).length > 0, ...extra,
    }
  }
  function apply(entry: Entry) {
    if (!entry.edit) { teardown({ ...entry, stop: [] }); return }
    const original = entry.original
    const state = entry
    Object.defineProperty(entry.ve, 'getDefaultTransition', {
      configurable: true, writable: true,
      value: function (this: unknown) {
        const base: any = original.call(this)
        const patch = state.edit
        if (!patch) return base
        if (state.path) return { ...base, [state.path]: { ...base?.[state.path], ...patch } }
        return base && typeof base === 'object' ? { ...base, ...patch } : { ...patch }
      },
    })
  }
  try {
    if (action === 'revert-all') {
      for (const entry of store.entries.values()) teardown(entry)
      store.entries.clear()
      if (gsap) gsapWrap()
      return { found: false, reason: 'gone' }
    }
    if (action === 'revert' || action === 'reset') {
      const entry = store.entries.get(ref)
      if (entry) { teardown(entry); store.entries.delete(ref) }
      if (gsap) gsapWrap()
      if (action === 'revert') { store.owners.delete(ref); return { found: false, reason: 'gone' } }
    }
    const found = entryFor(true)
    if (!found) return { found: false, reason: document.querySelector(`[data-vellum-ref="${CSS.escape(ref)}"]`) ? sawReact || gsap ? 'no-motion' : 'no-react' : 'gone' }
    if (found.kind === 'gsap') {
      if (action === 'edit' && edit?.form === 'gsap' && typeof edit.values.duration === 'number' && typeof edit.values.ease === 'string') {
        found.edit = { duration: edit.values.duration, ease: edit.values.ease }
        gsapEdit(found, found.tween)
        gsapWrap()
      }
      if (action === 'replay') return gsapInfo(found, { replayed: gsapReplay(found) })
      return gsapInfo(found)
    }
    const entry = found
    if (action === 'edit' && edit) {
      const current = info(entry)
      if (!current.found || !current.editable || current.form !== edit.form) return current
      const values = edit.values
      if (edit.form === 'gsap') return current
      const patch: Record<string, unknown> =
        edit.form === 'duration' ? { type: 'spring', duration: values.duration, bounce: values.bounce }
          : edit.form === 'visualDuration' ? { type: 'spring', visualDuration: values.visualDuration, bounce: values.bounce }
            : edit.form === 'physics' ? { type: 'spring', stiffness: values.stiffness, damping: values.damping, mass: values.mass }
              : { type: 'tween', duration: values.duration, ...(values.ease ? { ease: values.ease } : {}) }
      // Motion's built-in transition only exists inside Motion, so a default edit replaces it whole.
      entry.edit = current.source === 'default' ? { ...(current.original ?? {}), ...patch } : patch
      apply(entry)
      return info(entry)
    }
    if (action === 'replay') {
      const ve = entry.ve
      const state = ve.animationState?.getState?.()
      const initial = ve.props?.initial && typeof ve.props.initial === 'object' ? ve.props.initial : {}
      const moves: Array<[string, any, number | string]> = []
      for (const key of keysOf(ve)) {
        const from = entry.from[key] ?? initial[key]
        const target = state?.animate?.prevResolvedValues?.[key]
        if (from === undefined || target === undefined || from === target) continue
        moves.push([key, ve.getValue(key), from])
      }
      if (!moves.length || !state) return info(entry, { replayed: false })
      for (const [key, value, from] of moves) {
        if (typeof value.jump === 'function') value.jump(from); else value.set(from)
        for (const type of Object.keys(state)) delete state[type]?.prevResolvedValues?.[key]
      }
      ve.animationState.animateChanges()
      return info(entry, { replayed: true })
    }
    return info(entry)
  } catch (error) {
    return { found: false, reason: 'error', message: String((error as Error)?.message ?? error).slice(0, 200) }
  }
}
