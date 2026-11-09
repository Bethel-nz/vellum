import { getElementBounds, getElementContext, getElementSelector } from 'react-grab/primitives'
import type { Capture, CaptureRelated } from '../../core/capture'
import type { Upload } from './messages'

type CapturedElement = Capture['elements'][number]
/** `related`, `changes` and `relatedShots` come from the last recorded interaction, with Related elements on. */
export type Selection = { element: Element; ref: string; note: string; recorded: CapturedElement['animations']; related?: CaptureRelated[]; changes?: CapturedElement['changes']; relatedShots?: Upload[] }
const limit = (text: string, n = 60_000) => text.length > n ? `${text.slice(0, n)}\n<!-- shortened -->` : text
const dictionary = (style: CSSStyleDeclaration) => Object.fromEntries(Array.from(style).map((name) => [name, style.getPropertyValue(name)]))

type Trigger = 'idle' | 'hover' | 'focus' | 'active' | 'click' | 'enter'

function animationData(animation: Animation, trigger: Trigger): CapturedElement['animations'] {
  const effect = animation.effect
  if (!(effect instanceof KeyframeEffect)) return []
  const kind = animation instanceof CSSAnimation ? 'css-animation' : animation instanceof CSSTransition ? 'css-transition' : 'waapi'
  const timing = Object.fromEntries(Object.entries(effect.getTiming()).map(([name, value]) => [name, typeof value === 'number' && !Number.isFinite(value) ? String(value) : value]))
  return [{ origin: 'extracted', kind, trigger, name: animation instanceof CSSAnimation ? animation.animationName : animation.id || undefined, keyframes: effect.getKeyframes(), timing }]
}

export function animations(element: Element, trigger: Trigger = 'idle'): CapturedElement['animations'] {
  return element.getAnimations({ subtree: true }).slice(0, 40).flatMap((animation) => animationData(animation, trigger))
}

export function observeAnimations(element: Element, duration = 2000): Promise<CapturedElement['animations']> {
  const seen = new Set<Animation>()
  const captured: CapturedElement['animations'] = []
  const start = performance.now()
  return new Promise((resolve) => {
    let frame = 0
    const inspect = () => {
      for (const animation of element.getAnimations({ subtree: true })) {
        if (seen.has(animation) || seen.size >= 40) continue
        seen.add(animation)
        captured.push(...animationData(animation, 'click'))
      }
    }
    const tick = () => { inspect(); if (performance.now() - start < duration && element.isConnected) frame = requestAnimationFrame(tick) }
    const onStart = () => { inspect(); queueMicrotask(inspect) }
    element.addEventListener('animationstart', onStart, true)
    element.addEventListener('transitionrun', onStart, true)
    inspect()
    frame = requestAnimationFrame(tick)
    setTimeout(() => {
      inspect()
      cancelAnimationFrame(frame)
      element.removeEventListener('animationstart', onStart, true)
      element.removeEventListener('transitionrun', onStart, true)
      resolve(captured)
    }, duration)
  })
}

