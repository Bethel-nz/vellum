import { mkdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { browserExecutable } from './browser'
import type { CliResponse, CloseData, ConnectData, GetUrlData, SessionInfoData, StreamStatusData, TabSwitchData, ViewportData } from './agent-browser-types'
import type { BrowserSession } from './capture'
import type { BrowserActivity, BrowserBinding, BrowserCommandInput, BrowserCommandResult, BrowserContext, BrowserEvent, BrowserKey, BrowserPhase } from './browser-types'
import { paths, readSettings } from './store'
import { plainName } from './captures'
import { bindToolbarTarget, browserTargetOwner, claimedToolbar, listToolbarTargets, releaseBrowserTarget, type BoundTarget } from './browser-targets'

const listeners = new Set<(event: BrowserEvent) => void>()
const changes = new Set<() => void>()
export const subscribeBrowserEvents = (listener: (event: BrowserEvent) => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export const subscribeBrowserRuntime = (listener: () => void) => { changes.add(listener); return () => { changes.delete(listener) } }
const runs = new Map<string, string>()
export function beginBrowserRun(noteId: string) { const run = crypto.randomUUID(); runs.set(noteId, run); return run }
export function endBrowserRun(noteId: string) { runs.delete(noteId); for (const listener of changes) listener() }
export const browserRun = (noteId: string) => runs.get(noteId)

type Runtime = {
  daemonPid?: number; key: BrowserKey; binding: BrowserBinding; target?: BoundTarget; phase: BrowserPhase; streamPort: number;
  tail: Promise<void>; control: 'agent' | 'pending' | 'user'; controlSource: 'viewer' | 'capture'; controlEpoch: number; stopping: boolean; uncertain: boolean;
  url?: string; error?: string; runId?: string; actionId?: string; recording: boolean; recordStartedAt?: number;
  screenshot?: string; recordingPath?: string; activities: BrowserActivity[]; dir: string; config: string
}
const sessions = new Map<string, Runtime>()
const connecting = new Map<string, Promise<unknown>>()
export function getBrowserSession(noteId: string): BrowserSession | undefined {
  const runtime = sessions.get(noteId)
  if (!runtime) return
  return { ...runtime.key, phase: runtime.phase, streamPort: runtime.streamPort, mode: runtime.binding.mode, targetId: runtime.target?.targetId, url: runtime.url, error: runtime.error, runId: runtime.runId, lastActionId: runtime.actionId, recording: runtime.recording, recordStartedAt: runtime.recordStartedAt, screenshot: runtime.screenshot, activities: runtime.activities }
}
export function validateBrowser(key: BrowserKey) { const runtime = sessions.get(key.noteId); return runtime?.key.generation === key.generation && runtime.key.session === key.session && runtime.phase !== 'closed' ? getBrowserSession(key.noteId) : undefined }
export function browserWorkActive(browser: BrowserSession) { return Boolean(browser.generation && validateBrowser(browser as BrowserKey) && (browser.runId ? runs.get(browser.noteId) === browser.runId : browser.phase === 'working' || browser.phase === 'starting')) }
function emit(runtime: Runtime, event: BrowserEvent extends infer E ? E extends BrowserEvent ? Omit<E, 'key' | 'at' | 'runId'> : never : never) {
  const full = { ...event, key: runtime.key, at: new Date().toISOString(), ...(runtime.runId ? { runId: runtime.runId } : {}) } as BrowserEvent
  for (const listener of listeners) listener(full)
  for (const listener of changes) listener()
}
function state(runtime: Runtime, phase: BrowserPhase, error?: string) {
  runtime.phase = phase; runtime.error = error
  emit(runtime, { type: 'session', phase, binding: runtime.binding, streamPort: runtime.streamPort, error, url: runtime.url, recording: runtime.recording })
}
export function browserTitle(args: string[]) {
  const verb = args[0] ?? 'Browser'
  const label = verb.charAt(0).toUpperCase() + verb.slice(1)
  if (['open', 'goto', 'navigate'].includes(verb)) { try { return `${label} · ${new URL(args[1]!).hostname}` } catch {} }
  return label
}
const reserved = /^--(?:session|session-name|namespace|profile|cdp|auto-connect|state|restore|restore-save|restore-check-url|restore-check-text|restore-check-fn|config|stream-port|pin-tab|no-pin-tab|executable-path|engine|provider|extensions|args|plugin|plugins|headed|init-script|init-scripts|enable|proxy|proxy-bypass|proxy-user|proxy-pass|webgpu|download-path)(?:=|$)/
/** Stream frame ceiling (16:10, matching the viewer box). Caps default to the
 * session viewport, so the viewport is sized up alongside (owned sessions only;
 * never resize a user's attached Chrome tab). */
const STREAM_WIDTH = 1600
const STREAM_HEIGHT = 1000
export function browserArguments(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 256 || value.some(arg => typeof arg !== 'string' || arg.includes('\0') || arg.length > 1_000_000) || !/^[a-z][a-z0-9-]*$/.test(value[0])) throw new Error('Give browser args as a non-empty argv array, starting with a command')
  if (value.some(arg => reserved.test(arg) || arg === '-p') || ['connect', 'session', 'sessions', 'stream', 'install', 'upgrade', 'update', 'dashboard', 'chat', 'plugin', 'plugins', 'profiles', 'state', 'close'].includes(value[0])) throw new Error('Vellum manages the browser connection, session, configuration and process. Use browser_session.')
  return [...value]
}
function create(noteId: string, target?: BoundTarget): Runtime {
  if (!plainName(noteId)) throw new Error('Invalid note id')
  const key = { noteId, session: `vellum-${noteId}`, generation: crypto.randomUUID() }
  const dir = path.join(paths.captures, noteId, 'browser', key.generation)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const config = path.join(dir, 'config.json')
  const advanced = readSettings().browserLaunch ?? {}
  writeFileSync(config, JSON.stringify({ ...advanced, downloadPath: dir, screenshotDir: dir, contentBoundaries: true, headed: false, plugins: [], ...(target ? { pinTab: true } : {}) }), { mode: 0o600 })
  const runtime: Runtime = { key, binding: target ? { mode: 'toolbar', owned: false, targetKey: target.key, targetId: target.targetId } : { mode: 'managed', owned: true }, target, phase: 'idle', streamPort: 0, tail: Promise.resolve(), control: 'agent', controlSource: 'viewer', controlEpoch: 0, stopping: false, uncertain: false, recording: false, activities: [], dir, config }
  sessions.set(noteId, runtime)
  return runtime
}
function environment() {
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (key.startsWith('AGENT_BROWSER_') || key === 'VELLUM_TOKEN' || ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'].includes(key)) delete env[key]
  env.AGENT_BROWSER_NAMESPACE = `vellum-${new Bun.CryptoHasher('sha256').update(paths.home).digest('hex').slice(0, 16)}`
  // Frames cap at the session viewport by default; raise the ceiling to the
  // 16:10 box the viewer paints into so the expanded view stays sharp.
  env.AGENT_BROWSER_STREAM_MAX_WIDTH = String(STREAM_WIDTH)
  env.AGENT_BROWSER_STREAM_MAX_HEIGHT = String(STREAM_HEIGHT)
  return env
}
class BrowserCliError extends Error {
  constructor(message: string, readonly code: string | undefined, readonly stdout: string, readonly stderr: string, readonly exitCode: number) { super(message) }
}
async function invoke<T = unknown>(runtime: Runtime, args: string[], timeoutMs = 120_000, attach = true) {
  const proc = Bun.spawn([browserExecutable(), '--session', runtime.key.session, '--config', runtime.config, ...(runtime.target && attach ? ['--cdp', runtime.target.endpoint, '--pin-tab'] : []), ...args, ...(args.includes('--json') ? [] : ['--json'])], { env: environment(), cwd: runtime.dir, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; proc.kill('SIGKILL') }, timeoutMs)
  try {
    const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
    if (timedOut) { runtime.uncertain = true; throw new Error('Browser command did not settle. Disconnect and retry before taking control.') }
    let parsed: CliResponse<T> | undefined
    try { parsed = JSON.parse(stdout) } catch {}
    if (parsed?.warning) {
      const actionId = crypto.randomUUID(), at = new Date().toISOString()
      runtime.activities = [...runtime.activities.slice(-99), { id: actionId, title: 'Browser warning', at, summary: parsed.warning }]
      emit(runtime, { type: 'warning', actionId, message: parsed.warning })
    }
    if (parsed?.success === false) {
      if (parsed.code === 'tab_gone') {
        runtime.controlEpoch++; runtime.control = 'agent'; runtime.streamPort = 0; runtime.uncertain = true
        state(runtime, 'disconnected', 'The selected Chrome tab is gone. Select a tab explicitly to reconnect.')
      }
      throw new BrowserCliError(parsed.error ?? 'Browser command failed', parsed.code, stdout, stderr, exitCode || 1)
    }
    if (exitCode) throw new BrowserCliError(stderr.trim() || 'Browser command failed', parsed?.code, stdout, stderr, exitCode)
    if (parsed?.success !== true) throw new BrowserCliError('Browser returned an invalid JSON response', undefined, stdout, stderr, 1)
    return { stdout, stderr, exitCode, data: parsed.data ?? null }
  } finally { clearTimeout(timer) }
}
async function start(runtime: Runtime) {
  if (runtime.streamPort && !['error', 'closed'].includes(runtime.phase)) return
  state(runtime, 'starting')
  if (runtime.target) {
    await invoke<ConnectData>(runtime, ['connect', runtime.target.endpoint, '--json'], 20_000, false)
    await invoke<TabSwitchData>(runtime, ['tab', runtime.target.targetId, '--json'])
  }
  const stream = await invoke<StreamStatusData>(runtime, ['stream', 'status', '--json'])
  if (!stream.data?.enabled || typeof stream.data.port !== 'number' || !Number.isInteger(stream.data.port)) throw new Error('Browser could not start. Install a supported Chrome browser, then retry.')
  runtime.streamPort = stream.data.port
  // Wider frames for the viewer: size up the owned session viewport to the
  // stream ceiling. Attached tabs are left alone. Best effort: a failure here
  // keeps the default viewport rather than failing the session.
  if (!runtime.target) await invoke<ViewportData>(runtime, ['set', 'viewport', String(STREAM_WIDTH), String(STREAM_HEIGHT)], 10_000).catch(() => {})
  const info = await invoke<SessionInfoData>(runtime, ['session', 'info', '--json'], 5000)
  if (typeof info.data?.pid === 'number' && Number.isInteger(info.data.pid) && info.data.pid > 0) runtime.daemonPid = info.data.pid
  state(runtime, 'ready')
}
function enqueue<T>(runtime: Runtime, operation: () => Promise<T>): Promise<T> {
  const result = runtime.tail.then(operation)
  runtime.tail = result.then(() => {}, () => {})
  return result
}
export async function browserCommand(noteId: string, input: BrowserCommandInput, context: BrowserContext): Promise<BrowserCommandResult> {
  const args = browserArguments(input.args)
  if (connecting.has(noteId)) throw new Error('Browser connection is changing; wait for it to finish')
  let runtime = sessions.get(noteId)
  if (!runtime || runtime.phase === 'closed') runtime = create(noteId)
  const current = runtime
  if (current.control !== 'agent') throw new Error('The person has browser control. Wait for hand-back.')
  if (current.stopping || current.uncertain) throw new Error('Browser is stopping or has an unsettled command. Disconnect before retrying.')
  return enqueue(current, async () => {
    context.signal.throwIfAborted()
    if (current.stopping || current.control !== 'agent' || current.uncertain) throw new Error('Browser control is reserved for the person or the session is stopping')
    current.runId = context.runId ?? runs.get(noteId)
    const actionId = crypto.randomUUID(), began = Date.now(), title = browserTitle(args)
    current.actionId = actionId
    context.onAction?.(current.key, actionId)
    current.activities = [...current.activities.slice(-99), { id: actionId, title, at: new Date().toISOString() }]
    emit(current, { type: 'action-start', actionId, toolCallId: context.toolCallId, title })
    let result: BrowserCommandResult = { key: current.key, actionId, exitCode: 1, stdout: '', stderr: '', artifacts: [] }
    let outputPath: string | undefined
    let executed = args
    const kind = args[0] === 'screenshot' ? 'screenshot' : args[0] === 'pdf' ? 'pdf' : args[0] === 'download' ? 'download' : args[0] === 'record' && ['start', 'restart', 'stop'].includes(args[1]!) ? 'video' : ['trace', 'profiler'].includes(args[0]!) && args[1] === 'stop' ? 'trace' : args[0] === 'network' && args[1] === 'har' && args[2] === 'stop' ? 'har' : undefined
    if (kind) {
      const index = kind === 'video' || kind === 'trace' || kind === 'download' ? 2 : kind === 'har' ? 3 : 1
      outputPath = args[index] && !args[index]!.startsWith('-') ? path.resolve(current.dir, args[index]!) : path.join(current.dir, `${actionId}.${kind === 'screenshot' ? 'png' : kind === 'pdf' ? 'pdf' : kind === 'video' ? 'webm' : kind === 'har' ? 'har' : kind === 'download' ? 'bin' : 'json'}`)
      executed = [...args]; if (!args[index] || args[index]!.startsWith('-')) executed.splice(index, 0, outputPath); else executed[index] = outputPath
      if (args[0] === 'record' && args[1] === 'stop') { outputPath = current.recordingPath; executed = args }
    }
    try {
      await start(current)
      context.signal.throwIfAborted()
      if (current.target) {
        await current.target.verify()
        if (args[0] === 'tab' && args[1] !== 'list') throw new Error('unsupported_capability: toolbar mode stays on its explicitly selected tab')
      }
      state(current, 'working')
      const actual = await invoke(current, executed)
      result = { ...result, ...actual }
      if (context.signal.aborted) result = { ...result, exitCode: 130, stderr: `${result.stderr}\nBrowser call cancelled after its in-flight command settled.` }
      if (!actual.exitCode) {
        if (kind && outputPath) {
          try {
            const file = realpathSync(outputPath), stat = statSync(file)
            if (stat.isFile() && stat.size > 0) {
              result.artifacts.push({ id: actionId, path: file, kind, mime: kind === 'screenshot' ? 'image/png' : kind === 'pdf' ? 'application/pdf' : kind === 'video' ? file.endsWith('.mp4') ? 'video/mp4' : 'video/webm' : kind === 'download' ? 'application/octet-stream' : 'application/json' })
              if (kind === 'screenshot') current.screenshot = file
            }
          } catch {}
        }
        if (args[0] === 'record') { current.recording = ['start', 'restart'].includes(args[1]!); if (current.recording) { current.recordingPath = outputPath; current.recordStartedAt = Date.now() } else current.recordStartedAt = undefined }
        const url = await invoke<GetUrlData>(current, ['get', 'url', '--json'], 10_000)
        const raw = url.data?.url
        if (typeof raw === 'string') { try { const safe = new URL(raw); current.url = safe.protocol === 'about:' ? raw : safe.origin } catch {} }
      }
      state(current, result.exitCode ? 'error' : current.control === 'pending' ? 'waiting-user' : 'ready', result.exitCode ? 'Browser action failed. Open activity for details or retry.' : undefined)
    } catch (error) {
      if (error instanceof BrowserCliError) result = { ...result, stdout: error.stdout, exitCode: error.exitCode, code: error.code }
      result.stderr = error instanceof BrowserCliError ? [...new Set([error.message, error.stderr].filter(Boolean))].join('\n') : error instanceof Error ? error.message : 'Browser failed'
      state(current, result.code === 'tab_gone' ? 'disconnected' : 'error', result.code === 'tab_gone' ? 'The selected Chrome tab is gone. Select a tab explicitly to reconnect.' : current.uncertain ? 'Command settlement is unknown. Disconnect to recover.' : 'Browser action failed. Open activity or retry.')
    } finally {
      const summary = result.exitCode ? 'Action failed' : 'Completed'
      const durationMs = Date.now() - began
      current.activities = current.activities.map(action => action.id === actionId ? { ...action, exitCode: result.exitCode, durationMs, summary, artifacts: result.artifacts } : action)
      emit(current, { type: 'action-end', actionId, exitCode: result.exitCode, durationMs, summary, artifacts: result.artifacts })
    }
    return result
  })
}
export async function browserSession(noteId: string, input: { action: 'status' | 'connect' | 'disconnect' | 'targets'; mode?: 'managed' | 'toolbar'; targetKey?: string }) {
  if (input.action === 'targets') return listToolbarTargets()
  if (input.action === 'disconnect') { await stopBrowserSession(noteId); return getBrowserSession(noteId) }
  if (input.action === 'status') return getBrowserSession(noteId) ?? { noteId, session: `vellum-${noteId}`, phase: 'idle' }
  if (input.action !== 'connect') throw new Error('Unknown browser session action')
  if (connecting.has(noteId)) throw new Error('Browser connection is already changing')
  const connect = async () => {
    const existing = sessions.get(noteId)
    if (existing && existing.phase !== 'closed' && !input.mode) return getBrowserSession(noteId)
    if (existing && existing.phase !== 'closed') await stopBrowserSession(noteId, true)
    const target = input.mode === 'toolbar' ? await bindToolbarTarget(noteId, input.targetKey ?? '') : undefined
    const runtime = create(noteId, target)
    await enqueue(runtime, async () => { try { await start(runtime) } catch (error) { if (!(error instanceof BrowserCliError && error.code === 'tab_gone')) state(runtime, 'error', 'Browser connection failed'); throw error } })
    return getBrowserSession(noteId)
  }
  const pending = connect(); connecting.set(noteId, pending)
  try { return await pending } finally { connecting.delete(noteId) }
}
export async function requestBrowserControl(noteId: string, source: 'viewer' | 'capture' = 'viewer') {
  const runtime = sessions.get(noteId)
  if (!runtime || !runtime.streamPort || runtime.phase === 'closed') throw new Error('Connect a browser first')
  if (runtime.control !== 'agent') throw new Error('Browser control is already reserved')
  const epoch = ++runtime.controlEpoch
  runtime.controlSource = source
  runtime.control = 'pending'
  for (const listener of changes) listener()
  await runtime.tail
  if (runtime.controlEpoch !== epoch || runtime.control !== 'pending') throw new Error('Browser control request cancelled')
  if (runtime.uncertain || runtime.stopping || runtime.phase === 'closed') throw new Error('Browser command has not safely settled')
  runtime.control = 'user'; state(runtime, 'waiting-user')
}
export function hasBrowserControl(key: BrowserKey) { const runtime = sessions.get(key.noteId); return Boolean(validateBrowser(key) && runtime?.control === 'user' && runtime.controlSource === 'viewer') }
export async function releaseBrowserControl(noteId: string, source: 'viewer' | 'capture' = 'viewer') { const runtime = sessions.get(noteId); if (runtime && runtime.controlSource === source) { runtime.controlEpoch++; runtime.control = 'agent'; if (!runtime.stopping && runtime.phase === 'waiting-user') state(runtime, 'ready') } }
export async function stopBrowserSession(noteId: string, duringConnect = false) {
  if (!duringConnect && connecting.has(noteId)) await connecting.get(noteId)?.catch(() => {})
  const runtime = sessions.get(noteId)
  if (!runtime || runtime.phase === 'closed') return
  runtime.stopping = true
  try {
    // Await the action before close; killing only a CLI client doesn't cancel daemon work.
    let deadline: ReturnType<typeof setTimeout> | undefined
    try { await Promise.race([runtime.tail, new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error('Browser still working; retry disconnect')), 125_000) })]) } finally { clearTimeout(deadline) }
    await invoke<CloseData>(runtime, ['close', '--json'], 8_000)
    runtime.streamPort = 0; runtime.control = 'agent'; runtime.uncertain = false
    releaseBrowserTarget(noteId); state(runtime, 'closed')
  } catch (error) { state(runtime, 'error', 'Browser cleanup failed. Retry disconnect.'); throw error }
  finally { runtime.stopping = false }
}
export async function closeAllBrowserSessions() { await Promise.allSettled([...sessions.keys()].map(stopBrowserSession)) }

