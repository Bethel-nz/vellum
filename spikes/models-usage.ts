// Spike: what the official binary says about models and context, over the stream-json control
// channel. Prints the `initialize` response (models list), tries `set_model`, then runs one lean
// haiku turn and prints the usage fields of the assistant message and the result (contextWindow).
// Lean flags keep the turn at a fraction of a cent (see core/title.ts).
//   bun spikes/models-usage.ts
export {}

const proc = Bun.spawn(
  [
    'claude', '-p',
    '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--model', 'haiku',
    '--setting-sources', '', '--strict-mcp-config', '--tools', '', '--disable-slash-commands', '--no-session-persistence',
  ],
  { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' },
)
const send = (o: unknown) => {
  proc.stdin.write(JSON.stringify(o) + '\n')
  proc.stdin.flush()
}

send({ type: 'control_request', request_id: 'init', request: { subtype: 'initialize' } })

let buf = ''
let sentTurn = false
const dec = new TextDecoder()
for await (const chunk of proc.stdout) {
  buf += dec.decode(chunk)
  let nl: number
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl)
    buf = buf.slice(nl + 1)
    if (!line.trim()) continue
    const ev = JSON.parse(line)
    if (ev.type === 'control_response') {
      const r = ev.response
      if (r.request_id === 'init') {
        console.log('initialize keys:', Object.keys(r.response ?? {}))
        console.log('models:', JSON.stringify(r.response?.models, null, 1))
        send({ type: 'control_request', request_id: 'model', request: { subtype: 'set_model', model: 'haiku' } })
      } else {
        console.log('control response', r.request_id, JSON.stringify(r))
        if (!sentTurn) {
          sentTurn = true
          send({ type: 'user', message: { role: 'user', content: 'Reply with the single word: ok' } })
        }
      }
    } else if (ev.type === 'system') {
      console.log('system', ev.subtype, ev.model ?? '', ev.subtype === 'init' ? Object.keys(ev) : '')
    } else if (ev.type === 'assistant') {
      console.log('assistant model', ev.message?.model, 'usage', JSON.stringify(ev.message?.usage))
    } else if (ev.type === 'result') {
      console.log('result usage', JSON.stringify(ev.usage))
      console.log('result modelUsage', JSON.stringify(ev.modelUsage))
      console.log('cost', ev.total_cost_usd)
      proc.stdin.end()
    }
  }
}
await proc.exited
