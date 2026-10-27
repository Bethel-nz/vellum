// Live check for the agents besides Claude (VELLUM-V3-PLAN.md), through Vellum's own runner.
//
// OpenCode runs real turns on its free model, in scratch homes: no sign-in, nothing billed,
// nothing in your OpenCode history. A free model sometimes skips a tool it was asked to use, so
// a failure here can be the model's: run it again before reading it as Vellum's. It writes a file under Build (allowing what it asks),
// answers in Plan, resumes after its process ends, and its records fold into a note.
//
// With --codex, Codex (your real ~/.codex sign-in) opens a session and is switched through every
// Vellum mode, with no prompt, so no turn is spent; the session is deleted after.
//
// With --codex-turn (it spends your ChatGPT plan: ask first), one real Codex turn on its lightest
// model at low effort, in Edits: the file lands, the command shows as one, and the reply shows.
// That session is deleted too.
//   bun scripts/check-agents-live.ts [--codex] [--codex-turn]
import path from 'node:path'
import { scratchDir } from './scratch'

const home = await scratchDir('vellum-agents-live-')
process.env.VELLUM_HOME = path.join(home, 'vellum')
process.env.VELLUM_CLAUDE_HOME = path.join(home, 'claude-home')
// OpenCode keeps its sessions and sign-ins under these; its config (~/.config) is only read.
process.env.XDG_DATA_HOME = path.join(home, 'data')
process.env.XDG_STATE_HOME = path.join(home, 'state')
process.env.XDG_CACHE_HOME = path.join(home, 'cache')

const { AgentRunner } = await import('../core/agent')
const { agentArgv, agentEnv } = await import('../core/agent')
const { AcpConnection } = await import('../core/acp')
const { agents, agentModes } = await import('../core/agents')
const { newThread, reduce } = await import('../core/threads')
type Profile = import('../core/profiles').Profile

let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}

// ---------------------------------------------------------------- OpenCode

