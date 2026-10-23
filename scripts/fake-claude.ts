// A stand-in for `claude -p` in self-checks, so approvals can be tested without a paid turn. It
// speaks the stream-json control protocol the real binary does (spikes/permission-host.ts):
// answers `initialize`, and on each user turn asks `can_use_tool` for a Bash command, waits for
// the host's answer, then replies and ends the turn. `/compact` answers with a compact_boundary
// instead. Replies carry usage and the result a context window, as the real one does
// (spikes/models-usage.ts, spikes/compact.ts). Every control message it receives is
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

const MODELS = [
  { value: 'default', displayName: 'Default (recommended)', description: 'Opus 5.5 · Best for everyday, complex tasks', resolvedModel: 'claude-opus-5-5' },
  { value: 'haiku', displayName: 'Haiku', description: 'Haiku 5.5 · Fastest for quick answers', resolvedModel: 'claude-haiku-5-5' },
]
let model = argv.includes('--model') ? argv[argv.indexOf('--model') + 1]! : 'default'
const resolved = () => MODELS.find((m) => m.value === model)?.resolvedModel ?? 'claude-opus-5-5'
const usage = { input_tokens: 40, cache_creation_input_tokens: 1200, cache_read_input_tokens: 22_800, output_tokens: 310 }

async function runTurn(text: string) {
  turn++
  out({ type: 'system', subtype: 'init', session_id: 'fake-session', model: resolved() })
  if (text.trim() === '/compact') {
    out({ type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'manual', pre_tokens: 24_350, post_tokens: 1_900 } })
    out({ type: 'user', message: { role: 'user', content: '<local-command-stdout>Compacted </local-command-stdout>' } })
    out({ type: 'result', subtype: 'success', is_error: false, result: '', session_id: 'fake-session' })
    return
  }
  const id = `ask-${turn}`
  const answer = await new Promise<any>((resolve) => {
    waiting = { id, resolve }
    out({
      type: 'control_request',
      request_id: id,
      request: {
        subtype: 'can_use_tool',
        // A turn that mentions an edit asks for one, so the card's diff preview can be checked.
        ...(/\bedit\b/i.test(text)
          ? { tool_name: 'Edit', display_name: 'Edit', input: { file_path: `${process.cwd()}/ui/theme.ts`, old_string: 'export const radiusXl = 14', new_string: 'export const radiusXl = 16' } }
          : { tool_name: 'Bash', display_name: 'Bash', input: { command: 'bun test ui/theme.test.ts', description: 'Run the theme tests' } }),
        permission_suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'bun test:*' }], behavior: 'allow', destination: 'localSettings' }],
      },
    })
  })
  const allowed = answer?.behavior === 'allow'
  const reply = allowed ? 'Ran it: 2 pass.' : `Okay, I won't.${answer?.message ? ` (${answer.message})` : ''}`
  out({ type: 'assistant', message: { id: `m${turn}`, role: 'assistant', model: resolved(), usage, content: [{ type: 'text', text: reply }] } })
  out({ type: 'result', subtype: 'success', is_error: false, result: reply, session_id: 'fake-session', modelUsage: { [resolved()]: { contextWindow: 200_000 } } })
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
      if (ev.request?.subtype === 'set_model') model = ev.request.model
      const response = ev.request?.subtype === 'initialize' ? { models: MODELS } : {}
      out({ type: 'control_response', response: { subtype: 'success', request_id: ev.request_id, response } })
    } else if (ev.type === 'control_response') {
      log({ answer: ev.response })
      if (waiting && ev.response?.request_id === waiting.id) {
        const w = waiting
        waiting = undefined
        w.resolve(ev.response.response)
      }
    } else if (ev.type === 'user') {
      const c = ev.message?.content
      void runTurn(typeof c === 'string' ? c : (c ?? []).map((x: any) => x.text ?? '').join(' '))
    }
  }
}
