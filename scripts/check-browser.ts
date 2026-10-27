// Native Agent Screen check: scratch homes, fake provider and one paced stream. No paid turn/build.
import { expect } from 'bun:test'
import path from 'node:path'
import { launch } from '@gpuix/react/automation'
import { browserPoint } from '../core/browser-stream'
import { present, remove, scratchDir } from './scratch'
const home = await scratchDir('vellum-browser-')
const env = { ...process.env, GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home'), VELLUM_BRIDGE_PORT: '0', VELLUM_AGENT: path.resolve(import.meta.dir, 'fake-acp.ts'), VELLUM_NOTIFY_LOG: path.join(home, 'notifications.log'), VELLUM_BROWSER_EXECUTABLE: path.resolve(import.meta.dir, 'fake-browser.ts'), VELLUM_BROWSER_FIXTURE_PORT: '' }
expect(await Bun.spawn([process.execPath, 'scripts/fixture.ts'], { env, stdout: 'ignore' }).exited).toBe(0)
const frame = (await Bun.file(path.resolve(import.meta.dir, '../assets/icon.png')).bytes()).toBase64()
const input: any[] = [], sockets = new Set<any>()
let opened = 0
const fake = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request, server) { return server.upgrade(request) ? undefined : new Response('stream') }, websocket: {
  open(socket) { opened++; sockets.add(socket); socket.send(JSON.stringify({ type: 'url', url: 'https://example.com/live' })); socket.send(JSON.stringify({ type: 'frame', seq: 1, data: frame, metadata: { deviceWidth: 800, deviceHeight: 600, timestamp: Date.now() } })) },
  message(_socket, message) { input.push(JSON.parse(String(message))) }, close(socket) { sockets.delete(socket) },
} })
env.VELLUM_BROWSER_FIXTURE_PORT = String(fake.port)
const app = await launch({ command: process.execPath, args: ['app.tsx'], env })
const until = async (check: () => Promise<boolean> | boolean, timeout = 8000) => { const start = Date.now(); while (!await check() && Date.now() - start < timeout) await Bun.sleep(80); expect(await check()).toBeTruthy() }
try {
  const composer = app.getByTestId('composer')
  await composer.waitFor({ timeoutMs: 60000 }); await until(() => present(path.join(home, 'bridge.json')))
  const pairing = await Bun.file(path.join(home, 'bridge.json')).json()
  const request = (route: string, init: RequestInit = {}) => fetch(`${pairing.endpoint}${route}`, { ...init, headers: { Authorization: `Bearer ${pairing.token}`, ...init.headers } })
  const notes = await (await request('/notes')).json(), note = notes.find((item: any) => item.active)
  let id = 0
  const call = async (name: string, args: object) => {
    const response = await request(`/mcp/${note.id}`, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }) })
    expect(response.status).toBe(200)
    return (await response.json()).result
  }
  const result = await call('browser', { args: ['screenshot'] })
  expect(result.isError, JSON.stringify(result)).toBe(false)
  await app.getByTestId('browser-open').waitFor(); await until(() => input.some(message => message.type === 'ack'))
  expect(sockets.size).toBe(1)
  await app.getByTestId('browser-input').click()
  expect(input.some(message => message.type === 'input_mouse')).toBe(false)
  await app.screenshot({ path: 'screenshots/agent-screen-card.png' })
  console.log('ok inline native frame and passive watch mode')
  const count = opened
  await app.getByTestId('browser-open').click(); await app.getByTestId('browser-viewer').waitFor()
  await until(() => input.some(message => message.type === 'config' && message.maxFps === 1))
  expect(opened).toBe(count)
  await app.screenshot({ path: 'screenshots/agent-screen-expanded.png' })
  await app.getByTestId('browser-viewer-close').click(); await app.getByTestId('agent-screen-inline').waitFor()
  expect(opened).toBe(count)
  console.log('ok inline/expanded share a connection; unfocused stream uses 1 FPS')
  await app.getByTestId('open-browser').click(); await app.getByTestId('browser-floating').waitFor()
  const header = app.getByTestId('browser-floating').getByTestId('browser-drag')
  const before = await app.getByTestId('browser-floating').bounds()
  await header.dragBy(-80, 70)
  const after = await app.getByTestId('browser-floating').bounds()
  expect(after.x).toBeLessThan(before.x); expect(after.y).toBeGreaterThan(before.y)
  expect(opened).toBe(count)
  await app.getByTestId('browser-minimize').click(); await until(() => sockets.size === 0)
  await call('browser', { args: ['snapshot', '-i'] }); await Bun.sleep(350)
  expect(await app.getByTestId('browser-floating').count()).toBe(0)
  expect(sockets.size).toBe(0)
  await app.getByTestId('open-browser').click(); await app.getByTestId('browser-floating').waitFor(); await until(() => sockets.size === 1)
  await app.getByTestId('browser-return-inline').click(); await app.getByTestId('agent-screen-inline').waitFor()
  console.log('ok title-bar drag, sticky minimize, reopen and return inline')
  expect(browserPoint({ x: 150, y: 100 }, { x: 50, y: 50, width: 400, height: 300 }, { width: 800, height: 600 })).toEqual({ x: 200, y: 100 })
  expect(browserPoint({ x: 5, y: 100 }, { x: 0, y: 0, width: 400, height: 300 }, { width: 100, height: 300 })).toBeUndefined()
  // A real fake-provider turn pushes the slot above view while a browser action is working.
  const waiting = call('browser', { args: ['wait', '7000'] })
  await Bun.sleep(150)
  await composer.fill('stream a long answer about the current browser task\n' + Array.from({ length: 20 }, (_, i) => `Context line ${i + 1}`).join('\n')); await composer.press('cmd-enter')
  await Bun.sleep(3000)
  await app.getByTestId('page').wheel(0, -1000)
  await app.getByTestId('browser-floating').waitFor({ timeoutMs: 6500 })
  await app.screenshot({ path: 'screenshots/agent-screen-floating.png' })
  await waiting
  await until(async () => await app.getByTestId('browser-floating').count() === 0)
  console.log('ok scrolling past an active browser auto-floats; completed standalone action minimizes')
  await call('browser_session', { action: 'disconnect' }); await until(() => sockets.size === 0)
  expect(await app.getByTestId('open-browser').count()).toBe(0)
  console.log('ok disconnect removes the live icon and closes the visual subscriber')
} catch (error) {
  await app.screenshot({ path: 'screenshots/agent-screen-error.png' })
  throw error
} finally { await app.close(); for (const socket of sockets) socket.close(); fake.stop(true); await remove(home) }
