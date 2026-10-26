import { bridgePort as defaultBridgePort, bridgePortCount } from '../../core/capture'
import type { Capture } from '../../core/capture'
import type { CaptureSettings, Upload } from './messages'

type Connection = { endpoint: string; token: string }
let connection: Connection | undefined
let connecting: Promise<Connection> | undefined
const unavailable = () => new Error('Queue unavailable. Try sending again.')
const defaultUrl = 'http://127.0.0.1'

export async function settings(): Promise<CaptureSettings> {
  const saved = await chrome.storage.local.get(['target', 'mode', 'url', 'port'])
  return { target: saved.target || 'active', mode: saved.mode === 'queue' ? 'queue' : 'send', url: validUrl(saved.url) ?? defaultUrl, port: validPort(saved.port) ?? defaultBridgePort }
}

function validUrl(value: unknown) {
  if (typeof value !== 'string') return
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.port || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) return
    return parsed.origin
  } catch { return }
}

function validPort(value: unknown): number | undefined {
  const port = Number(value)
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined
}

export async function saveBridgeSettings(url: string, port: number) {
  const normalizedUrl = validUrl(url)
  const normalizedPort = validPort(port)
  if (!normalizedUrl || !normalizedPort) throw new Error('Use a loopback URL and a port from 1 to 65535.')
  await chrome.storage.local.set({ url: normalizedUrl, port: normalizedPort })
  connection = undefined
  return { url: normalizedUrl, port: normalizedPort }
}

async function discover(): Promise<Connection> {
  const config = await settings()
  const probe = async (port: number): Promise<Connection | undefined> => {
    const endpoint = `${config.url}:${port}`
    try {
      const response = await fetch(`${endpoint}/connect`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Vellum-Extension': chrome.runtime.id },
        body: '{}', signal: AbortSignal.timeout(800), redirect: 'error',
      })
      if (!response.ok) return
      const result = await response.json()
      const announced = typeof result.endpoint === 'string' ? new URL(result.endpoint) : undefined
      if (result.version === 1 && announced?.protocol === 'http:' && announced.hostname === '127.0.0.1' && Number(announced.port) === port && typeof result.token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(result.token)) return { endpoint, token: result.token }
    } catch { /* Closed ports and older app instances are skipped. */ }
  }
  const primary = await probe(config.port)
  if (primary) return primary
  // The desktop uses a nearby port if its usual one is already occupied.
  const nearby = await Promise.all(Array.from({ length: Math.min(bridgePortCount - 1, 65535 - config.port) }, (_, index) => probe(config.port + index + 1)))
  const found = nearby.find((result) => result !== undefined)
  if (!found) throw unavailable()
  return found
}

async function connect(): Promise<Connection> {
  if (connection) return connection
  connecting ??= discover().then((found) => { connection = found; return found }).finally(() => { connecting = undefined })
  return connecting
}

export async function bridge<T>(route: string, init: RequestInit = {}): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const config = await connect()
    let response: Response
    try {
      response = await fetch(`${config.endpoint}${route}`, { ...init, headers: { ...init.headers, Authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(20_000), redirect: 'error' })
    } catch {
      connection = undefined
      throw unavailable()
    }
    if (response.status === 401 && attempt === 0) { connection = undefined; continue }
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      throw new Error(body?.error || `Vellum returned ${response.status}.`)
    }
    return response.json()
  }
  throw unavailable()
}

export async function uploadCapture(capture: Capture, files: Upload[], mode?: 'queue') {
  const config = await settings()
  const form = new FormData()
  form.set('capture', JSON.stringify(capture))
  form.set('target', config.target)
  form.set('mode', mode ?? config.mode)
  for (const file of files) {
    const bytes = Uint8Array.from(atob(file.data), (char) => char.charCodeAt(0))
    form.append(file.name, new Blob([bytes], { type: file.mime }), file.name)
  }
  return bridge('/captures', { method: 'POST', body: form })
}
