import path from 'node:path'
import { paths } from '../core/store'
import { plainName } from '../core/captures'

export async function runBrowser(args: string[]) {
  const noteId = process.env.VELLUM_NOTE_ID
  const endpoint = process.env.VELLUM_BRIDGE
  const token = process.env.VELLUM_TOKEN
  if (!plainName(noteId) || !endpoint || !token) throw new Error('Run browser from a Vellum note')
  if (!args.length) { process.stdout.write('browser <open|snapshot|click|screenshot|...> — a browser for this note\n'); return }
  if (args.some((arg) => /^--(?:session|session-name|profile|cdp|auto-connect|state|restore)(?:=|$)/.test(arg))) throw new Error('Vellum manages the browser session')
  const session = `vellum-${noteId}`
  const env = { ...process.env }
  for (const key of ['AGENT_BROWSER_SESSION', 'AGENT_BROWSER_SESSION_NAME', 'AGENT_BROWSER_PROFILE', 'AGENT_BROWSER_CDP', 'AGENT_BROWSER_AUTO_CONNECT', 'AGENT_BROWSER_STATE', 'AGENT_BROWSER_RESTORE', 'AGENT_BROWSER_STREAM_PORT', 'VELLUM_TOKEN']) delete env[key]
  const run = async (command: string[]) => {
    const proc = Bun.spawn(['agent-browser', '--session', session, ...command], { env, stdout: 'pipe', stderr: 'pipe' })
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
    return { stdout, stderr, code }
  }
  let screenshot: string | undefined
  if (args[0] === 'screenshot' && (args.length === 1 || args[1]?.startsWith('--'))) {
    const dir = path.join(paths.captures, noteId, 'shots')
    await Bun.$`/bin/mkdir -p -m 700 ${dir}`.quiet()
    screenshot = path.join(dir, `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.png`)
    args = [args[0], screenshot, ...args.slice(1)]
  }
  if (args[0] === 'close') { const result = await run(args); process.stdout.write(result.stdout); process.stderr.write(result.stderr); process.exitCode = result.code; return }
  const status = await run(['stream', 'status', '--json'])
  let data: any
  try { const parsed = JSON.parse(status.stdout); data = parsed.data ?? parsed } catch { throw new Error('Could not read the browser stream status') }
  if (!data.enabled || !data.port) {
    const enabled = await run(['stream', 'enable', '--json'])
    const parsed = JSON.parse(enabled.stdout)
    data = parsed.data ?? parsed
  }
  if (!Number.isInteger(data.port)) throw new Error('The browser did not report a stream port')
  const report = async (extra: { url?: string; screenshot?: string } = {}) => {
    const response = await fetch(`${endpoint}/browser`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ noteId, session, streamPort: data.port, ...extra }) })
    if (!response.ok) throw new Error(`Vellum could not attach the browser (${response.status})`)
  }
  try { await report() } catch (error) { await run(['close']); throw error }
  const result = await run(args)
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  if (result.code) { process.exitCode = result.code; return }
  if (screenshot) process.stdout.write(`${screenshot}\n`)
  const urlResult = await run(['get', 'url', '--json'])
  let url: string | undefined
  try { const parsed = JSON.parse(urlResult.stdout); url = typeof parsed.data?.url === 'string' ? parsed.data.url : typeof parsed.data === 'string' ? parsed.data : parsed.url } catch {}
  await report({ url, screenshot })
}

if (import.meta.main) await runBrowser(process.argv.slice(2))
