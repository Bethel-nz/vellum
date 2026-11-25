import type { Capture } from '../../core/capture'
import { assembler, chunks, nativeHost, type NativeChunk, type NativeRequest, type NativeResponse } from '../../core/native-protocol'
import type { CaptureSettings, Upload } from './messages'

// Vellum's native host relays to the app; Chrome starts it only for this extension, so there is no port or token here.
const unavailable = () => new Error('Disconnected')
let port: chrome.runtime.Port | undefined
let idle: ReturnType<typeof setTimeout> | undefined
const waiting = new Map<string, { resolve: (value: NativeResponse) => void; reject: (error: Error) => void }>()

export async function settings(): Promise<CaptureSettings> {
  const saved = await chrome.storage.local.get(['target', 'mode'])
  return { target: typeof saved.target === 'string' ? saved.target : 'active', mode: saved.mode === 'queue' ? 'queue' : 'send' }
}

function open() {
  if (port) return port
  const take = assembler()
  const opened = chrome.runtime.connectNative(nativeHost)
  opened.onMessage.addListener((chunk: NativeChunk) => {
    const whole = take(chunk)
    if (!whole) return
    waiting.get(chunk.id)?.resolve(whole.value as NativeResponse)
    waiting.delete(chunk.id)
  })
  // A missing host, or the host exiting, rejects everything still in flight.
  opened.onDisconnect.addListener(() => {
    if (port === opened) port = undefined
    for (const request of waiting.values()) request.reject(unavailable())
    waiting.clear()
  })
  port = opened
  return opened
}

// An open native port keeps the service worker alive, so it closes once nothing has used it for a while.
function rest() {
  clearTimeout(idle)
  idle = setTimeout(() => { if (!waiting.size) { port?.disconnect(); port = undefined } else rest() }, 30_000)
}

function relay(request: NativeRequest) {
  return new Promise<NativeResponse>((resolve, reject) => {
    const id = crypto.randomUUID()
    const timer = setTimeout(() => { waiting.delete(id); reject(unavailable()) }, 60_000)
    waiting.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value) }, reject: (error) => { clearTimeout(timer); reject(error) } })
    try { const target = open(); for (const chunk of chunks(id, request)) target.postMessage(chunk) }
    catch { waiting.delete(id); clearTimeout(timer); reject(unavailable()) }
    rest()
  })
}

async function call<T>(request: NativeRequest): Promise<T> {
  const response = await relay(request)
  if ('error' in response) throw unavailable()
  const body = (() => { try { return JSON.parse(response.body) } catch { return null } })()
  if (response.status < 200 || response.status >= 300) throw new Error(body?.error || `Vellum returned ${response.status}.`)
  return body as T
}

export function bridge<T>(route: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<T> {
  return call<T>({ route, method: init.method, body: init.body, ...(init.body ? { headers: { 'Content-Type': 'application/json' } } : {}) })
}

export async function uploadCapture(capture: Capture, files: Upload[], mode?: 'queue') {
  const config = await settings()
  return call({ route: '/captures', method: 'POST', form: { fields: { capture: JSON.stringify(capture), target: config.target, mode: mode ?? config.mode }, files } })
}
