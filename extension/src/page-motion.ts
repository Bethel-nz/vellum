/**
 * Live editing of Motion (framer-motion / motion) transitions on the page's own elements.
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
 * Results are page-controlled data: the caller treats them as display values only.
 */

export type MotionForm = 'duration' | 'visualDuration' | 'physics' | 'tween'
export type MotionEdit = { form: MotionForm; values: Record<string, number | number[]> }
export type PageMotionAction = 'read' | 'edit' | 'replay' | 'reset' | 'revert' | 'revert-all'
export type PageMotionInfo =
  | { found: false; reason: 'gone' | 'no-react' | 'no-motion' | 'error'; message?: string }
  | {
    found: true
    /** The element Motion animates, e.g. `div.absolute`, and where it sits relative to the selection. */
    owner: string; relation: 'self' | 'parent' | 'ancestor' | 'child'
    key: string; keys: string[]
    /** `default`: no transition in the source; Motion's built-in one is shown. `inline`: set in `animate` or a variant. */
    source: 'transition' | 'per-value' | 'default' | 'inline'
    form: MotionForm | 'other'; editable: boolean
    /** The transition as written in the source (or Motion's default), JSON-safe. */
    original: Record<string, unknown> | null
    /** The dials' starting values, in the source's own form. */
    values: Record<string, number | number[]>
    edited: boolean; moved: boolean; replayed?: boolean
  }

export function pageMotion(ref: string, action: PageMotionAction, edit: MotionEdit | null): PageMotionInfo {
  type Entry = {
    ve: any; node: Element; relation: 'self' | 'parent' | 'ancestor' | 'child'
    original: () => unknown; own?: PropertyDescriptor; edit: Record<string, unknown> | null
    path: string | null; from: Record<string, number | string>; stop: Array<() => void>
  }
  const w = window as any
  // `owners` outlives a revert: React may replace the selected element (a carousel recycling its slides)
  // while the element Motion animates stays, so a lifted edit can still be put back on reopen.
  const store: { entries: Map<string, Entry>; owners: Map<string, { node: Element; relation: Entry['relation'] }> } = w[Symbol.for('vellum.snapshot.motion')] ??= { entries: new Map(), owners: new Map() }
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
  function locate(start: Element): { ve: any; node: Element; relation: Entry['relation'] } | null {
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
  function teardown(entry: Entry) {
    for (const stop of entry.stop) { try { stop() } catch { /* The value may be gone. */ } }
    if (entry.own) Object.defineProperty(entry.ve, 'getDefaultTransition', entry.own)
    else delete entry.ve.getDefaultTransition
  }
  function keysOf(ve: any): string[] {
    const keys = new Set<string>()
    const animate = ve.props?.animate
    if (animate && typeof animate === 'object' && !Array.isArray(animate)) for (const key of Object.keys(animate)) if (key !== 'transition' && key !== 'transitionEnd') keys.add(key)
    const resolved = ve.animationState?.getState?.().animate?.prevResolvedValues
    if (resolved) for (const key of Object.keys(resolved)) keys.add(key)
    return [...keys].filter((key) => ve.latestValues?.[key] !== undefined).slice(0, 12)
  }
  function entryFor(create: boolean): Entry | null {
    let entry = store.entries.get(ref)
    if (entry && (!entry.node.isConnected || entry.ve.current !== entry.node)) { teardown(entry); store.entries.delete(ref); entry = undefined }
    if (entry || !create) return entry ?? null
    const element = document.querySelector(`[data-vellum-ref="${CSS.escape(ref)}"]`)
    const owner = store.owners.get(ref)
    const kept = owner?.node.isConnected ? veFor(owner.node) : null
    const found = element ? locate(element) : kept && owner ? { ve: kept, node: owner.node, relation: owner.relation } : null
    if (!found) return null
    store.owners.set(ref, { node: found.node, relation: found.relation })
    const ve = found.ve
    entry = { ...found, original: ve.getDefaultTransition, own: Object.getOwnPropertyDescriptor(ve, 'getDefaultTransition'), edit: null, path: null, from: {}, stop: [] }
    for (const key of keysOf(ve)) {
      const value = ve.getValue(key, ve.latestValues[key])
      if (!value?.on) continue
      const target = entry
      target.stop.push(value.on('animationStart', () => { const at = value.get(); if (typeof at === 'number' || typeof at === 'string') target.from[key] = at }))
    }
    store.entries.set(ref, entry)
    return entry
  }
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
      found: true, owner: describe(entry.node), relation: entry.relation, key, keys, source,
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
      return { found: false, reason: 'gone' }
    }
    if (action === 'revert' || action === 'reset') {
      const entry = store.entries.get(ref)
      if (entry) { teardown(entry); store.entries.delete(ref) }
      if (action === 'revert') { store.owners.delete(ref); return { found: false, reason: 'gone' } }
    }
    const entry = entryFor(true)
    if (!entry) return { found: false, reason: document.querySelector(`[data-vellum-ref="${CSS.escape(ref)}"]`) ? sawReact ? 'no-motion' : 'no-react' : 'gone' }
    if (action === 'edit' && edit) {
      const current = info(entry)
      if (!current.found || !current.editable || current.form !== edit.form) return current
      const values = edit.values
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
