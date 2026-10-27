// Self-check for the mobile view (ui/MobileView.tsx) on a real simulator: it connects and
// draws the phone in its frame with the button pill; an agent's mobile_* tools (core/bridge.ts)
// see, tap and configure the phone through the bridge; a drag that leaves the screen stays the
// phone's (the window cover takes it) until the lift; and the pane's edge resizes it within bounds.
// Shots: screenshots/mobile-*.png.
//   VELLUM_MOBILE_UDID=<booted simulator> bun scripts/check-mobile.ts
import path from 'node:path'
import { launch } from '@gpuix/react/automation'
import { remove, scratchDir } from './scratch'

const udid = process.env.VELLUM_MOBILE_UDID
if (!udid) {
  console.error('usage: VELLUM_MOBILE_UDID=<booted simulator udid> bun scripts/check-mobile.ts')
  process.exit(2)
}
const home = await scratchDir('vellum-mobile-')
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } }).exited
const settings = path.join(home, 'settings.json')
await Bun.write(settings, JSON.stringify({ ...(await Bun.file(settings).json()), mobileView: true, mobileDevice: udid }))

let failed = 0
const expect = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) failed++
}
const app = await launch({ command: 'bun', args: ['app.tsx'], env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home'), VELLUM_BRIDGE_PORT: '0' } })
try {
  await app.getByTestId('composer').waitFor({ timeoutMs: 60_000 })
  await app.getByTestId('mobile-view').waitFor({ timeoutMs: 10_000 })
  // The device list loads from simctl after the view mounts; Connect is disabled until then.
  for (let i = 0; i < 40 && !(await app.getByTestId('mobile-connect').textContent()).match(/Connect|Boot/); i++) await Bun.sleep(250)
  for (let i = 0; i < 40 && (await app.getByTestId('mobile-device').textContent()) === 'iPhone'; i++) await Bun.sleep(250)
  await Bun.sleep(300)
  await app.getByTestId('mobile-connect').click()
  const deadline = Date.now() + 45_000
  let caption = ''
  while (Date.now() < deadline && !/^Connected$/.test(caption)) {
    await Bun.sleep(500)
    caption = await app.getByTestId('mobile-view').textContent()
    caption = caption.includes('Connected') ? 'Connected' : caption
  }
  expect('connects to the simulator', caption === 'Connected', caption)
  await Bun.sleep(1500)
  await app.screenshot({ path: 'screenshots/mobile-connected.png' })
  const frame = await app.getByTestId('mobile-frame').bounds()
  const screen = await app.getByTestId('mobile-screen').bounds()
  expect('the phone sits inside its frame', screen.x > frame.x && screen.y > frame.y && screen.x + screen.width < frame.x + frame.width)
  expect('the buttons share one pill', (await app.getByTestId('mobile-controls').count()) === 1 && (await app.getByTestId('mobile-switcher').count()) === 1)

  // The agent's tools, as the note's MCP client calls them (the owner token reaches any note).
  const { endpoint, token } = await Bun.file(path.join(home, 'bridge.json')).json()
  const rpc = async (method: string, params: unknown) => (await (await fetch(`${endpoint}/mcp/check`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json()) as any
  const names = (await rpc('tools/list', {})).result.tools.map((tool: { name: string }) => tool.name)
  expect('agents get the mobile tools', ['mobile_snapshot', 'mobile_tap', 'mobile_steps', 'mobile_apps', 'mobile_configure', 'mobile_notify', 'mobile_reset', 'mobile_connection', 'mobile_input', 'mobile_inspect'].every((name) => names.includes(name)), names.join(' '))
  const press = await rpc('tools/call', { name: 'mobile_steps', arguments: { steps: [{ action: 'press', button: 'home' }, { action: 'waitFor', text: 'Settings', timeoutMs: 10_000 }] } })
  expect('mobile_steps goes home', press.result?.isError !== true, press.result?.content?.[0]?.text)
  const shot = await rpc('tools/call', { name: 'mobile_snapshot', arguments: {} })
  const parts = shot.result?.content ?? []
  expect('mobile_snapshot lists elements and an image', /e\d+ /.test(parts[0]?.text ?? '') && parts[1]?.type === 'image', parts[0]?.text?.slice(0, 200))
  const stale = await rpc('tools/call', { name: 'mobile_tap', arguments: { target: 'e9999' } })
  expect('mobile_tap refuses a ref it never issued', stale.result?.isError === true, JSON.stringify(stale.result))

  // The settings tools on the same connected phone. The permission ends reset (the default
  // ask state), the text size back at large and the status bar live, so the phone is as it was.
  const apps = await rpc('tools/call', { name: 'mobile_apps', arguments: {} })
  const appsText = apps.result?.content?.[0]?.text ?? ''
  expect('mobile_apps lists bundle ids', apps.result?.isError !== true && /com\.apple\.[\w.]+/.test(appsText), appsText.slice(0, 160))
  const configured = await rpc('tools/call', { name: 'mobile_configure', arguments: { actions: [
    { action: 'permission', op: 'grant', service: 'photos', bundleId: 'com.apple.MobileSMS' },
    { action: 'permission', op: 'reset', service: 'photos', bundleId: 'com.apple.MobileSMS' },
    { action: 'contentSize', size: 'extra-large' },
    { action: 'contentSize', size: 'large' },
    { action: 'statusBar', op: 'override' },
    { action: 'statusBar', op: 'clear' },
  ] } })
  expect('mobile_configure runs its actions in order', configured.result?.isError !== true && /Done/.test(configured.result?.content?.[0]?.text ?? ''), configured.result?.content?.[0]?.text)
  const refused = await rpc('tools/call', { name: 'mobile_configure', arguments: { actions: [{ action: 'permission', op: 'grant', service: 'telepathy', bundleId: 'com.apple.MobileSMS' }, { action: 'contentSize', size: 'large' }] } })
  expect('mobile_configure checks every action before running any', refused.result?.isError === true && /telepathy/.test(refused.result?.content?.[0]?.text ?? ''), JSON.stringify(refused.result?.content?.[0]?.text))
  const notified = await rpc('tools/call', { name: 'mobile_notify', arguments: { bundleId: 'com.apple.MobileSMS', payload: { aps: { alert: { title: 'Vellum check', body: 'mobile_notify delivers' }, sound: 'default' } } } })
  expect('mobile_notify delivers a notification', notified.result?.isError !== true, notified.result?.content?.[0]?.text)
  const erased = await rpc('tools/call', { name: 'mobile_reset', arguments: { what: 'app-data', bundleId: 'com.apple.MobileSMS' } })
  expect('mobile_reset erases an app', erased.result?.isError !== true, erased.result?.content?.[0]?.text)
  const unknown = await rpc('tools/call', { name: 'mobile_reset', arguments: { what: 'moon' } })
  expect('mobile_reset refuses an unknown what', unknown.result?.isError === true, JSON.stringify(unknown.result?.content?.[0]?.text))

  // A drag that starts on the screen and leaves it: the cover keeps it the phone's.
  const page = await app.getByTestId('page').bounds()
  const from = { x: screen.x + screen.width / 2, y: screen.y + screen.height * 0.6 }
  await app.mouse.down(from)
  await app.mouse.move({ x: from.x - 40, y: from.y }, { pressedButton: 0 })
  expect('a press on the phone covers the window', (await app.getByTestId('mobile-cover').count()) === 1)
  await app.mouse.move({ x: page.x + page.width / 2, y: from.y }, { pressedButton: 0 })
  expect('the touch survives leaving the screen', (await app.getByTestId('mobile-cover').count()) === 1)
  await app.mouse.move({ x: page.x + 40, y: page.y + 40 }, { pressedButton: 0 })
  await app.mouse.up({ x: page.x + 40, y: page.y + 40 })
  await Bun.sleep(200)
  expect('the lift ends it', (await app.getByTestId('mobile-cover').count()) === 0)
  const selected = await app.call('getSelectedText', {})
  expect('and selects nothing in the note', !selected.text, JSON.stringify(selected))
  // A press beside the phone, dragged across the note: the pane takes it, no text gets selected.
  const view = await app.getByTestId('mobile-view').bounds()
  const beside = { x: (view.x + frame.x) / 2, y: view.y + view.height / 2 }
  await app.mouse.down(beside)
  for (let i = 1; i <= 6; i++) await app.mouse.move({ x: beside.x + (page.x + 40 - beside.x) * i / 6, y: beside.y - 200 * i / 6 }, { pressedButton: 0 })
  await app.mouse.up({ x: page.x + 40, y: beside.y - 200 })
  await Bun.sleep(200)
  const stray = await app.call('getSelectedText', {})
  expect('a drag from beside the phone selects nothing either', !stray.text, JSON.stringify(stray))

  // The pane's edge: wider, then clamped.
  const dock = await app.getByTestId('mobile-dock').bounds()
  const edge = await app.getByTestId('mobile-edge').center()
  await app.mouse.drag(edge, { x: edge.x - 60, y: edge.y })
  await Bun.sleep(600)
  const wider = await app.getByTestId('mobile-dock').bounds()
  expect('dragging the edge widens the pane', wider.width > dock.width + 40, `${dock.width} → ${wider.width}`)
  const edge2 = await app.getByTestId('mobile-edge').center()
  await app.mouse.drag(edge2, { x: edge2.x - 2000, y: edge2.y })
  await Bun.sleep(600)
  const widest = await app.getByTestId('mobile-dock').bounds()
  expect('and stops at its bound', widest.width <= 520 + 16, `${widest.width}`)
  await app.screenshot({ path: 'screenshots/mobile-wide.png' })
} finally {
  await app.close()
  await remove(home)
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