// Drawn: a box, and not hidden or transparent (itself or an ancestor). On screen: inside the window,
// so an off-canvas sidebar counts as closed until it slides in.
function drawn(element: Element) {
  const box = element.getBoundingClientRect()
  if (!box.width || !box.height || !element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return undefined
  return { box, onScreen: box.right > 0 && box.bottom > 0 && box.left < innerWidth && box.top < innerHeight }
}
const pageBox = (box: DOMRect) => ({ x: box.x + scrollX, y: box.y + scrollY, w: box.width, h: box.height })
const STATE_ATTRIBUTES = ['aria-expanded', 'aria-pressed', 'aria-selected', 'aria-checked', 'aria-hidden', 'open', 'hidden', 'data-state']
const MOST_RELATED = 5
const IMPLICIT_ROLES: Record<string, string> = { DIALOG: 'dialog', NAV: 'navigation', ASIDE: 'complementary', HEADER: 'banner', FOOTER: 'contentinfo', FORM: 'form', UL: 'list', OL: 'list' }

/**
 * Related elements: what an interaction with `trigger` opens or closes elsewhere on the page, like
 * the sidebar a button slides in or the menu it closes. Call it as the interaction starts, before
 * the page's own handlers run; `stop()` at the end returns what changed. What's drawn is read once at
 * the start and once at the end (reads only, so one layout each), and what's new or gone is cut down
 * to the outermost elements, largest first. If the page scrolled in between, only elements that
 * started or stopped being drawn count, not ones that scrolled into view. The page's animations in between are
 * collected as they start, and the ones inside a related element go with it; elements that appear
 * mid-interaction are also sampled, for motion driven from script.
 */
export function watchRelated(trigger: Element, duration: number, ignore: (element: Element) => boolean) {
  const skip = (element: Element) => element === document.documentElement || element === document.body || element === trigger || trigger.contains(element) || element.contains(trigger) || ignore(element)
  const before = new Map<Element, { box: ReturnType<typeof pageBox>; onScreen: boolean }>()
  for (const element of document.body.querySelectorAll('*')) {
    if (skip(element)) continue
    const seen = drawn(element)
    if (seen) before.set(element, { box: pageBox(seen.box), onScreen: seen.onScreen })
  }
  const scroll = { x: scrollX, y: scrollY }
  const seen = new Set<Animation>()
  const started: Array<{ target: Element; data: CapturedElement['animations'][number] }> = []
  const collect = () => {
    for (const animation of document.getAnimations()) {
      if (seen.has(animation) || seen.size >= 200) continue
      seen.add(animation)
      const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null
      if (target) for (const data of animationData(animation, 'click')) started.push({ target, data })
    }
  }
  const onStart = () => { collect(); queueMicrotask(collect) }
  document.addEventListener('animationstart', onStart, true)
  document.addEventListener('transitionrun', onStart, true)
  let frame = requestAnimationFrame(function tick() { collect(); frame = requestAnimationFrame(tick) })
  const sampled: Array<{ element: Element; motion: ReturnType<typeof sample> }> = []
  // The first value each state attribute had, per element.
  const changes = new Map<Element, Map<string, string | null>>()
  const startedAt = performance.now()
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes' && record.target instanceof Element && STATE_ATTRIBUTES.includes(record.attributeName!)) {
        const first = changes.get(record.target) ?? new Map<string, string | null>()
        if (!first.has(record.attributeName!)) first.set(record.attributeName!, record.oldValue)
        changes.set(record.target, first)
      }
      const appeared = record.type === 'childList' ? Array.from(record.addedNodes) : [record.target]
      for (const node of appeared) {
        if (!(node instanceof Element) || skip(node) || sampled.length >= 6 || sampled.some((item) => item.element === node || item.element.contains(node))) continue
        sampled.push({ element: node, motion: sample(node, Math.max(16, duration - (performance.now() - startedAt))) })
      }
    }
  })
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeOldValue: true, attributeFilter: ['class', 'style', ...STATE_ATTRIBUTES] })
  return {
    async stop(): Promise<{ related: Array<CaptureRelated & { element: Element }>; changes: NonNullable<CapturedElement['changes']> }> {
      observer.disconnect()
      cancelAnimationFrame(frame)
      document.removeEventListener('animationstart', onStart, true)
      document.removeEventListener('transitionrun', onStart, true)
      collect()
      const motion = await Promise.all(sampled.map(async ({ element, motion }) => ({ element, animations: await motion })))
      const scrolled = scrollX !== scroll.x || scrollY !== scroll.y
      const opened: Element[] = []
      for (const element of document.body.querySelectorAll('*')) {
        if (skip(element)) continue
        const now = drawn(element), then = before.get(element)
        if (now?.onScreen && (!then || (!scrolled && !then.onScreen))) opened.push(element)
      }
      const closed = [...before].filter(([element, then]) => {
        if (!then.onScreen) return false
        const now = element.isConnected ? drawn(element) : undefined
        return !now || (!scrolled && !now.onScreen)
      }).map(([element]) => element)
      const outermost = (list: Element[]) => { const set = new Set(list); return list.filter((element) => { for (let parent = element.parentElement; parent; parent = parent.parentElement) if (set.has(parent)) return false; return true }) }
      const area = (box: { w: number; h: number }) => box.w * box.h
      const related = [
        ...outermost(opened).map((element) => ({ element, change: 'opened' as const, box: pageBox(element.getBoundingClientRect()) })),
        ...outermost(closed).map((element) => ({ element, change: 'closed' as const, box: before.get(element)!.box })),
      ].filter(({ box }) => area(box) >= 64).sort((a, b) => area(b.box) - area(a.box)).slice(0, MOST_RELATED)
      return {
        related: related.map(({ element, change, box }) => {
          const label = element.getAttribute('aria-label') ?? (element.getAttribute('aria-labelledby') ?? '').split(/\s+/).map((id) => id && document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' ')
          const text = ((element instanceof HTMLElement ? element.innerText : null) ?? element.textContent ?? '').replace(/\s+/g, ' ').trim()
          const role = element.getAttribute('role') ?? IMPLICIT_ROLES[element.tagName]
          const inside = (target: Element) => element === target || element.contains(target)
          return {
            element, change, selector: getElementSelector(element).slice(0, 8192), box,
            ...(role ? { role: role.slice(0, 500) } : {}),
            ...(label ? { label: label.slice(0, 500) } : {}),
            ...(text ? { text: text.slice(0, 200) } : {}),
            animations: [
              ...started.filter(({ target }) => inside(target)).map(({ data }) => data),
              ...motion.filter((item) => inside(item.element) || item.element.contains(element)).flatMap((item) => item.animations),
            ].slice(0, 40),
          }
        }),
        changes: [...changes].filter(([element]) => element === trigger || related.some((item) => item.element === element))
          .flatMap(([element, first]) => [...first].map(([attribute, from]) => ({ element, attribute, from })))
          .map(({ element, attribute, from }) => ({ selector: getElementSelector(element).slice(0, 8192), attribute, from: from?.slice(0, 2000) ?? null, to: element.getAttribute(attribute)?.slice(0, 2000) ?? null }))
          .filter(({ from, to }) => from !== to).slice(0, 40),
      }
    },
  }
}