if (agents.opencode.missing()) console.log(`skip OpenCode: ${agents.opencode.missing()}`)
else {
  const workspace = await scratchDir('vellum-agents-live-ws-')
  const profile: Profile = { id: 'oc', name: 'OpenCode', color: '#000', configDir: null, workspaces: [], agent: 'opencode' }
  const meta = { id: 'live-oc', title: 'Live', profileId: profile.id, workspace, createdAt: new Date().toISOString() }
  let thread = newThread(meta)
  let models: string[] = []
  let asked = 0
  let lastError = ''
  // OpenCode lists free models that it has since retired; the check takes the first that answers.
  let freeModel: string | undefined

  const runner = (sessionId?: string) => {
    let done: () => void = () => {}
    const ended = () => new Promise<void>((resolve) => (done = resolve))
    const r: InstanceType<typeof AgentRunner> = new AgentRunner(
      { threadId: meta.id, workspace, profile, configDirs: [null], sessionId, mode: 'auto', model: freeModel },
      {
        line: (_raw, ev) => {
          thread = reduce(thread, ev)
          if (ev.type === 'acp/end') done()
        },
        record: (rec) => {
          thread = reduce(thread, rec)
          if (rec.type === 'vellum/error') {
            lastError = rec.text
            done()
          }
        },
        ask: (a) => {
          asked++
          r.answer(a.requestId, { allow: true })
        },
        askGone: () => {},
        models: (list) => void (models = list.map((m) => m.value)),
      },
    )
    return { r, ended }
  }

  const reply = () => {
    const last = [...thread.blocks].reverse().find((b) => b.kind === 'assistant') as any
    return String(last?.markdown ?? '')
  }
  const turn = async (r: ReturnType<typeof runner>, text: string) => {
    lastError = ''
    const end = r.ended()
    thread = reduce(thread, { type: 'vellum/user', text, tags: [], at: new Date().toISOString() })
    r.r.send(text)
    await Promise.race([end, Bun.sleep(180_000)])
  }

  const one = runner()
  await turn(one, 'Reply with just: ok')
  for (const candidate of models.filter((m) => m.endsWith('-free') || m.endsWith('big-pickle'))) {
    if (!lastError) break
    lastError = ''
    freeModel = candidate
    one.r.setModel(candidate)
    await turn(one, 'Reply with just: ok')
  }
  expect('a free model answers', !lastError && reply().length > 0, freeModel ?? 'the default')
  await turn(one, 'Create a file named hello.txt in the current folder containing exactly the word hi. Then reply with just: done')
  expect('OpenCode offers its free models', models.some((m) => m.endsWith('-free')), models.slice(0, 3).join(', '))
  expect('a turn under Build writes the file', (await Bun.file(path.join(workspace, 'hello.txt')).text().catch(() => '')).trim() === 'hi', `asked ${asked} time(s)`)
  expect('the reply lands in the note', reply().length > 0, reply().slice(0, 60))
  expect('a session id is kept for resuming', Boolean(thread.claudeSessionId))
  one.r.setMode('plan')
  await turn(one, 'What does hello.txt contain? Reply with only its content.')
  expect('Plan answers from the file', /hi/i.test(reply()), reply().slice(0, 60))
  await one.r.dispose()

  const two = runner(thread.claudeSessionId)
  await turn(two, 'What was the name of the file you created earlier? Reply with only the file name.')
  expect('a new process resumes the same conversation', /hello\.txt/i.test(reply()), reply().slice(0, 60))
  await two.r.dispose()
  expect('OpenCode shows only Build and Plan', agentModes(agents.opencode).map((m) => m.label).join(',') === 'Plan,Build', agentModes(agents.opencode).map((m) => m.label).join(','))

  // Approvals: a project config of OpenCode's own (opencode.json in the folder) makes it ask before
  // edits and commands. One of each is allowed, a second command is denied.
  const asking = await scratchDir('vellum-agents-live-oc-ask-')
  await Bun.write(path.join(asking, 'opencode.json'), JSON.stringify({ $schema: 'https://opencode.ai/config.json', permission: { edit: 'ask', bash: 'ask' } }))
  const askMeta = { ...meta, id: 'live-oc-ask', workspace: asking }
  let askThread = newThread(askMeta)
  const cards: { tool: string; title: string; detail: string; patch?: string; options: string }[] = []
  let deny = false
  let finish: () => void = () => {}
  const r3: InstanceType<typeof AgentRunner> = new AgentRunner(
    { threadId: askMeta.id, workspace: asking, profile, configDirs: [null], mode: 'auto', model: freeModel },
    {
      line: (_raw, ev) => {
        askThread = reduce(askThread, ev)
        if (ev.type === 'acp/end') finish()
      },
      record: (rec) => {
        askThread = reduce(askThread, rec)
        if (rec.type === 'vellum/error') {
          lastError = rec.text
          finish()
        }
      },
      ask: (a) => {
        cards.push({ tool: a.tool, title: a.title, detail: a.detail, patch: a.patch, options: Object.entries(a.optionIds ?? {}).filter(([, v]) => v).map(([k]) => k).join('/') })
        r3.answer(a.requestId, deny ? { allow: false } : { allow: true })
      },
      askGone: () => {},
    },
  )
  const askTurn = async (text: string) => {
    lastError = ''
    const end = new Promise<void>((resolve) => (finish = resolve))
    askThread = reduce(askThread, { type: 'vellum/user', text, tags: [], at: new Date().toISOString() })
    r3.send(text)
    await Promise.race([end, Bun.sleep(180_000)])
  }
  await askTurn('Create a file named notes.md in the current folder containing exactly the line: # Notes. Then reply with just: done')
  const edit = cards.find((c) => c.tool === 'Edit' || c.tool === 'Write')
  console.log(`  cards: ${cards.map((c) => `${c.tool} · ${c.title} · ${c.detail.slice(0, 50).replace(/\n/g, ' ')} [${c.options}]`).join(' | ') || '(none)'}`)
  expect('OpenCode asks before writing a file', Boolean(edit), cards.map((c) => c.tool).join(','))
  expect('…and the card names the file', Boolean(edit?.title.includes('notes.md')), edit?.title)
  expect('…and shows what it will write', Boolean(edit?.patch?.includes('+# Notes')), edit?.patch?.slice(0, 80))
  expect('…offering allow, always and reject', edit?.options === 'allow/always/reject', edit?.options)
  expect('the file lands once allowed', (await Bun.file(path.join(asking, 'notes.md')).text().catch(() => '')).trim() === '# Notes')
  const before = cards.length
  await askTurn('Run this shell command in the current folder: echo ok > ran.txt. Then reply with just: done')
  const run = cards.slice(before).find((c) => c.tool === 'Bash')
  console.log(`  cards: ${cards.slice(before).map((c) => `${c.tool} · ${c.title} · ${c.detail.slice(0, 60)}`).join(' | ') || '(none)'}`)
  expect('OpenCode asks before a command, and the card shows it', Boolean(run?.detail.includes('ran.txt')), run ? `${run.title} · ${run.detail}` : 'no command card')
  expect('the command ran once allowed', await Bun.file(path.join(asking, 'ran.txt')).exists())
  deny = true
  const denied = cards.length
  await askTurn('Run this shell command in the current folder: echo no > denied.txt. Then reply with just: done')
  expect('a denied command asks first', cards.length > denied, `${cards.length - denied} card(s)`)
  expect('…and doesn’t run', !(await Bun.file(path.join(asking, 'denied.txt')).exists()))
  const shell = askThread.blocks.filter((b) => b.kind === 'shell').map((b: any) => b.command)
  const edits = askThread.blocks.filter((b) => b.kind === 'edit').map((b: any) => `${b.path} +${b.added} -${b.removed}`)
  const why = askThread.blocks.filter((b) => b.kind === 'edit').map((b: any) => `${b.status}${b.error ? `: ${String(b.error).replace(/\s+/g, " ").slice(0, 300)}` : ''}`)
  console.log(`  note: shell [${shell.join(' | ')}] · edits [${edits.join(' | ')}] · ${why.join(' | ')}`)
  expect('the note shows the write with its diff, and the commands as themselves', edits.some((e) => e === 'notes.md +1 -0') && shell.some((c) => c.includes('ran.txt')), `${edits.join(',')} / ${shell.join(',')}`)
  await r3.dispose()
}

