// Spike 2: one long-lived `claude -p` stream-json process, two turns, then --resume
// from a fresh process. Logs every stdout line so the event shapes can be recorded.
//
//   bun spikes/claude-headless.ts            uses the default ~/.claude profile
//   CLAUDE_CONFIG_DIR=... bun spikes/...     uses another profile

const args = [
  'claude', '-p',
  '--input-format', 'stream-json',
  '--output-format', 'stream-json',
  '--verbose', '--include-partial-messages',
  '--permission-mode', 'acceptEdits',
]

function userLine(text: string) {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) + '\n'
}

async function run(extra: string[], prompts: string[]) {
  const proc = Bun.spawn([...args, ...extra], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', cwd: import.meta.dir })
  let sessionId: string | undefined
  let pending = prompts.slice()
  const send = () => {
    const next = pending.shift()
    if (next === undefined) return proc.stdin.end()
    proc.stdin.write(userLine(next))
    proc.stdin.flush()
  }
  send()
  const reader = proc.stdout.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  const kinds = new Map<string, number>()
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      if (!line.trim()) continue
      const ev = JSON.parse(line)
      const kind = ev.type === 'stream_event' ? `stream_event/${ev.event?.type}` : `${ev.type}/${ev.subtype ?? ''}`
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1)
      if (ev.type !== 'stream_event') console.log(line.slice(0, 600))
      else if (kinds.get(kind) === 1) console.log('[first]', line.slice(0, 400))
      if (ev.type === 'system' && ev.subtype === 'init') sessionId = ev.session_id
      if (ev.type === 'result') send()
    }
  }
  console.log('stderr:', await new Response(proc.stderr).text())
  console.log('exit', await proc.exited, 'kinds', Object.fromEntries(kinds))
  return sessionId
}

const id = await run([], ['say hi in three words', 'now say bye in three words'])
console.log('\n=== resume', id)
if (id) await run(['--resume', id], ['what did you say first? answer in five words'])
