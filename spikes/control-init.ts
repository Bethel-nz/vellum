// Spike: what the control channel's initialize returns (no prompt is sent, so no turn is spent),
// and whether set_permission_mode / set_max_thinking_tokens are accepted.
//   bun spikes/control-init.ts
const proc = Bun.spawn(
  ['claude', '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-prompts', 'host', '--permission-prompt-tool', 'stdio'],
  { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
)
const send = (o: unknown) => {
  proc.stdin.write(JSON.stringify(o) + '\n')
  proc.stdin.flush()
}
send({ type: 'control_request', request_id: 'init', request: { subtype: 'initialize', hooks: null } })
send({ type: 'control_request', request_id: 'mode', request: { subtype: 'set_permission_mode', mode: 'plan' } })
send({ type: 'control_request', request_id: 'think', request: { subtype: 'set_max_thinking_tokens', max_thinking_tokens: 16000 } })
setTimeout(() => proc.stdin.end(), 6000)
let buf = ''
for await (const chunk of proc.stdout) {
  buf += new TextDecoder().decode(chunk)
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i)
    buf = buf.slice(i + 1)
    let ev: any
    try {
      ev = JSON.parse(line)
    } catch {
      continue
    }
    if (ev.type !== 'control_response') continue
    const r = ev.response
    if (r.request_id === 'init') {
      const body = r.response ?? {}
      console.log('init keys:', Object.keys(body).join(', '))
      for (const [k, v] of Object.entries(body)) if (k !== 'commands') console.log(' ', k, JSON.stringify(v).slice(0, 400))
      console.log('  commands:', (body.commands ?? []).length)
    } else console.log(r.request_id, r.subtype, JSON.stringify(r.response ?? r.error ?? '').slice(0, 200))
  }
}
console.log('exit', await proc.exited)
export {}
