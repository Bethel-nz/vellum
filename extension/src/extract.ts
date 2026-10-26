import { getElementBounds, getElementContext, getElementSelector } from 'react-grab/primitives'
import type { Capture } from '../../core/capture'

type CapturedElement = Capture['elements'][number]
export type Selection = { element: Element; ref: string; note: string; recorded: CapturedElement['animations'] }
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
