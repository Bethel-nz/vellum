import type { Capture, SavedCapture } from '../../core/capture'
import { bridge, saveBridgeSettings, settings, uploadCapture } from './bridge'
import type { CaptureResult, ContentMessage, PageScreenshotResult, SnapshotResult, SnapshotStateResult, Upload, WorkerMessage } from './messages'

const busy = new Set<number>()

const openToolbars = new Map<number, { toolbarId: string; installationId: string; windowId: number }>()
let installation: Promise<string> | undefined
function installationId() {
  return installation ??= chrome.storage.local.get('browserInstallationId').then(async saved => {
    if (typeof saved.browserInstallationId === 'string') return saved.browserInstallationId
    const id = crypto.randomUUID(); await chrome.storage.local.set({ browserInstallationId: id }); return id
  })
}
async function toolbarPresence(tab: chrome.tabs.Tab, toolbarId: string, open: boolean) {
  if (tab.id === undefined || tab.windowId === undefined || !/^[\w-]{1,100}$/.test(toolbarId)) throw new Error('Invalid toolbar identity')
  const id = await installationId()
  const target = (await chrome.debugger.getTargets()).find(target => target.tabId === tab.id && target.type === 'page')
  if (open) openToolbars.set(tab.id, { toolbarId, installationId: id, windowId: tab.windowId }); else openToolbars.delete(tab.id)
  return bridge('/browser/targets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ installationId: id, toolbarId, tabId: tab.id, windowId: tab.windowId, targetId: target?.id, url: tab.url ?? '', title: tab.title ?? '', open }) })
}
async function captureLease(tabId: number) {
  const result = await bridge<{ lease?: string }>('/browser/capture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ installationId: await installationId(), tabId }) })
  return async () => { if (result.lease) await bridge('/browser/capture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lease: result.lease }) }) }
}
chrome.tabs.onRemoved.addListener(tabId => { const open = openToolbars.get(tabId); if (open) void toolbarPresence({ id: tabId, windowId: open.windowId } as chrome.tabs.Tab, open.toolbarId, false).catch(() => {}) })
chrome.tabs.onUpdated.addListener((tabId, change, tab) => { const open = openToolbars.get(tabId); if (open && change.status === 'loading') void toolbarPresence(tab, open.toolbarId, false).catch(() => {}) })

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
async function content<T>(tabId: number, message: ContentMessage): Promise<T> {
  const result = await chrome.tabs.sendMessage(tabId, message)
  if (result && typeof result === 'object' && 'error' in result) throw new Error(String(result.error))
  return result as T
}
const command = <T = Record<string, unknown>>(tabId: number, method: string, params?: object): Promise<T> => chrome.debugger.sendCommand({ tabId }, method, params) as Promise<T>

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) throw new Error('Open a web page first.')
  if (!/^https?:\/\//.test(tab.url ?? '')) throw new Error('Selection is available on web pages. Chrome settings, the extension store and new tabs cannot be captured.')
  return tab.id
}

async function toggle(tabId: number) {
  try { await content(tabId, { type: 'ping' }) } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
  }
  await content(tabId, { type: 'toggle' })
}

/** A shot of the page as it is, with Vellum's overlay hidden only for that shot. */
async function withoutOverlay<T>(tabId: number, shot: () => Promise<T>): Promise<T> {
  await content(tabId, { type: 'visibility', hidden: true })
  try { return await shot() } finally { await content(tabId, { type: 'visibility', hidden: false }).catch(() => {}) }
}

/** `ref`: the shot is of that element alone, with whatever covers it on the page hidden for the moment. */
async function screenshot(tabId: number, name: string, box?: { x: number; y: number; w: number; h: number }, ref?: string): Promise<Upload> {
  let data: string
  if (box && ref) {
    await content(tabId, { type: 'isolate', ref })
    try { data = await cropped(tabId, box) } finally { await content(tabId, { type: 'isolate', ref: null }).catch(() => {}) }
  } else data = box ? await cropped(tabId, box) : (await command<{ data: string }>(tabId, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })).data
  if (data.length > 14_000_000) throw new Error('This screenshot is too large. Select a smaller part of the page.')
  return { name, mime: 'image/png', data }
}

/**
 * A page box (CSS pixels, nodeBox) cut out of a screenshot of what's on screen. The image's own
 * width gives its pixels per CSS pixel, which covers zoom and Retina. The part of the box off
 * screen is left out; nodeBox scrolls the element into view first.
 */
async function cropped(tabId: number, box: { x: number; y: number; w: number; h: number }): Promise<string> {
  const { cssVisualViewport: view } = await command<{ cssVisualViewport: { pageX: number; pageY: number; clientWidth: number; clientHeight: number } }>(tabId, 'Page.getLayoutMetrics')
  const left = Math.max(0, box.x - view.pageX), top = Math.max(0, box.y - view.pageY)
  const right = Math.min(view.clientWidth, box.x - view.pageX + box.w), bottom = Math.min(view.clientHeight, box.y - view.pageY + box.h)
  if (right - left < 1 || bottom - top < 1) throw new Error('The element is off screen. Scroll to it, then capture again.')
  const shot = await command<{ data: string }>(tabId, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${shot.data}`)).blob())
  const scale = image.width / view.clientWidth
  const canvas = new OffscreenCanvas(Math.max(1, Math.round((right - left) * scale)), Math.max(1, Math.round((bottom - top) * scale)))
  canvas.getContext('2d')!.drawImage(image, left * scale, top * scale, (right - left) * scale, (bottom - top) * scale, 0, 0, canvas.width, canvas.height)
  image.close()
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

async function nodeFor(tabId: number, ref: string) {
  const root = await command<{ root: { nodeId: number } }>(tabId, 'DOM.getDocument')
  const result = await command<{ nodeId: number }>(tabId, 'DOM.querySelector', { nodeId: root.root.nodeId, selector: `[data-vellum-ref="${ref}"]` })
  return result.nodeId
}

/**
 * Where the annotated node is drawn on the page, in CSS pixels, measured by the browser in the
 * same session that takes the screenshot, as DevTools' "Capture node screenshot" does: scrolled
 * into view if it isn't, then the bounds of its content quads (transforms included) plus the
 * page's scroll. Nothing measured in the page script reaches the crop.
 */
async function nodeBox(tabId: number, ref: string): Promise<Capture['elements'][number]['box']> {
  const nodeId = await nodeFor(tabId, ref)
  if (!nodeId) throw new Error('Unable to locate the annotated element. Select it again and retry.')
  await command(tabId, 'DOM.scrollIntoViewIfNeeded', { nodeId }).catch(() => {})
  const { quads } = await command<{ quads: number[][] }>(tabId, 'DOM.getContentQuads', { nodeId }).catch(() => ({ quads: [] as number[][] }))
  if (!quads.length) throw new Error('The annotated element isn’t drawn on the page right now. Show it, then capture again.')
  const xs = quads.flatMap((quad) => [quad[0]!, quad[2]!, quad[4]!, quad[6]!])
  const ys = quads.flatMap((quad) => [quad[1]!, quad[3]!, quad[5]!, quad[7]!])
  const { cssVisualViewport: view } = await command<{ cssVisualViewport: { pageX: number; pageY: number } }>(tabId, 'Page.getLayoutMetrics')
  const x = Math.min(...xs), y = Math.min(...ys)
  return { x: x + view.pageX, y: y + view.pageY, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

async function listeners(tabId: number, nodeId: number): Promise<Capture['elements'][number]['listeners']> {
  const resolved = await command<{ object: { objectId?: string } }>(tabId, 'DOM.resolveNode', { nodeId })
  if (!resolved.object.objectId) return []
  const objectId = resolved.object.objectId
  try {
    const result = await command<{ listeners: Array<{ type: string; scriptId: string; lineNumber: number; columnNumber: number }> }>(tabId, 'DOMDebugger.getEventListeners', { objectId })
    return Promise.all(result.listeners.slice(0, 20).map(async (listener) => {
      const script = await command<{ scriptSource: string }>(tabId, 'Debugger.getScriptSource', { scriptId: listener.scriptId }).catch(() => undefined)
      const lines = script?.scriptSource.split('\n') ?? []
      return { type: listener.type, source: `script ${listener.scriptId}:${listener.lineNumber + 1}:${listener.columnNumber + 1}`, snippet: lines.slice(Math.max(0, listener.lineNumber - 2), listener.lineNumber + 8).join('\n').slice(0, 4000) || undefined }
    }))
  } finally { await command(tabId, 'Runtime.releaseObject', { objectId }).catch(() => {}) }
}

async function capture(tabId: number, options: Extract<WorkerMessage, { type: 'capture' }>) {
  if (busy.has(tabId)) throw new Error('A capture is already being prepared.')
  busy.add(tabId)
  let attached = false
  let release: (() => Promise<void>) | undefined
  try {
    release = await captureLease(tabId)
    try {
      await chrome.debugger.attach({ tabId }, '1.3')
      attached = true
    } catch {
      throw new Error('Chrome could not attach the capture tool. Close DevTools or any other debugger on this tab, then try again.')
    }
    await command(tabId, 'Page.enable')
    await command(tabId, 'DOM.enable')
    if (options.triggers || options.listeners) await command(tabId, 'CSS.enable')
    if (options.listeners) await command(tabId, 'Debugger.enable')
    const { capture: result, files: assets = [] } = await content<CaptureResult>(tabId, { type: 'extract', ref: options.ref })
    const files: Upload[] = [...assets]
    for (const element of result.elements) {
      element.box = await nodeBox(tabId, element.ref)
      files.push(await screenshot(tabId, element.shots.element, element.box, element.ref))
      // The context shows what's around the element, so Vellum's own overlay steps aside for it.
      files.push(await withoutOverlay(tabId, () => screenshot(tabId, element.shots.context!, { x: Math.max(0, element.box.x - 64), y: Math.max(0, element.box.y - 64), w: element.box.w + 128, h: element.box.h + 128 })))
      if (options.frames && element.animations.some((animation) => animation.origin === 'extracted')) {
        const frames: string[] = []
        for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
          await content(tabId, { type: 'seek', ref: element.ref, progress })
          const name = `${element.ref}-frame-${progress * 100}.png`
          files.push(await screenshot(tabId, name, await nodeBox(tabId, element.ref), element.ref))
          frames.push(name)
        }
        for (const animation of element.animations) if (animation.origin === 'extracted') animation.frames = frames
        await content(tabId, { type: 'restore-animations' })
      }
      if (options.triggers || options.listeners) {
        const nodeId = await nodeFor(tabId, element.ref)
        if (nodeId && options.listeners) element.listeners = await listeners(tabId, nodeId)
        if (nodeId && options.triggers) {
          try {
            for (const trigger of ['hover', 'focus', 'active'] as const) {
              await command(tabId, 'CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [trigger] })
              await sleep(40)
              const triggered = await content<Capture['elements'][number]['animations']>(tabId, { type: 'trigger-read', ref: element.ref, trigger })
              element.animations.push(...triggered)
            }
          } finally { await command(tabId, 'CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] }) }
        }
      }
    }
    result.pageShot = 'page.png'
    files.push(await withoutOverlay(tabId, () => screenshot(tabId, result.pageShot!)))
    if (new TextEncoder().encode(JSON.stringify(result)).byteLength + files.reduce((total, file) => total + file.data.length * 0.75, 0) > 45_000_000) throw new Error('This capture exceeds 45 MB. Turn off animation frames or select fewer elements.')
    const saved = await uploadCapture(result, files, options.mode) as SavedCapture
    await content(tabId, { type: 'captured', saved })
    return saved
  } finally {
    await content(tabId, { type: 'restore-animations' }).catch(() => {})
    await content(tabId, { type: 'visibility', hidden: false }).catch(() => {})
    if (attached) await chrome.debugger.detach({ tabId }).catch(() => {})
    await release?.().catch(() => {})
    busy.delete(tabId)
  }
}

async function handle(message: WorkerMessage, sender: chrome.runtime.MessageSender) {
  if (sender.id !== chrome.runtime.id) throw new Error('This request did not come from Vellum Snapshot.')
  // Page-side scripts can request capture operations, but cannot read connection credentials.
  const popup = sender.url === chrome.runtime.getURL('popup.html')
  if (sender.tab && !popup && message.type !== 'toolbar-presence' && message.type !== 'capture' && message.type !== 'snapshot' && message.type !== 'related-shots' && message.type !== 'page-screenshot' && message.type !== 'capture-status' && message.type !== 'appearance' && message.type !== 'notes' && message.type !== 'settings' && message.type !== 'target' && message.type !== 'bridge-settings') throw new Error('This action is only available in the extension popup.')
  switch (message.type) {
    case 'toolbar-presence': {
      if (!sender.tab || sender.frameId !== 0) throw new Error('Toolbar presence requires the top-frame extension sender')
      return toolbarPresence(sender.tab, message.toolbarId, message.open)
    }
    case 'settings': return settings()
    case 'bridge-settings': return saveBridgeSettings(message.url, message.port)
    case 'notes': return bridge('/notes')
    case 'appearance': return bridge('/health')
    case 'target': return chrome.storage.local.set({ target: message.target, mode: message.mode === 'queue' ? 'queue' : 'send' })
    case 'toggle': return toggle(await activeTab())
    case 'capture-status': return bridge(`/captures/${encodeURIComponent(message.id)}`)
    case 'snapshot': {
      const tabId = sender.tab?.id ?? await activeTab()
      if (busy.has(tabId)) throw new Error('A capture is already being prepared.')
      busy.add(tabId)
      let attached = false
      let release: (() => Promise<void>) | undefined
      try {
        release = await captureLease(tabId)
        await chrome.debugger.attach({ tabId }, '1.3'); attached = true
        await command(tabId, 'Page.enable')
        await command(tabId, 'DOM.enable')
        // The overlay stays on screen: isolate cuts it out over the element for the shot. The shot
        // comes first; reading the element's styles (snapshot-state) is the slow part, so it waits.
        await content(tabId, { type: 'freeze', ref: message.ref })
        const id = crypto.randomUUID()
        const box = await nodeBox(tabId, message.ref)
        const image = await screenshot(tabId, `${message.ref}-snapshot-${id}.png`, box, message.ref)
        const { node } = await content<SnapshotStateResult>(tabId, { type: 'snapshot-state', ref: message.ref })
        node.box = box
        node.shots = { element: image.name }
        return { snapshot: { id, createdAt: new Date().toISOString(), node, image: { file: image.name, mime: 'image/png', dataUrl: `data:image/png;base64,${image.data}` } } } satisfies SnapshotResult
      } finally {
        await content(tabId, { type: 'restore-animations' }).catch(() => {})
        if (attached) await chrome.debugger.detach({ tabId }).catch(() => {})
    await release?.().catch(() => {})
        busy.delete(tabId)
      }
    }
    case 'related-shots': {
      // Pictures of what a recorded interaction opened, each alone, taken as the recording ends while
      // they're still open. One that can't be pictured (gone, or not drawn) is skipped, not an error.
      const tabId = sender.tab?.id ?? await activeTab()
      if (busy.has(tabId)) throw new Error('A capture is already being prepared.')
      busy.add(tabId)
      let attached = false
      let release: (() => Promise<void>) | undefined
      try {
        release = await captureLease(tabId)
        await chrome.debugger.attach({ tabId }, '1.3'); attached = true
        await command(tabId, 'Page.enable')
        await command(tabId, 'DOM.enable')
        const shots: Array<Upload | null> = []
        for (const ref of message.refs.slice(0, 5)) {
          if (!/^[\w-]{1,100}$/.test(ref)) { shots.push(null); continue }
          shots.push(await nodeBox(tabId, ref).then((box) => screenshot(tabId, `${ref}.png`, box, ref)).catch(() => null))
        }
        return shots
      } finally {
        if (attached) await chrome.debugger.detach({ tabId }).catch(() => {})
        await release?.().catch(() => {})
        busy.delete(tabId)
      }
    }
    case 'page-screenshot': {
      const tabId = sender.tab?.id ?? await activeTab()
      if (busy.has(tabId)) throw new Error('A capture is already being prepared.')
      busy.add(tabId)
      let attached = false
      let release: (() => Promise<void>) | undefined
      try {
        release = await captureLease(tabId)
        await chrome.debugger.attach({ tabId }, '1.3'); attached = true
        await command(tabId, 'Page.enable')
        await content(tabId, { type: 'visibility', hidden: true })
        const image = await screenshot(tabId, `page-${crypto.randomUUID()}.png`)
        return { screenshot: { id: crypto.randomUUID(), image: `data:image/png;base64,${image.data}` } } satisfies PageScreenshotResult
      } finally {
        await content(tabId, { type: 'visibility', hidden: false }).catch(() => {})
        if (attached) await chrome.debugger.detach({ tabId }).catch(() => {})
    await release?.().catch(() => {})
        busy.delete(tabId)
      }
    }
    case 'capture': return capture(sender.tab?.id ?? await activeTab(), message)
    default: throw new Error('Unknown capture action.')
  }
}

chrome.runtime.onMessage.addListener((message: WorkerMessage, sender, reply) => {
  handle(message, sender).then((value) => reply({ ok: true, value }), async (error) => {
    if (sender.tab?.id) await content(sender.tab.id, { type: 'capture-error', error: String(error?.message ?? error) }).catch(() => {})
    reply({ ok: false, error: String(error?.message ?? error) })
  })
  return true
})
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) void toggle(tab.id).catch(async (error) => {
    await chrome.action.setBadgeText({ text: '!' })
    await chrome.action.setTitle({ title: `${String(error?.message ?? error)} Open a regular web page and try again.` })
  })
})
chrome.commands.onCommand.addListener((name) => {
  if (name === 'toggle-select') activeTab().then(toggle).catch(async (error) => {
    await chrome.action.setBadgeText({ text: '!' })
    await chrome.action.setTitle({ title: String(error?.message ?? error) })
  })
})
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {})
chrome.storage.local.remove(['endpoint', 'token']).catch(() => {})