function matchedRules(element: Element) {
  const rules: string[] = []
  const visit = (list: CSSRuleList) => {
    for (const rule of Array.from(list)) {
      if (rules.join('').length > 60_000) break
      if (rule instanceof CSSStyleRule) {
        try { if (element.matches(rule.selectorText)) rules.push(rule.cssText) } catch { /* Selectors a browser cannot query are omitted. */ }
      } else if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules)
    }
  }
  for (const sheet of Array.from(document.styleSheets)) {
    try { visit(sheet.cssRules) } catch { /* Cross-origin sheets can expose computed styles only. */ }
  }
  return rules
}

export async function extract(selection: Selection): Promise<CapturedElement> {
  const { element, ref, note } = selection
  if (!element.isConnected) throw new Error('A selected element left the page. Select it again.')
  if (element.ownerDocument !== document) throw new Error('Open the embedded frame as its own page to capture its elements.')
  const actual = getComputedStyle(element)
  const baseline = document.createElement(element.tagName)
  baseline.setAttribute('style', 'all:initial!important;position:fixed!important;visibility:hidden!important;pointer-events:none!important')
  document.documentElement.append(baseline)
  const defaults = dictionary(getComputedStyle(baseline))
  baseline.remove()
  const css = Object.fromEntries(Object.entries(dictionary(actual)).filter(([name, value]) => !name.startsWith('--') && value !== defaults[name]))
  const rules = matchedRules(element)
  const used = [...new Set([...rules.join('\n').matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1]!))]
  const pseudo: Record<string, Record<string, string>> = {}
  for (const name of ['::before', '::after']) {
    const style = getComputedStyle(element, name)
    if (style.content !== 'none' && style.content !== 'normal') pseudo[name] = dictionary(style)
  }
  const box = getElementBounds(element)
  const parent = element.parentElement ? getComputedStyle(element.parentElement) : undefined
  const context = await getElementContext(element).catch(() => null)
  return {
    ref, selector: getElementSelector(element), note: note.trim() || undefined,
    html: limit(element.outerHTML), css, pseudo, rules,
    vars: Object.fromEntries(used.map((name) => [name, actual.getPropertyValue(name)])), fonts: [actual.fontFamily],
    box: { x: box.x + scrollX, y: box.y + scrollY, w: box.width, h: box.height },
    parent: parent ? { display: parent.display, layout: Object.fromEntries(['display', 'position', 'gap', 'align-items', 'justify-content', 'grid-template-columns', 'grid-template-rows', 'flex-direction'].map((name) => [name, parent.getPropertyValue(name)])) } : undefined,
    react: context?.componentName ? { component: context.componentName, source: context.filePath ? `${context.filePath}:${context.lineNumber ?? 1}` : undefined } : undefined,
    animations: [...animations(element), ...selection.recorded], shots: { element: `${ref}.png`, context: `${ref}-context.png` },
    ...(selection.related?.length ? { related: selection.related } : {}),
    ...(selection.changes?.length ? { changes: selection.changes } : {}),
  }
}

