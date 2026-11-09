// Boundary checks use a scratch home and never start a paid agent or a desktop window.
import { expect } from 'bun:test'
import path from 'node:path'
import { remove, scratchDir } from './scratch'

const home = await scratchDir('vellum-bridge-')
process.env.VELLUM_HOME = home
process.env.VELLUM_CLAUDE_HOME = path.join(home, 'claude')
process.env.VELLUM_BRIDGE_PORT = '0'
const { createBridge } = await import('../core/bridge')
const { extensionId } = await import('../core/capture')
const { appendRecord, newThread, reduce, readThread } = await import('../core/threads')
const { readCapture } = await import('../core/captures')
const { trashNote, restoreNote } = await import('../core/trash')
const { paths } = await import('../core/store')
const notes = ['note-one', 'note-two'].map((id) => ({ id, title: id, workspace: home, profileId: 'default', createdAt: new Date().toISOString() }))
const threads = new Map(notes.map((meta) => { appendRecord(meta.id, { type: 'vellum/meta', meta }); return [meta.id, newThread(meta)] }))
const sent: unknown[] = []
const bridge = createBridge({ notes: () => notes.map((note) => ({ ...note, account: 'Default', active: note.id === 'note-one' })), record: (id, record) => { appendRecord(id, record); threads.set(id, reduce(threads.get(id)!, record)) }, deliver: (...args) => { sent.push(args) } })
const pair = bridge.pairing()
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jz1kAAAAASUVORK5CYII=', 'base64')
const capture = (id: string) => ({ version: 1, id, createdAt: new Date().toISOString(), page: { url: 'https://example.com/', title: 'Fixture', viewport: { w: 800, h: 600, dpr: 1 } }, elements: [{ ref: 'e1', selector: '#card', note: 'Rebuild this card', html: '<div id="card">Page data</div>', css: { color: 'red' }, box: { x: 0, y: 0, w: 100, h: 50 }, animations: [], shots: { element: 'card.png' } }] })
const request = (route: string, init: RequestInit = {}, token = pair.token) => fetch(`${pair.endpoint}${route}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } })
const upload = (id: string, extra: { target?: string; mode?: string; filename?: string } = {}) => {
  const body = new FormData()
  const data = capture(id)
  if (extra.filename) data.elements[0]!.shots.element = extra.filename
  body.set('capture', JSON.stringify(data)); body.set('target', extra.target || 'active'); body.set('mode', extra.mode || 'queue')
  body.set('image', new File([png], extra.filename || 'card.png', { type: 'image/png' }))
  return request('/captures', { method: 'POST', body, headers: { Origin: `chrome-extension://${extensionId}` } })
}
const call = async (noteId: string, name: string, args: unknown = {}) => {
  const agent = bridge.agent(noteId)
  const response = await request(`/mcp/${noteId}`, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }, agent.token)
  return response.json() as Promise<any>
}
const ok = (name: string) => console.log(`ok  ${name}`)
try {
  expect((await fetch(`${pair.endpoint}/health`)).status).toBe(401)
  expect((await request('/health', {}, 'wrong')).status).toBe(401)
  expect((await request('/health', { headers: { Origin: 'https://example.com' } })).status).toBe(403)
  expect((await request('/health', { headers: { Origin: `chrome-extension://${extensionId}` } })).status).toBe(200)
  expect((await fetch(`${pair.endpoint}/connect`, { method: 'POST' })).status).toBe(403)
  expect((await fetch(`${pair.endpoint}/connect`, { method: 'POST', headers: { Origin: 'https://example.com', 'X-Vellum-Extension': extensionId } })).status).toBe(403)
  expect((await fetch(`${pair.endpoint}/connect`, { method: 'POST', headers: { Origin: `chrome-extension://${extensionId}` } })).status).toBe(403)
  const automatic = await fetch(`${pair.endpoint}/connect`, { method: 'POST', headers: { Origin: `chrome-extension://${extensionId}`, 'X-Vellum-Extension': extensionId } })
  expect(automatic.status).toBe(200)
  expect((await automatic.json() as { token: string }).token).toBe(pair.token)
  ok('authentication and exact extension Origin')
  expect((await upload('queued')).status).toBe(201)
  expect(threads.get('note-one')!.blocks[0]?.kind).toBe('capture')
  expect(sent.length).toBe(0)
  expect((await upload('queued')).status).toBe(400)
  expect((await upload('invalid', { filename: '../outside.png' })).status).toBe(400)
  expect((await upload('missing', { target: 'missing' })).status).toBe(404)
  ok('uploads persist in the selected note, reject duplicates and path traversal')
  const agent = bridge.agent('note-one')
  expect((await request('/notes', {}, agent.token)).status).toBe(403)
  expect((await request('/mcp/note-two', { method: 'POST', body: '{}' }, agent.token)).status).toBe(403)
  expect((await call('note-two', 'vellum_get_capture', { id: 'queued' })).result.isError).toBe(true)
  const pending = await call('note-one', 'vellum_pending')
  expect(JSON.parse(pending.result.content[0].text)[0].id).toBe('queued')
  const compact = await call('note-one', 'vellum_get_capture', { id: 'queued' })
  expect(compact.result.content).toHaveLength(1)
  const compactJson = compact.result.content[0].text.match(/```json\r?\n([\s\S]*?)\r?\n```/)?.[1]
  expect(compactJson).toBeDefined()
  const compactData = JSON.parse(compactJson!)
  expect(compactData.capture.compact).toBe(true)
  expect(JSON.stringify(compactData)).not.toContain('"ref"')
  expect(compactData.directory).toBe(path.join(paths.captures, 'note-one', 'queued'))
  const full = await call('note-one', 'vellum_get_capture', { id: 'queued', full: true, images: true })
  expect(full.result.content[1].type).toBe('image')
  expect(full.result.content[0].text.includes('"css":{"color":"red"}')).toBeTruthy()
  expect(readCapture('note-one', 'queued')!.status).toBe('acknowledged')
  const began = Date.now()
  await call('note-two', 'vellum_watch', { timeoutSec: 0 })
  expect(Date.now() - began < 1000).toBeTruthy()
  const watching = call('note-two', 'vellum_watch', { timeoutSec: 2 })
  await upload('watched', { target: 'note-two' })
  expect(JSON.parse((await watching).result.content[0].text)[0].id).toBe('watched')
  await call('note-one', 'vellum_resolve', { id: 'queued', summary: 'Done' })
  expect(readCapture('note-one', 'queued')!.status).toBe('resolved')
  ok('MCP note isolation, images, acknowledge, watch and resolve')
  expect((await upload('sent', { mode: 'send' })).status).toBe(201)
  expect(sent.length).toBe(1)
  expect(readCapture('note-one', 'sent')!.status).toBe('queued')
  expect(readCapture('note-one', 'sent')!.delivery).toBe('send')
  expect((await readThread(path.join(paths.threads, 'note-one.jsonl')))!.blocks.filter((block) => block.kind === 'capture').length).toBe(2)
  ok('send delivery and replay update one block per capture')
  const child = Bun.spawn([process.execPath, path.join(import.meta.dir, 'vellum-mcp.ts')], { env: { ...process.env, VELLUM_NOTE_ID: 'note-one', VELLUM_BRIDGE: agent.endpoint, VELLUM_TOKEN: agent.token }, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list' })}\n`)
  child.stdin.end()
  const stdio = await new Response(child.stdout).text()
  expect(await child.exited).toBe(0)
  // The vellum tools on every platform, plus the mobile ones where a simulator can run.
  const { mobileSupported } = await import('../core/mobile')
  expect(JSON.parse(stdio).result.tools.map((tool: { name: string }) => tool.name)).toEqual([
    'vellum_pending', 'vellum_get_capture', 'vellum_watch', 'vellum_resolve', 'vellum_dismiss', 'vellum_reply',
    ...(mobileSupported ? ['mobile_snapshot', 'mobile_screenshot', 'mobile_tap', 'mobile_steps', 'mobile_apps', 'mobile_configure', 'mobile_notify', 'mobile_reset', 'mobile_connection', 'mobile_input', 'mobile_inspect'] : []),
    'browser', 'browser_session',
  ])
  ok('stdio MCP adapter round trip')
  const events = await request('/events')
  const reader = events.body!.getReader()
  await reader.read()
  const rotated = bridge.rotate()
  expect((await request('/health')).status).toBe(401)
  expect((await request('/health', {}, rotated.token)).status).toBe(200)
  expect((await reader.read()).done).toBe(true)
  ok('token rotation closes existing event streams')
  expect(trashNote(notes[0]!)).toBe(true)
  expect((await restoreNote('note-one'))!.blocks.filter((block) => block.kind === 'capture').length).toBe(2)
  expect(readCapture('note-one', 'queued')!.status).toBe('resolved')
  expect(JSON.parse(await Bun.file(path.join(home, 'bridge.json')).text()).endpoint).toBe(pair.endpoint)
  ok('capture files follow trash and restore')
  const recovered: unknown[] = []
  const restarted = createBridge({ notes: () => notes.map((note) => ({ ...note, account: 'Default', active: true })), record: () => {}, deliver: (...args) => { recovered.push(args) } })
  try { restarted.recover(); restarted.recover(); expect(recovered.length).toBe(1); restarted.update('note-one', 'sent', { status: 'acknowledged', delivery: 'sent' }); expect(readCapture('note-one', 'sent')!.delivery).toBe('sent') } finally { restarted.stop() }
  ok('requested sends survive restart and recovery does not duplicate queue items')
} finally { bridge.stop(); await remove(home) }
