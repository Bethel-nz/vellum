// Disposable Chrome profile and extension: never touches the user's Chrome profile.
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect } from 'bun:test'
const home = mkdtempSync(path.join(tmpdir(), 'vellum-browser-compat-'))
const binary = process.env.VELLUM_BROWSER_EXECUTABLE ?? '/opt/homebrew/Cellar/agent-browser/0.39.1/libexec/lib/node_modules/agent-browser/bin/agent-browser-darwin-arm64'
const chrome = '/Users/APPLE/.agent-browser/browsers/chrome-151.0.7922.71/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
const extension = path.join(home, 'extension'); mkdirSync(extension)
writeFileSync(path.join(extension, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Vellum disposable identity probe', version: '1.0', permissions: ['debugger', 'tabs'], background: { service_worker: 'worker.js' } }))
writeFileSync(path.join(extension, 'worker.js'), 'chrome.runtime.onInstalled.addListener(() => {}); setInterval(() => chrome.runtime.getPlatformInfo(), 10000)')
const site = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('<title>Identity fixture</title><h1>Two identical URLs</h1><button>Click me</button>', { headers: { 'Content-Type': 'text/html' } }) })
const url = `http://127.0.0.1:${site.port}`
const proc = Bun.spawn([chrome, '--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${home}/profile`, `--load-extension=${extension}`, `--disable-extensions-except=${extension}`, url], { stdout: 'ignore', stderr: Bun.file('/tmp/vellum-compat-chrome.log') })
const env: Record<string, string | undefined> = { ...process.env, AGENT_BROWSER_NAMESPACE: path.basename(home) }
for (const key of Object.keys(env)) if (key.startsWith('AGENT_BROWSER_') && key !== 'AGENT_BROWSER_NAMESPACE') delete env[key]
writeFileSync(path.join(home, 'config.json'), '{}')
const cli = async (args: string[]) => {
  const p = Bun.spawn([binary, '--session', 'compat', '--config', path.join(home, 'config.json'), ...args], { env, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
  let json: any; try { json = JSON.parse(stdout) } catch {}
  return { stdout, stderr, exitCode, json }
}
let ws: WebSocket | undefined
try {
  const portFile = path.join(home, 'profile/DevToolsActivePort')
  for (let i = 0; i < 100 && !await Bun.file(portFile).exists(); i++) await Bun.sleep(100)
  const port = Number(readFileSync(portFile, 'utf8').split('\n')[0])
  const version: any = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
  ws = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise<void>((resolve, reject) => { ws!.onopen = () => resolve(); ws!.onerror = reject })
  let id = 0
  const requests = new Map<number, { resolve: (v: any) => void; reject: (v: any) => void }>()
  ws.onmessage = event => { const message = JSON.parse(String(event.data)); const request = requests.get(message.id); if (!request) return; requests.delete(message.id); message.error ? request.reject(message.error) : request.resolve(message.result) }
  const cdp = (method: string, params: object = {}, sessionId?: string): Promise<any> => new Promise((resolve, reject) => { const requestId = ++id; requests.set(requestId, { resolve, reject }); ws!.send(JSON.stringify({ id: requestId, method, params, ...(sessionId ? { sessionId } : {}) })) })
  const second = await cdp('Target.createTarget', { url, newWindow: true })
  let targets: any[] = []
  for (let i = 0; i < 50; i++) { targets = (await cdp('Target.getTargets')).targetInfos; if (targets.some(t => t.type === 'service_worker' && t.url.endsWith('/worker.js'))) break; await Bun.sleep(100) }
  const worker = targets.find(target => target.type === 'service_worker' && target.url.endsWith('/worker.js'))
  if (!worker) throw new Error('Probe extension worker unavailable')
  const attached = await cdp('Target.attachToTarget', { targetId: worker.targetId, flatten: true })
  const evaluate = async (expression: string) => {
    const response = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, attached.sessionId)
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails))
    return response.result.value
  }
  await cdp('Runtime.enable', {}, attached.sessionId)
  let ready = false
  for (let i = 0; i < 50; i++) { ready = await evaluate('Boolean(globalThis.chrome?.debugger?.getTargets)'); if (ready) break; await Bun.sleep(100) }
  if (!ready) throw new Error('Extension debugger API unavailable: ' + JSON.stringify(await evaluate('({id:chrome.runtime?.id, manifest:chrome.runtime?.getManifest?.()})')))
  const extensionTargets = await evaluate('chrome.debugger.getTargets()')
  const duplicate = extensionTargets.filter((target: any) => target.type === 'page' && target.url.replace(/\/$/, '') === url)
  expect(duplicate).toHaveLength(2)
  expect(duplicate.some((target: any) => target.id === second.targetId)).toBe(true)
  expect(duplicate[0].tabId).not.toBe(duplicate[1].tabId)
  const selected = duplicate.find((target: any) => target.id === second.targetId)
  console.log('PASS exact chrome.debugger target IDs match CDP across windows with duplicate URLs')
  expect((await cli(['connect', String(port), '--json'])).exitCode).toBe(0)
  const select = await cli(['tab', selected.id, '--pin-tab', '--json'])
  expect(select.exitCode, select.stderr + select.stdout).toBe(0)
  const snap = await cli(['snapshot', '-i', '--json']); expect(snap.exitCode, snap.stdout).toBe(0)
  await evaluate(`chrome.debugger.attach({tabId:${selected.tabId}}, '1.3').then(() => true)`)
  expect((await cli(['snapshot', '-i', '--json'])).exitCode).toBe(0)
  await evaluate(`chrome.debugger.sendCommand({tabId:${selected.tabId}}, 'Page.captureScreenshot', {format:'png'}).then(r => r.data.length > 100)`)
  await evaluate(`chrome.debugger.detach({tabId:${selected.tabId}}).then(() => true)`)
  expect((await cli(['snapshot', '-i', '--json'])).exitCode).toBe(0)
  console.log('PASS Snapshot debugger attachment/capture/detach coexists with agent-browser CDP')
  const stream = await cli(['stream', 'status', '--json']); expect(stream.exitCode).toBe(0)
  console.log('Stream status', JSON.stringify(stream.json))
  const streamPort = stream.json.data.port
  const streamSocket = new WebSocket(`ws://127.0.0.1:${streamPort}/?pacing=ack&maxFps=4`)
  const types = new Set<string>()
  const metadata: any[] = []
  streamSocket.onmessage = event => { const message = JSON.parse(String(event.data)); types.add(message.type); if (message.type === 'frame') { if (!metadata.length) metadata.push(message.metadata); streamSocket.send(JSON.stringify({ type: 'ack', seq: message.seq })) } }
  await Bun.sleep(1800); streamSocket.close()
  expect(types.has('frame')).toBe(true)
  console.log('Stream message types', [...types], 'metadata', metadata[0])
  await cdp('Target.closeTarget', { targetId: selected.id })
  const gone = await cli(['snapshot', '-i', '--json'])
  expect(gone.exitCode).not.toBe(0); expect(gone.stdout).toMatch(/tab_gone|Session with given id not found/)
  const retry = await cli(['snapshot', '-i', '--json']); expect(retry.exitCode).not.toBe(0); console.log('PASS pinned target loss fails without switching targets', retry.stdout.trim())
  expect((await cli(['close', '--json'])).exitCode).toBe(0)
  const remaining = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as any[]
  expect(remaining.some(target => target.type === 'page')).toBe(true)
  console.log('PASS external close detaches without closing Chrome or remaining tabs')
  process.env.VELLUM_HOME = path.join(home, 'vellum')
  const { updateSettings } = await import('../core/store')
  updateSettings({ browserCdpPorts: [port] })
  const { recordToolbarPresence } = await import('../core/browser-targets')
  const runtime = await import('../core/browser-runtime')
  const first = duplicate.find((target: any) => target.id !== selected.id)
  recordToolbarPresence({ installationId: 'probe', toolbarId: 'probe', tabId: first.tabId, windowId: 1, targetId: first.id, url, title: 'Fixture', open: true })
  const targetKey = `probe:${first.tabId}:probe`
  await runtime.browserSession('probe-a', { action: 'connect', mode: 'toolbar', targetKey })
  const context = () => ({ signal: new AbortController().signal })
  expect((await runtime.browserCommand('probe-a', { args: ['snapshot', '-i'] }, context())).exitCode).toBe(0)
  await expect(runtime.browserSession('probe-b', { action: 'connect', mode: 'toolbar', targetKey })).rejects.toThrow('target_in_use')
  await runtime.requestBrowserControl('probe-a')
  let moved = false
  const transfer = runtime.moveBrowserTarget('probe-b', targetKey).then(() => { moved = true })
  await Bun.sleep(250); expect(moved).toBe(false)
  await runtime.releaseBrowserControl('probe-a'); await transfer
  expect((await runtime.browserCommand('probe-b', { args: ['snapshot', '-i'] }, context())).exitCode).toBe(0)
  const capture = await runtime.acquireBrowserCapture('probe', first.tabId)
  await expect(runtime.browserCommand('probe-b', { args: ['snapshot'] }, context())).rejects.toThrow('control')
  await evaluate(`chrome.debugger.attach({tabId:${first.tabId}}, '1.3').then(() => true)`)
  await evaluate(`chrome.debugger.sendCommand({tabId:${first.tabId}}, 'Page.captureScreenshot', {format:'png'}).then(r => r.data.length > 100)`)
  await evaluate(`chrome.debugger.detach({tabId:${first.tabId}}).then(() => true)`)
  await runtime.releaseBrowserCapture(capture.lease!)
  await runtime.stopBrowserSession('probe-b')
  expect(((await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as any[]).some((t: any) => t.id === first.id)).toBe(true)
  console.log('PASS host exclusive claims, control-blocked transfer, capture lease and external cleanup')
  const managed = await runtime.browserCommand('probe-managed', { args: ['open', url] }, context())
  expect(managed.exitCode, managed.stderr + managed.stdout).toBe(0)
  const captureResult = await runtime.browserCommand('probe-managed', { args: ['screenshot'] }, context())
  expect(captureResult.exitCode, captureResult.stderr + captureResult.stdout).toBe(0)
  expect(captureResult.artifacts).toHaveLength(1)
  await runtime.stopBrowserSession('probe-managed')
  console.log('PASS managed runtime open/screenshot artifact and awaited cleanup')
} finally {
  await cli(['close', '--json']).catch(() => {})
  ws?.close(); proc.kill(); await proc.exited; site.stop(true); rmSync(home, { recursive: true, force: true })
}
