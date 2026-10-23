// Spike: does `/compact` work as a stream-json user turn in headless mode, and what comes back?
// One short haiku turn, then "/compact"; prints every event's type/subtype and the compaction
// metadata. Lean flags keep it at a fraction of a cent.
//   bun spikes/compact.ts
export {}

const proc = Bun.spawn(
  [
    'claude', '-p',
    '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--model', 'haiku',
    '--setting-sources', '', '--strict-mcp-config', '--tools', '', '--no-session-persistence',
  ],
  { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' },
)
const send = (o: unknown) => {
  proc.stdin.write(JSON.stringify(o) + '\n')
  proc.stdin.flush()
}
const turn = (text: string) => send({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } })

send({ type: 'control_request', request_id: 'init', request: { subtype: 'initialize' } })
turn('Name three rivers in Africa, one line each.')

let results = 0
let buf = ''
const dec = new TextDecoder()
for await (const chunk of proc.stdout) {
  buf += dec.decode(chunk)
  let nl: number
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl)
    buf = buf.slice(nl + 1)
    if (!line.trim()) continue
    const ev = JSON.parse(line)
    if (ev.type === 'control_response') continue
    const extra =
      ev.type === 'system' && ev.subtype === 'compact_boundary'
        ? JSON.stringify(ev.compact_metadata)
        : ev.type === 'assistant'
          ? `usage ${JSON.stringify(ev.message?.usage)} text ${JSON.stringify(ev.message?.content?.[0]?.text?.slice(0, 60))}`
          : ev.type === 'user'
            ? JSON.stringify(ev).slice(0, 220)
            : ev.type === 'result'
              ? `${ev.subtype} ${JSON.stringify(ev.result)?.slice(0, 80)} cost ${ev.total_cost_usd}`
              : ''
    console.log(ev.type, ev.subtype ?? '', extra)
    if (ev.type === 'result') {
      results++
      if (results === 1) turn('/compact')
      else proc.stdin.end()
    }
  }
}
await proc.exited
