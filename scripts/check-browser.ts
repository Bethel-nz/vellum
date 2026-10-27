// A native capture card and fake browser stream, in a background window and scratch home.
import { expect } from 'bun:test'
import path from 'node:path'
import { launch } from '@gpuix/react/automation'
import { browserPoint } from '../core/browser-stream'
import { present, remove, scratchDir } from './scratch'

const home = await scratchDir('vellum-browser-')
const env = { ...process.env, GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home'), VELLUM_BRIDGE_PORT: '0', VELLUM_AGENT: path.resolve(import.meta.dir, 'fake-acp.ts'), VELLUM_NOTIFY_LOG: path.join(home, 'notifications.log') }
expect(await Bun.spawn([process.execPath, 'scripts/fixture.ts'], { env, stdout: 'ignore' }).exited).toBe(0)
const log = path.join(home, 'fake-acp.log')
await Bun.write(log, '')
env.FAKE_ACP_LOG = log
const icon = await Bun.file(path.resolve(import.meta.dir, '../assets/icon.png')).bytes()
const frame = icon.toBase64()
const input: any[] = []
const sockets = new Set<any>()
const fake = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request, server) { return server.upgrade(request) ? undefined : new Response('stream') }, websocket: {
  open(socket) { sockets.add(socket); socket.send(JSON.stringify({ type: 'url', url: 'https://example.com/live' })); socket.send(JSON.stringify({ type: 'frame', seq: 1, data: frame, metadata: { deviceWidth: 800, deviceHeight: 600, timestamp: Date.now() } })) },
  message(_socket, message) { input.push(JSON.parse(String(message))) },
  close(socket) { sockets.delete(socket) },
} })
const app = await launch({ command: process.execPath, args: ['app.tsx'], env })
const until = async (check: () => Promise<boolean> | boolean, timeout = 8000) => { const start = Date.now(); while (!await check() && Date.now() - start < timeout) await Bun.sleep(100); expect(await check()).toBeTruthy() }
try {
  const composer = app.getByTestId('composer')
  await composer.waitFor({ timeoutMs: 60000 })
  await until(async () => await present(path.join(home, 'bridge.json')))
  const pairing = JSON.parse(await Bun.file(path.join(home, 'bridge.json')).text())
  const request = (route: string, init: RequestInit = {}) => fetch(`${pairing.endpoint}${route}`, { ...init, headers: { Authorization: `Bearer ${pairing.token}`, ...init.headers } })
  const notes: any[] = await (await request('/notes')).json() as any[]
  const note = notes.find((item) => item.active)!
  const data = { version: 1, id: 'native-card', createdAt: new Date().toISOString(), page: { url: 'https://example.com', title: 'Captured component', viewport: { w: 800, h: 600, dpr: 1 } }, elements: [{ ref: 'e1', selector: '.card', note: 'Use this spacing', html: '<div class="card">Example</div>', css: { padding: '24px' }, box: { x: 0, y: 0, w: 100, h: 50 }, animations: [], shots: { element: 'element.png' } }] }
  const body = new FormData()
  body.set('capture', JSON.stringify(data)); body.set('target', note.id); body.set('mode', 'queue'); body.set('image', new File([icon], 'element.png', { type: 'image/png' }))
  const uploaded = await request('/captures', { method: 'POST', body })
  expect(uploaded.status, await uploaded.text()).toBe(201)
  await app.getByTestId('capture-native-card').waitFor({ timeoutMs: 8000 })
  await app.getByTestId('open-annotations').click()
  await app.getByTestId('session-annotations').waitFor({ timeoutMs: 8000 })
  await app.screenshot({ path: 'screenshots/snapshot-desktop-annotations.png' })
  await app.getByTestId('capture-open-native-card').click()
  await app.getByTestId('capture-viewer').waitFor({ timeoutMs: 3000 })
  await app.screenshot({ path: 'screenshots/v2-capture.png' })
  await app.getByTestId('capture-viewer-close').click()
  console.log('ok  queued capture card, session annotations pen and full-window inspector')
  await composer.click(); await composer.press('cmd-,')
  await app.getByTestId('settings-go-browser').click()
  await app.getByTestId('browser-connection').waitFor({ timeoutMs: 3000 })
  await app.screenshot({ path: 'screenshots/v2-browser-settings.png' })
  await app.getByTestId('settings-done').click()
  console.log('ok  Browser settings automatic connection status')
  const response = await request('/browser', { method: 'POST', body: JSON.stringify({ noteId: note.id, session: `vellum-${note.id}`, streamPort: fake.port }) })
  expect(response.status, await response.text()).toBe(200)
  await app.getByTestId('browser-open').waitFor({ timeoutMs: 5000 })
  await until(() => input.some((message) => message.type === 'ack'))
  await Bun.sleep(500)
  await app.getByTestId('browser-input').click()
  await app.getByTestId('browser-control').waitFor({ timeoutMs: 3000 })
  await until(() => input.some((message) => message.type === 'config' && message.maxFps === 30))
  await app.getByTestId('browser-control').click()
  await app.getByTestId('browser-viewer').getByTestId('browser-input').click()
  await until(() => input.some((message) => message.type === 'input_mouse' && message.eventType === 'mousePressed'))
  const mouse = input.find((message) => message.type === 'input_mouse' && message.eventType === 'mousePressed')
  expect(mouse.x >= 0 && mouse.x < 800 && mouse.y >= 0 && mouse.y < 600).toBeTruthy()
  expect(browserPoint({ x: 150, y: 100 }, { x: 50, y: 50, width: 400, height: 300 }, { width: 800, height: 600 })).toStrictEqual({ x: 200, y: 100 })
  const held = new FormData()
  held.set('capture', JSON.stringify({ ...data, id: 'held-capture', elements: [{ ...data.elements[0], note: 'stream a brief answer about the capture' }] })); held.set('target', note.id); held.set('mode', 'send'); held.set('image', new File([icon], 'element.png', { type: 'image/png' }))
  expect((await request('/captures', { method: 'POST', body: held })).status).toBe(201)
  await Bun.sleep(600)
  expect(!(await Bun.file(log).text()).includes('I sent a browser capture')).toBeTruthy()
  console.log('ok  captures remain queued while the user drives')
  await app.screenshot({ path: 'screenshots/v2-browser.png' })
  await app.getByTestId('browser-viewer-close').click()
  console.log('ok  native image frames, URL, expanded pacing and scaled take-over input')
  await app.getByTestId('session-annotations').waitFor({ timeoutMs: 3000 })
  await app.getByText('Send to agent').click()
  await until(async () => (await Bun.file(log).text()).trim().split('\n').filter((line) => { try { return JSON.parse(line).in?.method === 'session/prompt' } catch { return false } }).length >= 2, 15000)
  const events = (await Bun.file(log).text()).trim().split('\n').map((line) => JSON.parse(line).in).filter(Boolean)
  expect(events.find((event) => event.method === 'session/new' || event.method === 'session/resume').params.mcpServers.some((server: any) => server.name === 'vellum')).toBeTruthy()
  console.log('ok  capture delivery uses the fake agent queue and attaches Vellum MCP')
} catch (error) {
  await app.screenshot({ path: 'screenshots/v2-browser-error.png' })
  console.log('browser button bounds', await app.getByTestId('browser-open').bounds().catch(() => null))
  throw error
} finally {
  await app.close()
  for (const socket of sockets) socket.close()
  fake.stop(true)
  await remove(home)
}
