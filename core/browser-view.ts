import type { BrowserKey, BrowserPlacement } from './browser-types'
import { BrowserStream, type BrowserFrame, type BrowserStreamStatus } from './browser-stream'
import { hasBrowserControl, subscribeBrowserRuntime, validateBrowser, verifyBrowserConnection } from './browser-runtime'
import type { BrowserInput, StreamKeyboardInput, StreamMouseInput } from './stream-protocol'

export type BrowserViewState = { status: BrowserStreamStatus; url?: string }
export type BrowserViewSubscriber = { frame: (frame: BrowserFrame) => boolean | void; state: (state: BrowserViewState) => void }
type Controller = { key: BrowserKey; stream?: BrowserStream; last?: BrowserFrame; state: BrowserViewState; subscribers: Set<BrowserViewSubscriber>; demand: { placement: BrowserPlacement; visible: boolean; focused: boolean }; closeTimer?: ReturnType<typeof setTimeout>; keys: Map<string, StreamKeyboardInput>; buttons: Map<NonNullable<StreamMouseInput['button']>, { x: number; y: number }> }
const views = new Map<string, Controller>()
export const browserKey = (key: BrowserKey) => `${key.noteId}/${key.session}/${key.generation}`
function controller(key: BrowserKey) {
  const id = browserKey(key)
  let view = views.get(id)
  if (!view) { view = { key, state: { status: 'connecting' }, subscribers: new Set(), demand: { placement: 'inline', visible: true, focused: true }, keys: new Map(), buttons: new Map() }; views.set(id, view) }
  return view
}
function pace(view: Controller) {
  const session = validateBrowser(view.key)
  const live = session && session.streamPort > 0 && view.demand.placement !== 'minimized' && view.demand.visible && view.subscribers.size > 0
  if (!live) { releaseBrowserInput(view.key); view.stream?.close(); view.stream = undefined; return }
  const fps = !view.demand.focused ? 1 : view.demand.placement === 'expanded' ? hasBrowserControl(view.key) ? 60 : 30 : view.demand.placement === 'floating' ? 15 : 10
  if (!view.stream) view.stream = new BrowserStream(session.streamPort, frame => {
    view.last = frame
    const subscriber = [...view.subscribers].at(-1)
    return subscriber ? subscriber.frame(frame) : false
  }, (status, url) => {
    if (view.state.status === status && (!url || view.state.url === url)) return
    view.state = { status, url: url ?? view.state.url }
    for (const subscriber of view.subscribers) subscriber.state(view.state)
  }, () => Boolean(validateBrowser(view.key)), () => { view.keys.clear(); view.buttons.clear() }, () => verifyBrowserConnection(view.key), fps)
  view.stream.configure(fps)
}
export function watchBrowser(key: BrowserKey, subscriber: BrowserViewSubscriber) {
  const view = controller(key)
  clearTimeout(view.closeTimer)
  view.subscribers.add(subscriber); subscriber.state(view.state)
  if (view.last) subscriber.frame(view.last)
  pace(view); view.stream?.resume()
  return () => { view.subscribers.delete(subscriber); view.closeTimer = setTimeout(() => { if (!view.subscribers.size) { releaseBrowserInput(key); view.stream?.close(); view.stream = undefined } }, 150) }
}
export function setBrowserDemand(key: BrowserKey, demand: Controller['demand']) { const view = controller(key); view.demand = demand; pace(view) }
export function lastBrowserFrame(key: BrowserKey) { return views.get(browserKey(key))?.last }
export function heldBrowserButton(key: BrowserKey) { return [...(views.get(browserKey(key))?.buttons.keys() ?? [])].at(-1) }
export function sendBrowserInput(key: BrowserKey, input: BrowserInput) {
  if (!hasBrowserControl(key)) return
  const view = views.get(browserKey(key))
  if (!view?.stream || view.state.status !== 'live' || !view.demand.focused) return
  if (input.type === 'input_keyboard' && typeof input.key === 'string') {
    const id = input.code || input.key
    if (input.eventType === 'keyDown') view.keys.set(id, input)
    if (input.eventType === 'keyUp') view.keys.delete(id)
  }
  if (input.type === 'input_mouse' && typeof input.button === 'string') {
    if (input.eventType === 'mousePressed') view.buttons.set(input.button, { x: Number(input.x), y: Number(input.y) })
    if (input.eventType === 'mouseReleased') view.buttons.delete(input.button)
  }
  if (input.type === 'input_mouse' && input.eventType === 'mouseMoved') for (const button of view.buttons.keys()) view.buttons.set(button, { x: Number(input.x), y: Number(input.y) })
  view.stream.send(input)
}
export function releaseBrowserInput(key: BrowserKey) {
  const view = views.get(browserKey(key))
  if (!view) return
  for (const input of view.keys.values()) view.stream?.send({ ...input, eventType: 'keyUp', modifiers: 0 })
  for (const [button, point] of view.buttons) view.stream?.send({ type: 'input_mouse', eventType: 'mouseReleased', button, ...point, clickCount: 1 })
  view.keys.clear(); view.buttons.clear()
}
subscribeBrowserRuntime(() => { for (const view of views.values()) pace(view) })