const captureLeases = new Map<string, string>()
export async function acquireBrowserCapture(installationId: string, tabId: number) {
  const claim = claimedToolbar(installationId, tabId)
  if (!claim) return { lease: undefined }
  await requestBrowserControl(claim.noteId, 'capture')
  const lease = crypto.randomUUID(); captureLeases.set(lease, claim.noteId)
  return { lease }
}
export async function releaseBrowserCapture(lease: string) { const noteId = captureLeases.get(lease); if (!noteId) return; captureLeases.delete(lease); await releaseBrowserControl(noteId, 'capture') }
export async function moveBrowserTarget(noteId: string, targetKey: string) {
  const owner = browserTargetOwner(targetKey)
  if (owner && owner !== noteId) {
    const runtime = sessions.get(owner)
    if (runtime) {
      while (runtime.control !== 'agent') await Bun.sleep(200)
      await stopBrowserSession(owner)
    }
  }
  return browserSession(noteId, { action: 'connect', mode: 'toolbar', targetKey })
}

/** GPUIX 0.11 exits synchronously after its last window closes. Wait for a bounded
 * close RPC here; a fire-and-forget child would be orphaned by process.exit. */
export function closeBrowserSessionsOnExit() {
  const deadline = Date.now() + 8000
  for (const runtime of sessions.values()) {
    if (runtime.phase === 'closed' || Date.now() >= deadline) continue
    try {
      const result = Bun.spawnSync([browserExecutable(), '--session', runtime.key.session, '--config', runtime.config, 'close', '--json'], { env: environment(), cwd: runtime.dir, stdout: 'ignore', stderr: 'ignore', timeout: Math.max(1, deadline - Date.now()) })
      if (result.exitCode !== 0) writeFileSync(path.join(runtime.dir, 'cleanup-error.json'), JSON.stringify({ at: new Date().toISOString(), message: 'Browser cleanup did not finish before exit. Reconnect and disconnect this note to retry.' }))
    } catch {}
  }
}

export async function verifyBrowserConnection(key: BrowserKey): Promise<boolean> {
  const runtime = sessions.get(key.noteId)
  if (!validateBrowser(key) || !runtime || !runtime.streamPort) return false
  // session info inspects an existing daemon without starting one.
  const info = await invoke<SessionInfoData>(runtime, ['session', 'info', '--json'], 3000, false).catch(() => undefined)
  const valid = info?.data?.active === true && typeof info.data.pid === 'number' && Number.isInteger(info.data.pid) && info.data.pid === runtime.daemonPid
  if (!valid) { runtime.streamPort = 0; runtime.uncertain = true; state(runtime, 'disconnected', 'Browser connection changed. Disconnect and reconnect to recover.') }
  return valid
}
