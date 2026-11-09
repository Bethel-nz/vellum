// A stand-in ACP agent for self-checks, so approvals, modes, models and compacting can be tested
// without a paid turn. It speaks the same JSON-RPC the Claude ACP adapter does (spikes/acp-turn.ts):
// initialize, session/new and session/resume, config options for mode, model and effort, and on
// each prompt a session/request_permission for a Bash command (or an Edit, when the prompt says
// "edit"), then a tool call, a reply, usage and end_turn. A prompt that says "codegen" runs a
// pretend `bun run codegen` that really writes src/generated.ts, a change no edit tool shows. A
// prompt that says "stream" gets a reply in ~100 small deltas, 25ms apart, and no tool call. A prompt within a second of a "no" is the
// note that came with it, and gets a plain answer. `/compact` answers with a compaction. Every message it
// receives is appended to $FAKE_ACP_LOG as {in: msg}. It steers like the adapter: `_session/steering`
// during a turn is taken in ("injected") and answered before the turn ends; while idle it's
// "promptRequired" and nothing happens. $FAKE_ACP_START_MS holds a session's start that long.
//
// With `--cli auth login|logout|status` it plays the account side (scripts/check-login.ts puts a
// `claude` shim on PATH that runs this file with --cli): a marker file in the account's config dir
// ($CLAUDE_CONFIG_DIR, or $FAKE_DEFAULT_CONFIG for the default account) means logged in, and holds
// the email. A login takes `--email`, else the email in $FAKE_NEXT_LOGIN (a file, used once: the
// browser was still signed in to that account), else one made from the account's folder.
//   VELLUM_AGENT=scripts/fake-acp.ts (scripts/check-approval.ts sets it)
import { STREAMED } from './fake-stream'
import path from 'node:path'
import { present, remove } from './scratch'

if (process.argv.includes('--cli')) {
  const args = process.argv.slice(2).filter((a) => a !== '--cli')
  const dir = process.env.CLAUDE_CONFIG_DIR ?? process.env.FAKE_DEFAULT_CONFIG ?? '/tmp/fake-acp-default'
  const marker = path.join(dir, '.fake-login')
  log({ cli: args, dir })
  if (args[0] === 'auth' && args[1] === 'status') {
    const loggedIn = await present(marker)
    const email = loggedIn ? (await Bun.file(marker).text()).trim() || `${path.basename(path.dirname(dir))}@example.com` : undefined
    process.stdout.write(JSON.stringify(loggedIn ? { loggedIn, authMethod: 'claude.ai', apiProvider: 'firstParty', email, subscriptionType: 'max' } : { loggedIn, authMethod: 'none' }) + '\n')
    process.exit(loggedIn ? 0 : 1)
  }
  if (args[0] === 'auth' && args[1] === 'login') {
    process.stdout.write('Opening your browser to log in…\r\n')
    await Bun.sleep(600)
    const next = process.env.FAKE_NEXT_LOGIN
    const given = args.includes('--email') ? args[args.indexOf('--email') + 1] : undefined
    const email = given ?? (next && await present(next) ? (await Bun.file(next).text()).trim() : undefined) ?? `${path.basename(path.dirname(dir))}@example.com`
    if (next && !given) await remove(next)
    await Bun.write(marker, email)
    process.stdout.write('Login successful.\r\n')
    process.exit(0)
  }
  if (args[0] === 'auth' && args[1] === 'logout') {
    await remove(marker)
    process.exit(0)
  }
  process.exit(2)
}

/**
 * One line onto the check's log, appended in order and whole whichever fake agent writes it.
 */
function log(o: unknown) {
  if (process.env.FAKE_ACP_LOG) Bun.spawnSync(['/bin/sh', '-c', 'cat >> "$1"', 'sh', process.env.FAKE_ACP_LOG], { stdin: new TextEncoder().encode(JSON.stringify(o) + '\n') })
}
const out = (o: unknown) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...(o as object) }) + '\n')
const update = (sessionId: string, u: unknown) => out({ method: 'session/update', params: { sessionId, update: u } })