export function assets(selections: Selection[]): Capture['assets'] {
  const urls = new Set<string>()
  for (const { element } of selections) {
    for (const target of [element, ...Array.from(element.querySelectorAll('img,video,source,svg use')).slice(0, 100)]) {
      for (const name of ['src', 'poster', 'href', 'xlink:href']) {
        const raw = target.getAttribute(name)
        if (raw) { try { const url = new URL(raw, location.href); if (url.protocol === 'http:' || url.protocol === 'https:') urls.add(url.href) } catch {} }
      }
      for (const match of getComputedStyle(target).backgroundImage.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
        try { urls.add(new URL(match[1]!, location.href).href) } catch {}
      }
    }
  }
  return Array.from(urls).slice(0, 100).map((url) => ({ url }))
}

export async function sample(element: Element, duration = 2000, gesture?: NonNullable<CapturedElement['animations'][number]['gesture']>): Promise<CapturedElement['animations']> {
  const start = performance.now()
  const interval = Math.max(16, duration / 720)
  const samples: Array<Record<string, number>> = []
  await new Promise<void>((resolve) => {
    const frame = () => {
      if (!element.isConnected) return resolve()
      const elapsed = performance.now() - start
      if (!samples.length || elapsed - (samples.at(-1)?.t ?? 0) >= interval) {
        const box = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        let matrix: DOMMatrix
        try { matrix = new DOMMatrix(style.transform === 'none' ? undefined : style.transform) } catch { matrix = new DOMMatrix() }
        const sample: Record<string, number> = { t: Math.round(elapsed), x: box.x, y: box.y, w: box.width, h: box.height, opacity: Number(style.opacity), a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, tx: matrix.e, ty: matrix.f }
        const width = Number.parseFloat(style.width)
        const height = Number.parseFloat(style.height)
        if (Number.isFinite(width)) sample.sw = width
        if (Number.isFinite(height)) sample.sh = height
        samples.push(sample)
      }
      if (elapsed < duration) requestAnimationFrame(frame)
      else resolve()
    }
    requestAnimationFrame(frame)
  })
  const moved = samples.length > 1 && samples.some((row) => Object.entries(row).some(([key, value]) => key !== 't' && Math.abs(value - samples[0]![key]!) > 0.001))
  if (!moved && !gesture) return []
  const trigger: Trigger = gesture?.events.some((event) => event.type === 'click') ? 'click'
    : gesture?.events.some((event) => event.type === 'focusin') ? 'focus'
      : gesture?.events.some((event) => event.type.startsWith('key')) ? 'enter'
        : gesture?.events.some((event) => event.type === 'pointerover' || event.type === 'mouseover') ? 'hover' : 'active'
  return [{ origin: 'sampled', kind: 'js', trigger, name: moved ? 'Sampled motion (inferred)' : 'Captured interaction gesture', ...(gesture ? { gesture } : {}), ...(moved ? { samples } : {}), timing: { duration } }]
}

// Fetch only resources the page is allowed to read; failed CORS keeps the original URL.
export async function downloadAssets(capture: Capture): Promise<import('./messages').Upload[]> {
  const uploads: import('./messages').Upload[] = []
  const types: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'font/woff': 'woff', 'font/woff2': 'woff2', 'font/ttf': 'ttf', 'font/otf': 'otf' }
  await Promise.all((capture.assets ?? []).slice(0, 12).map(async (asset, index) => {
    try {
      const response = await fetch(asset.url, { mode: 'cors', credentials: 'omit', signal: AbortSignal.timeout(2500) })
      const mime = (response.headers.get('content-type') ?? '').split(';')[0]!
      const extension = types[mime]
      if (!response.ok || !extension || Number(response.headers.get('content-length') ?? 0) > 1_000_000) return
      const reader = response.body?.getReader()
      if (!reader) return
      const chunks: Uint8Array[] = []
      let length = 0
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          length += value.byteLength
          if (length > 1_000_000) { await reader.cancel(); return }
          chunks.push(value)
        }
      } finally { reader.releaseLock() }
      const blob = new Blob(chunks, { type: mime })
      const data = await new Promise<string>((resolve, reject) => {
        const file = new FileReader()
        file.onload = () => resolve(String(file.result).split(',')[1]!)
        file.onerror = reject
        file.readAsDataURL(blob)
      })
      asset.file = `asset-${index + 1}.${extension}`
      uploads.push({ name: asset.file, mime, data })
    } catch { /* Metadata still points to resources that CORS or the size limit excluded. */ }
  }))
  return uploads
}
