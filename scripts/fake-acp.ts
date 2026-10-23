// A stand-in ACP agent for self-checks, so approvals, modes, models and compacting can be tested
// without a paid turn. It speaks the same JSON-RPC the Claude ACP adapter does (spikes/acp-turn.ts):
// initialize, session/new and session/resume, config options for mode, model and effort, and on
// each prompt a session/request_permission for a Bash command (or an Edit, when the prompt says
// "edit"), then a tool call, a reply, usage and end_turn. A prompt within a second of a "no" is the
// note that came with it, and gets a plain answer. `/compact` answers with a compaction. Every message it
// receives is appended to $FAKE_ACP_LOG as {in: msg}.
//   VELLUM_AGENT=scripts/fake-acp.ts (scripts/check-approval.ts sets it)
import { appendFileSync } from 'node:fs'

const log = (o: unknown) => process.env.FAKE_ACP_LOG && appendFileSync(process.env.FAKE_ACP_LOG, JSON.stringify(o) + '\n')
const out = (o: unknown) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...(o as object) }) + '\n')
const update = (sessionId: string, u: unknown) => out({ method: 'session/update', params: { sessionId, update: u } })

const config: any[] = [
  {
    // Starts in auto, as the real adapter does when ~/.claude's settings say so.
    id: 'mode', name: 'Mode', category: 'mode', type: 'select', currentValue: 'auto',
    options: ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions'].map((value) => ({ value, name: value })),
  },
  {
    id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'default',
    options: [
      { value: 'default', name: 'Default (recommended)', description: 'Opus 5.5 · Best for everyday, complex tasks' },
      { value: 'haiku', name: 'Haiku', description: 'Haiku 5.5 · Fastest for quick answers' },
    ],
  },
  {
    id: 'effort', name: 'Effort', category: 'thought_level', type: 'select', currentValue: 'default',
    options: ['default', 'low', 'medium', 'high', 'max'].map((value) => ({ value, name: value })),
  },
]
const resolved = () => (config[1].currentValue === 'haiku' ? 'claude-haiku-5-5' : 'claude-opus-5-5')

let seq = 0
const waiting = new Map<number, (r: any) => void>()
const ask = (params: unknown) =>
  new Promise<any>((resolve) => {
    const id = 1000 + ++seq
    waiting.set(id, resolve)
    out({ id, method: 'session/request_permission', params })
  })

let turn = 0
/** When the last ask was answered no: a note sent with that no follows within moments. */
let rejectedAt = 0

async function prompt(sessionId: string, text: string) {
  turn++
  if (text.trim() === '/compact') {
    update(sessionId, { sessionUpdate: 'compaction_update', compactionId: `c${turn}`, status: 'in_progress' })
    update(sessionId, { sessionUpdate: 'compaction_update', compactionId: `c${turn}`, status: 'completed' })
    update(sessionId, { sessionUpdate: 'usage_update', used: 1_900, size: 200_000, _meta: { '_claude/model': resolved() } })
    return { stopReason: 'end_turn' }
  }
  if (Date.now() - rejectedAt < 1000) {
    rejectedAt = 0
    update(sessionId, { sessionUpdate: 'agent_message_chunk', messageId: `m${turn}`, content: { type: 'text', text: `Okay: ${text}` } })
    return { stopReason: 'end_turn' }
  }
  const edit = /\bedit\b/i.test(text)
  const callId = `toolu_${turn}`
  const toolCall = edit
    ? { toolCallId: callId, name: 'Edit', _meta: { claudeCode: { toolName: 'Edit' } }, kind: 'edit', title: 'Edit ui/theme.ts', rawInput: { file_path: `${process.cwd()}/ui/theme.ts`, old_string: 'export const radiusXl = 14', new_string: 'export const radiusXl = 16' }, status: 'pending' }
    : { toolCallId: callId, name: 'Bash', _meta: { claudeCode: { toolName: 'Bash' } }, kind: 'execute', title: 'bun test ui/theme.test.ts', rawInput: { command: 'bun test ui/theme.test.ts', description: 'Run the theme tests' }, status: 'pending' }
  update(sessionId, { sessionUpdate: 'tool_call', ...toolCall })
  const answer = await ask({
    sessionId,
    toolCall,
    options: [
      { optionId: 'allow-once', name: 'Yes', kind: 'allow_once' },
      { optionId: 'allow-always', name: edit ? 'Yes, auto-accept edits' : "Yes, and don't ask again for bun test commands", kind: 'allow_always' },
      { optionId: 'reject', name: 'No', kind: 'reject_once' },
    ],
  })
  const allowed = answer?.outcome?.outcome === 'selected' && answer.outcome.optionId !== 'reject'
  if (!allowed) {
    if (answer?.outcome?.outcome === 'selected') rejectedAt = Date.now()
    update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: callId, status: 'failed', rawOutput: 'The user rejected this.' })
    return { stopReason: answer?.outcome?.outcome === 'cancelled' ? 'cancelled' : 'end_turn' }
  }
  update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: callId, status: 'completed', rawOutput: edit ? 'The file has been updated.' : '2 pass' })
  update(sessionId, { sessionUpdate: 'agent_message_chunk', messageId: `m${turn}`, content: { type: 'text', text: edit ? 'Changed it.' : 'Ran it: 2 pass.' } })
  update(sessionId, { sessionUpdate: 'usage_update', used: 24_350, size: 200_000, _meta: { '_claude/model': resolved() } })
  return { stopReason: 'end_turn' }
}

async function handle(msg: any) {
  if (msg.method === undefined && msg.id !== undefined) {
    waiting.get(msg.id)?.(msg.result)
    waiting.delete(msg.id)
    return
  }
  const reply = (result: unknown) => out({ id: msg.id, result })
  switch (msg.method) {
    case 'initialize':
      return reply({
        protocolVersion: 1,
        agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} }, promptCapabilities: { image: true } },
        agentInfo: { name: 'fake-acp', version: '0' },
        authMethods: [],
      })
    case 'session/new':
      out({ method: '_auth/status_update', params: { authStatus: { kind: 'account', label: 'Claude Pro', account: { plan: 'pro', email: 'fake@example.com' } } } })
      return reply({ sessionId: 'fake-session', configOptions: config })
    case 'session/resume':
      return reply({ configOptions: config })
    case 'session/set_config_option': {
      const o = config.find((x) => x.id === msg.params.configId)
      if (o) o.currentValue = msg.params.value
      return reply({ configOptions: config })
    }
    case 'session/prompt': {
      const text = (msg.params.prompt ?? []).map((c: any) => c.text ?? '').join('')
      return reply(await prompt(msg.params.sessionId, text))
    }
    case 'session/cancel':
      for (const [, resolve] of waiting) resolve({ outcome: { outcome: 'cancelled' } })
      waiting.clear()
      return
    default:
      if (msg.id !== undefined) out({ id: msg.id, error: { code: -32601, message: `fake-acp: no ${msg.method}` } })
  }
}

let buf = ''
const dec = new TextDecoder()
for await (const chunk of Bun.stdin.stream()) {
  buf += dec.decode(chunk, { stream: true })
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i)
    buf = buf.slice(i + 1)
    if (!line.trim()) continue
    const msg = JSON.parse(line)
    log({ in: msg })
    void handle(msg)
  }
}