// FAKE_ACP_AS=codex or opencode: that agent's options and capabilities, as spikes/acp-agents.ts
// recorded them, instead of Claude's.
const as = process.env.FAKE_ACP_AS ?? 'claude'
const startMs = Number(process.env.FAKE_ACP_START_MS) || 0
const select = (id: string, category: string, currentValue: string, values: string[]) => ({ id, name: id, category, type: 'select', currentValue, options: values.map((value) => ({ value, name: value })) })
const looks: Record<string, any[]> = {
  codex: [
    select('mode', 'mode', 'agent', ['read-only', 'workspace-write', 'agent', 'agent-full-access']),
    select('collaboration_mode', 'collaboration_mode', 'default', ['default', 'plan']),
    select('model', 'model', 'gpt-6.1-sol', ['gpt-6.1-sol', 'gpt-6-luna']),
    select('reasoning_effort', 'thought_level', 'high', ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']),
  ],
  opencode: [
    select('model', 'model', 'opencode/big-pickle', ['opencode/big-pickle']),
    select('effort', 'thought_level', 'default', ['high', 'default']),
    select('mode', 'mode', 'build', ['build', 'plan']),
  ],
}
const config: any[] = looks[as] ?? [
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
// Only Claude's adapter reports the model it resolved to (`_claude/model`).
const resolved = () => (as !== 'claude' ? undefined : config[1].currentValue === 'haiku' ? 'claude-haiku-5-5' : 'claude-opus-5-5')

let seq = 0
const waiting = new Map<number, (r: any) => void>()
const ask = (params: unknown) =>
  new Promise<any>((resolve) => {
    const id = 1000 + ++seq
    waiting.set(id, resolve)
    out({ id, method: 'session/request_permission', params })
  })


let turn = 0
/** A turn is running; messages steered into it wait here for their answer. */
let inTurn = false
const steered: string[] = []
/** When the last ask was answered no: a note sent with that no follows within moments. */
let rejectedAt = 0

async function prompt(sessionId: string, text: string) {
  turn++
  // "leave plan": the agent changes its own mode, as Claude does when you accept its plan.
  if (/\bleave plan\b/i.test(text)) {
    const set = (id: string, value: string) => {
      const o = config.find((x) => x.id === id)
      if (o) o.currentValue = value
    }
    if (as === 'codex') {
      set('collaboration_mode', 'default')
      set('mode', 'workspace-write')
      update(sessionId, { sessionUpdate: 'config_option_update', configOptions: config })
    } else {
      const to = as === 'opencode' ? 'build' : 'acceptEdits'
      set('mode', to)
      update(sessionId, { sessionUpdate: 'current_mode_update', currentModeId: to })
    }
    update(sessionId, { sessionUpdate: 'agent_message_chunk', messageId: `m${turn}`, content: { type: 'text', text: 'Leaving plan mode.' } })
    return { stopReason: 'end_turn' }
  }
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
  if (/\bstream\b/i.test(text)) {
    // "overflow" streams it six times over: a reply taller than the window, for following.
    const reply = /\boverflow\b/i.test(text) ? Array(6).fill(STREAMED).join('\n\n') : STREAMED
    for (const piece of reply.match(/[\s\S]{1,6}/g)!) {
      update(sessionId, { sessionUpdate: 'agent_message_chunk', messageId: `m${turn}`, content: { type: 'text', text: piece } })
      await Bun.sleep(25)
    }
    update(sessionId, { sessionUpdate: 'usage_update', used: 24_350, size: 200_000, _meta: { '_claude/model': resolved() } })
    return { stopReason: 'end_turn' }
  }
  const edit = /\bedit\b/i.test(text)
  const codegen = /\bcodegen\b/i.test(text)
  const callId = `toolu_${turn}`
  const toolCall = edit
    ? { toolCallId: callId, name: 'Edit', _meta: { claudeCode: { toolName: 'Edit' } }, kind: 'edit', title: 'Edit ui/theme.ts', rawInput: { file_path: `${process.cwd()}/ui/theme.ts`, old_string: 'export const radiusXl = 14', new_string: 'export const radiusXl = 16' }, status: 'pending' }
    : codegen
      ? { toolCallId: callId, name: 'Bash', _meta: { claudeCode: { toolName: 'Bash' } }, kind: 'execute', title: 'bun run codegen', rawInput: { command: 'bun run codegen', description: 'Generate the types' }, status: 'pending' }
      : { toolCallId: callId, name: 'Bash', _meta: { claudeCode: { toolName: 'Bash' } }, kind: 'execute', title: 'bun test ui/theme.test.ts', rawInput: { command: 'bun test ui/theme.test.ts', description: 'Run the theme tests' }, status: 'pending' }
  // Codex's adapter names its tools its own way and gives only ACP's kind; an edit comes as a diff.
  if (as !== 'claude') {
    delete (toolCall as any)._meta
    if (edit) {
      Object.assign(toolCall, { name: 'apply_patch', rawInput: {}, locations: [{ path: `${process.cwd()}/ui/theme.ts` }], content: [{ type: 'diff', path: `${process.cwd()}/ui/theme.ts`, oldText: 'export const radiusXl = 14\n', newText: 'export const radiusXl = 16\n' }] })
    } else Object.assign(toolCall, { name: 'exec_command', rawInput: { command: toolCall.rawInput.command, cwd: process.cwd() } })
  }
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
  if (codegen) {
    await Bun.write(path.join(process.cwd(), 'src/generated.ts'), 'export type Id = string\nexport type Name = string\n')
  }
  update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: callId, status: 'completed', rawOutput: edit ? 'The file has been updated.' : codegen ? 'Wrote src/generated.ts' : '2 pass' })
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
        // Only Claude's adapter takes a systemPrompt; OpenCode doesn't steer.
        agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {}, ...(as === 'claude' ? { systemPrompt: {} } : {}) }, promptCapabilities: { image: true } },
        agentInfo: { name: 'fake-acp', version: '0' },
        _meta: as === 'opencode' ? {} : { steering: { supported: true } },
        authMethods: msg.params?.clientCapabilities?.auth?.terminal
          ? [{ id: 'claude-ai-login', name: 'Claude Subscription', type: 'terminal', args: ['--cli', 'auth', 'login', '--claudeai'] }]
          : [],
      })
    case 'session/new':
      await Bun.sleep(startMs)
      out({ method: '_auth/status_update', params: { authStatus: { kind: 'account', label: 'Claude Pro', account: { plan: 'pro', email: 'fake@example.com' } } } })
      return reply({ sessionId: 'fake-session', configOptions: config })
    case 'session/resume':
      await Bun.sleep(startMs)
      return reply({ configOptions: config })
    case 'session/set_config_option': {
      const o = config.find((x) => x.id === msg.params.configId)
      if (o) o.currentValue = msg.params.value
      return reply({ configOptions: config })
    }
    case 'session/prompt': {
      const text = (msg.params.prompt ?? []).map((c: any) => c.text ?? '').join('')
      inTurn = true
      try {
        const res = await prompt(msg.params.sessionId, text)
        // What was steered in is answered before the turn ends, like the adapter's steered echoes.
        for (const s of steered.splice(0)) update(msg.params.sessionId, { sessionUpdate: 'agent_message_chunk', messageId: `s${turn}`, content: { type: 'text', text: `\n\nSteered: ${s}` } })
        return reply(res)
      } finally {
        inTurn = false
      }
    }
    case '_session/steering': {
      const text = (msg.params.prompt ?? []).map((c: any) => c.text ?? '').join('')
      if (!inTurn) return reply({ outcome: 'promptRequired', reason: 'noRunningTurn' })
      steered.push(text)
      return reply({ outcome: 'injected' })
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
