// One-off: restyled Agent Screen against a fake browser stream. Shots: screenshots/agent-screen-*.png
import path from 'node:path'
import { launch } from '@gpuix/react/automation'
import { present, scratchDir } from '/Users/APPLE/dev/vellum/scripts/scratch'

const home = await scratchDir('vellum-agent-screen-')
const env = { ...process.env, GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home'), VELLUM_BRIDGE_PORT: '0', VELLUM_AGENT: path.resolve('/Users/APPLE/dev/vellum/scripts', 'fake-acp.ts'), FAKE_ACP_LOG: path.join(home, 'fake-acp.log') }
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env, stdout: 'ignore' }).exited
await Bun.write(env.FAKE_ACP_LOG, '')
const icon = await Bun.file('/Users/APPLE/dev/vellum/assets/icon.png').bytes()
const frame = icon.toBase64()
const fake = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: (request, server) => server.upgrade(request) ? undefined : new Response('stream', { status: 404 }), websocket: {
  open(socket) { socket.send(JSON.stringify({ type: 'url', url: 'https://example.com/agent' })); socket.send(JSON.stringify({ type: 'frame', seq: 1, data: frame, metadata: { deviceWidth: 1280, deviceHeight: 800, timestamp: Date.now() } })) },
  message() {}, close() {},
} })
const app = await launch({ command: 'bun', args: ['app.tsx'], env })
try {
  const composer = app.getByTestId('composer')
  await composer.waitFor({ timeoutMs: 60_000 })
  await (async () => { while (!(await present(path.join(home, 'bridge.json')))) await Bun.sleep(150) })()
  const pairing = JSON.parse(await Bun.file(path.join(home, 'bridge.json')).text())
  const request = (route: string, init: RequestInit = {}) => fetch(`${pairing.endpoint}${route}`, { ...init, headers: { Authorization: `Bearer ${pairing.token}`, ...init.headers } })
  const notes = await (await request('/notes')).json() as any[]
  const note = notes.find((item) => item.active)!
  const posted = await request('/browser', { method: 'POST', body: JSON.stringify({ noteId: note.id, session: `vellum-${note.id}`, streamPort: fake.port }) })
  console.log('browser session:', posted.status)
  await app.getByTestId('browser-slot-vellum-' + note.id).waitFor({ timeoutMs: 10_000 }).catch(async () => {
    // legacy generations name the slot by generation; fall back to any agent-screen-inline
    await app.getByTestId('agent-screen-inline').waitFor({ timeoutMs: 5000 })
  })
  await Bun.sleep(800)
  await app.screenshot({ path: '/Users/APPLE/dev/vellum/screenshots/agent-screen-card.png' })
  // The strip's Agent Screen button reopens the pane; the resting card's Open expands.
  await app.getByTestId('agent-screen-inline').getByTestId('browser-open').click()
  await app.getByTestId('browser-viewer').waitFor({ timeoutMs: 5000 })
  await Bun.sleep(600)
  await app.screenshot({ path: '/Users/APPLE/dev/vellum/screenshots/agent-screen-expanded.png' })
  await app.getByTestId('browser-viewer-close').click()
  await Bun.sleep(400)
  await app.getByTestId('open-browser').click().catch(() => {})
  await app.getByTestId('agent-screen-side').waitFor({ timeoutMs: 5000 }).catch(e => console.log('side pane:', String(e).slice(0, 80)))
  await Bun.sleep(600)
  await app.screenshot({ path: '/Users/APPLE/dev/vellum/screenshots/agent-screen-side.png' })
  console.log('SHOT-DONE')
} finally { await app.close() }
