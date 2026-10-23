// A stand-in for `claude -p` in self-checks, so approvals can be tested without a paid turn. It
// speaks the stream-json control protocol the real binary does (spikes/permission-host.ts):
// answers `initialize`, and on each user turn asks `can_use_tool` for a Bash command, waits for
// the host's answer, then replies and ends the turn. Every control message it receives is
// appended to $FAKE_CLAUDE_LOG as one JSON line. With `--output-format json` (note titles) it
// prints a fixed title and exits.
//   used by scripts/check-approval.ts through a `claude` shim on PATH
import { appendFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const log = (o: unknown) => process.env.FAKE_CLAUDE_LOG && appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify(o) + '\n')
const out = (o: unknown) => process.stdout.write(JSON.stringify(o) + '\n')
log({ argv })

if (argv[argv.indexOf('--output-format') + 1] === 'json') {
  out({ type: 'result', subtype: 'success', is_error: false, result: 'Fake short title', total_cost_usd: 0 })
  process.exit(0)
}

let turn = 0
let waiting: { id: string; resolve: (r: any) => void } | undefined

async function runTurn() {
  turn++
  out({ type: 'system', subtype: 'init', session_id: 'fake-session', model: 'fake-model' })
  const id = `ask-${turn}`
  const answer = await new Promise<any>((resolve) => {
    waiting = { id, resolve }
    out({
      type: 'control_request',
      request_id: id,
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        display_name: 'Bash',
        input: { command: 'bun test ui/theme.test.ts', description: 'Run the theme tests' },
        permission_suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'bun test:*' }], behavior: 'allow', destination: 'localSettings' }],
      },
    })
  })
  const allowed = answer?.behavior === 'allow'
  const text = allowed ? 'Ran it: 2 pass.' : `Okay, I won't.${answer?.message ? ` (${answer.message})` : ''}`
  out({ type: 'assistant', message: { id: `m${turn}`, role: 'assistant', content: [{ type: 'text', text }] } })
  out({ type: 'result', subtype: 'success', is_error: false, result: text, session_id: 'fake-session' })
}

let buf = ''
for await (const chunk of process.stdin) {
  buf += new TextDecoder().decode(chunk as Uint8Array)
  let nl: number
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl)
    buf = buf.slice(nl + 1)
    if (!line.trim()) continue
    const ev = JSON.parse(line)
    if (ev.type === 'control_request') {
      log({ control: ev.request })
      out({ type: 'control_response', response: { subtype: 'success', request_id: ev.request_id, response: {} } })
    } else if (ev.type === 'control_response') {
      log({ answer: ev.response })
      if (waiting && ev.response?.request_id === waiting.id) {
        const w = waiting
        waiting = undefined
        w.resolve(ev.response.response)
      }
    } else if (ev.type === 'user') {
      void runTurn()
    }
  }
}