// ---------------------------------------------------------------- Codex (no prompt)

if (process.argv.includes('--codex')) {
  if (agents.codex.missing()) console.log(`skip Codex: ${agents.codex.missing()}`)
  else {
    // Your own Codex sign-in, not the scratch home: there's no turn, and the session is deleted.
    delete process.env.XDG_DATA_HOME
    const profile: Profile = { id: 'cx', name: 'Codex', color: '#000', configDir: null, workspaces: [], agent: 'codex' }
    const cwd = await scratchDir('vellum-agents-live-codex-')
    const conn = new AcpConnection(agentArgv(profile), { cwd, env: agentEnv(profile) }, { request: async () => null, notification: () => {} })
    try {
      await conn.request('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'vellum-check', version: '0' } })
      const res: any = await conn.request('session/new', { cwd, mcpServers: [] })
      let options: any[] = res.configOptions ?? []
      const current = (key: string) => options.find((o) => o.category === key || o.id === key)?.currentValue
      for (const [id, mode] of Object.entries(agents.codex.modes)) {
        for (const [key, value] of Object.entries(mode!.set)) {
          const opt = options.find((o) => o.category === key || o.id === key)
          if (!opt || opt.currentValue === value) continue
          const changed: any = await conn.request('session/set_config_option', { sessionId: res.sessionId, configId: opt.id, value })
          options = changed?.configOptions ?? options
        }
        expect(`Codex takes Vellum's ${id}`, Object.entries(mode!.set).every(([k, v]) => current(k) === v), Object.keys(mode!.set).map((k) => `${k}=${current(k)}`).join(' '))
      }
      await conn.request('session/delete', { sessionId: res.sessionId }).catch(() => undefined)
    } finally {
      conn.kill()
      await conn.exited
    }
  }
}

// ---------------------------------------------------------------- Codex (one real turn)

if (process.argv.includes('--codex-turn') && !agents.codex.missing()) {
  delete process.env.XDG_DATA_HOME
  const workspace = await scratchDir('vellum-agents-live-codex-turn-')
  const profile: Profile = { id: 'cx', name: 'Codex', color: '#000', configDir: null, workspaces: [], agent: 'codex' }
  const meta = { id: 'live-cx', title: 'Live', profileId: profile.id, workspace, createdAt: new Date().toISOString() }
  let thread = newThread(meta)
  const asks: { tool: string; title: string; detail: string }[] = []
  let errors = ''
  let done: () => void = () => {}
  const ended = new Promise<void>((resolve) => (done = resolve))
  const r: InstanceType<typeof AgentRunner> = new AgentRunner(
    { threadId: meta.id, workspace, profile, configDirs: [null], mode: 'acceptEdits', model: 'gpt-6-luna', think: 'off' },
    {
      line: (_raw, ev) => {
        thread = reduce(thread, ev)
        if (ev.type === 'acp/end') done()
      },
      record: (rec) => {
        thread = reduce(thread, rec)
        if (rec.type === 'vellum/error') {
          errors += rec.text
          done()
        }
      },
      ask: (a) => {
        asks.push({ tool: a.tool, title: a.title, detail: a.detail })
        r.answer(a.requestId, { allow: true })
      },
      askGone: () => {},
    },
  )
  const text = 'Create a file named hello.txt in the current folder containing exactly the word hi. Then reply with just: done'
  thread = reduce(thread, { type: 'vellum/user', text, tags: [], at: new Date().toISOString() })
  r.send(text)
  await Promise.race([ended, Bun.sleep(300_000)])
  const reply = String(([...thread.blocks].reverse().find((b) => b.kind === 'assistant') as any)?.markdown ?? '')
  const tools = thread.blocks.filter((b) => b.kind !== 'assistant' && b.kind !== 'user').map((b: any) => `${b.kind}: ${b.command ?? b.path ?? b.items?.map((i: any) => i.title ?? i.name).join(' / ') ?? ''}`)
  expect('Codex: the turn ends without an error', !errors, errors.slice(0, 120))
  // Edits writes in the folder without asking; any card it does show must read as a command.
  expect('…any approval reads as a command', asks.every((a) => a.tool === 'Bash' && a.detail.length > 0), asks.map((a) => `${a.tool} · ${a.detail.slice(0, 60)}`).join(' | '))
  expect('the file lands', (await Bun.file(path.join(workspace, 'hello.txt')).text().catch(() => '')).trim() === 'hi')
  expect('the reply lands in the note', reply.length > 0, reply.slice(0, 60))
  console.log(`  note blocks: ${tools.join(' | ') || '(none besides the reply)'}`)
  console.log(`  reply: ${reply.slice(0, 300).replace(/\n/g, ' ')}`)
  const sessionId = thread.claudeSessionId
  await r.dispose()
  if (sessionId) {
    const conn = new AcpConnection(agentArgv(profile), { cwd: workspace, env: agentEnv(profile) }, { request: async () => null, notification: () => {} })
    try {
      await conn.request('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'vellum-check', version: '0' } })
      await conn.request('session/delete', { sessionId }).catch(() => undefined)
    } finally {
      conn.kill()
      await conn.exited
    }
  }
}

console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
