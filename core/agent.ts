// One ACP agent process per open note, speaking to the Claude ACP adapter
// (@agentclientprotocol/claude-agent-acp), which runs your installed `claude` through the Claude
// Agent SDK (CLAUDE_CODE_EXECUTABLE). See spikes/acp-turn.ts for the message shapes.
//
// The process starts on the first message: initialize, then session/new or session/resume (our
// .jsonl already holds the history, so nothing is replayed). Mode, model and effort are the
// session's config options and change live. Permission asks are session/request_permission
// requests, answered with one of the options they offer. Every session/update is handed back as an
// `acp/update` record; the reducer turns them into blocks.
//
// Before a session is resumed, nothing else may have it open (core/locks.ts).
//
// In a git repo, each of your messages snapshots the working tree as it goes out, and every turn
// end records what changed since (core/gitsnap.ts): a `vellum/git-changes` record.

// realpath has no Bun.file counterpart: node:fs.
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { createTwoFilesPatch } from 'diff'
import type { RequestPermissionRequest, SessionConfigOption, SessionNotification } from '@agentclientprotocol/sdk'
import { AcpConnection, RpcFailure } from './acp'
import { bridgeAgent } from './bridge'
import { closeBrowser, helperDir } from './browser'
import { beginBrowserRun, endBrowserRun } from './browser-runtime'
import { defaultClaudeJson, linkAccount, mergeMcpServers } from './accounts'
import { defaultMode, describe, type Ask, type PermissionMode, type Think } from './asks'
import { filePatch } from './files'
import { changedFiles, snapshot, type Snapshot } from './gitsnap'
import { acquire, liveHolder, release } from './locks'
import { effortLabel, effortValue, type EffortOption, type ModelOption } from './models'
import { agentFor, modeFor, modeFromOptions } from './agents'
import { compiled, imageMime } from './platform'
import type { Profile } from './profiles'
import { profileEnv } from './profiles'
import { systemPromptText } from './prompt'
import { formQuestions, questionError, type QuestionContent } from './questions'
import { patchFromInput, relPath, writesWhole, type AcpRecord, type VellumRecord } from './threads'
import { normalizeToolCall, toolName } from './tools'
import { mcp, mcpKey, readTool, type McpApproval } from './mcp'

export type RunnerTarget = {
  threadId: string
  workspace: string
  profile: Profile
  /** Config dirs of every account, for the one-writer check. */
  configDirs: (string | null)[]
  sessionId?: string
  mode?: PermissionMode
  think?: Think
  /** A model value from the agent's list; undefined is the account's default. */
  model?: string
}

type Listener = {
  /** An ACP record for the thread's log (session started, an update, a turn ended). */
  line(raw: string, ev: AcpRecord): void
  /** A record Vellum derived itself (errors). */
  record(rec: VellumRecord): void
  ask(a: Ask): void
  askGone(requestId: string): void
  /** The agent changed the mode itself (e.g. leaving plan mode). */
  modeChanged?(mode: PermissionMode): void
  models?(list: ModelOption[]): void
  efforts?(list: EffortOption[]): void
  /** Who this account is, from the adapter's `_auth/status_update`. */
  account?(a: { email?: string; plan?: string; label?: string }): void
  /** Something worth a toast, not a place in the note (a merged link, an MCP clash). */
  notice?(text: string): void
}

/** A message as ACP content: pasted images ahead of the text. */
async function promptBlocks(text: string, images: string[]) {
  const files = await Promise.all(images.map(async (f) => ((await Bun.file(f).exists()) ? { f, bytes: await Bun.file(f).bytes() } : undefined)))
  const pictures = files.filter((x) => x !== undefined).map(({ f, bytes }) => ({ type: 'image', mimeType: imageMime(f), data: bytes.toBase64() }))
  return [...pictures, ...(text ? [{ type: 'text', text }] : [])]
}

/** Thinking maps onto the adapter's effort option: off is its lowest level, max its highest. */
const effortFor = (t: Think) => (t === 'off' ? 'low' : t === 'on' ? 'default' : t)

/**
 * The account's agent program (core/agents.ts). VELLUM_AGENT swaps in a fake for checks, whatever
 * the account's agent.
 */
export function agentArgv(profile: Pick<Profile, 'agent'>): string[] {
  if (process.env.VELLUM_AGENT) return compiled ? [process.execPath, '--run', process.env.VELLUM_AGENT] : [process.execPath, process.env.VELLUM_AGENT]
  return agentFor(profile).argv()
}

/** The agent's environment for an account: its home, its CLI, and Vellum's helpers on PATH. */
export function agentEnv(profile: Profile, noteId?: string): Record<string, string> {
  const pairing = noteId ? bridgeAgent(noteId) : undefined
  return { ...profileEnv(profile), PATH: `${helperDir()}${path.delimiter}${process.env.PATH ?? ''}`, VELLUM_EXEC_PATH: process.execPath, VELLUM_COMPILED: compiled ? '1' : '0', VELLUM_BROWSER_SCRIPT: path.resolve(import.meta.dir, '../scripts/browser.ts'), ...(pairing ? { VELLUM_NOTE_ID: noteId!, VELLUM_BRIDGE: pairing.endpoint, VELLUM_TOKEN: pairing.token } : {}) }
}

const sentence = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s)

/** An ACP diff (an agent's before and after of one file) as the patch an approval card shows. */
function diffPatch(workspace: string, diff: { path?: string; oldText?: string | null; newText?: string }): string {
  const rel = relPath(workspace, String(diff.path ?? ''))
  return createTwoFilesPatch(rel, rel, String(diff.oldText ?? ''), String(diff.newText ?? ''), '', '', { context: 3 })
}

const live = new Set<AgentRunner>()

type Pending = { ask: Ask; resolve: (outcome: unknown) => void }

/** How long a turn waits, past the agent's own start, for the snapshot of your working tree. */
const SNAPSHOT_WAIT_MS = 1500

export class AgentRunner {
  #target: RunnerTarget
  #listener: Listener
  #conn: AcpConnection | undefined
  #ready: Promise<string | undefined> | undefined
  #session: string | undefined
  #config: SessionConfigOption[] = []
  #asks = new Map<string, Pending>()
  #turn = false
  #stopping = false
  /** The agent takes a message into the turn it's running (`_session/steering`). */
  #steering = false
  /** The turn's prompt is with the agent: before that (the agent still starting) there's nothing to steer. */
  #prompting = false
  /** The working tree as your latest message went out; undefined outside a repo. */
  #base?: Promise<Snapshot | undefined>
  #locked: string | undefined
  /** Vellum's prompt, still to go ahead of a new session's first message (agents without `systemPrompt`). */
  #prime: string | undefined
  #toolNames = new Map<string, string>()
  #activeTools = new Map<string, { name: string; runner: boolean }>()
  #mcpRevision = -1
  #starting = false

  constructor(target: RunnerTarget, listener: Listener) {
    this.#target = target
    this.#listener = listener
    live.add(this)
  }

  set sessionId(id: string | undefined) {
    this.#target = { ...this.#target, sessionId: id }
  }

  get running() {
    return this.#conn !== undefined && !this.#conn.closed
  }

  get mode(): PermissionMode {
    return this.#target.mode ?? defaultMode
  }

  setMode(mode: PermissionMode) {
    this.#target = { ...this.#target, mode }
    for (const [key, value] of this.#modeSettings(mode)) this.#setConfig(key, value)
  }

  /** The config options that make a Vellum mode on this note's agent (core/agents.ts). */
  #modeSettings(mode: PermissionMode | undefined): [string, string][] {
    const agent = agentFor(this.#target.profile)
    return Object.entries(agent.modes[modeFor(agent, mode)]?.set ?? {})
  }

  setModel(model: string | undefined) {
    this.#target = { ...this.#target, model }
    this.#setConfig('model', model ?? 'default')
  }

  setThink(think: Think) {
    this.#target = { ...this.#target, think }
    this.#setConfig('thought_level', effortFor(think))
  }

  /** Answer an ask with one of the options it offered. A deny with a note sends the note next. */
  answer(requestId: string, decision: { allow: true; always?: boolean } | { allow: false; message?: string }) {
    const p = this.#asks.get(requestId)
    if (!p || p.ask.questions) return
    this.#asks.delete(requestId)
    const ids = p.ask.optionIds ?? {}
    const optionId = decision.allow ? ((decision.always && ids.always) || ids.allow) : ids.reject
    p.resolve(optionId ? { outcome: { outcome: 'selected', optionId } } : { outcome: { outcome: 'cancelled' } })
    // ACP's reject carries no reason; the note goes in as your next message (the adapter queues it).
    if (!decision.allow && decision.message?.trim()) this.send(decision.message.trim(), [], true)
  }

  answerQuestions(requestId: string, content: QuestionContent | null) {
    const pending = this.#asks.get(requestId)
    if (!pending?.ask.questions) return
    if (content && pending.ask.questions.some((question) => questionError(question, content))) return
    const result = content ? { ...content } : undefined
    if (result) for (const question of pending.ask.questions) {
      if ((question.kind === 'number' || question.kind === 'integer') && result[question.id] !== undefined && result[question.id] !== '') result[question.id] = Number(result[question.id])
    }
    this.#asks.delete(requestId)
    pending.resolve(result ? { action: 'accept', content: result } : { action: 'cancel' })
  }

  /** Associate only an unambiguous live call; parallel runners are never guessed. */
  toolParent(name: string) {
    const live = [...this.#activeTools]
    const direct = live.filter(([, call]) => call.name === name || call.name.replace(/^mcp__.+?__/, '') === name.replace(/^mcp__.+?__/, ''))
    if (direct.length === 1) return direct[0]![0]
    if (direct.length > 1) return
    const runners = live.filter(([, call]) => call.runner)
    return runners.length === 1 ? runners[0]![0] : undefined
  }

  /** Vellum's MCP proxy gates the actual invocation, including agents in automatic modes. */
  approveMcp: McpApproval = async (server, tool, input, signal) => {
    if (signal.aborted || !this.#turn) return 'deny'
    const requestId = `mcp:${crypto.randomUUID()}`
    const ask: Ask = { requestId, threadId: this.#target.threadId, tool: `mcp__${server.name}__${tool.name}`, title: tool.title || tool.name, detail: JSON.stringify(input, null, 2), input, reason: tool.description, at: new Date().toISOString(), optionIds: { allow: 'allow', reject: 'deny', ...(readTool(tool) ? { always: 'reads' } : {}) }, ...(readTool(tool) ? { alwaysLabel: `Always allow tools marked read-only by ${server.name}`, suggestions: ['reads'] } : {}) }
    return new Promise((resolve) => {
      const cancel = () => { if (this.#asks.delete(requestId)) { this.#listener.askGone(requestId); resolve('deny') } }
      this.#asks.set(requestId, { ask, resolve: (answer: any) => { signal.removeEventListener('abort', cancel); resolve(answer?.outcome?.optionId === 'allow' ? 'allow' : answer?.outcome?.optionId === 'reads' ? 'reads' : 'deny') } })
      signal.addEventListener('abort', cancel, { once: true })
      this.#listener.ask(ask)
    })
  }

  /**
   * A turn: your text, and any pasted images as ACP image blocks ahead of it. `follow` is a note
   * sent with a "no": it belongs to the same turn, so the snapshot taken for your message stands.
   */
  send(text: string, images: string[] = [], follow = false) {
    this.#turn = true
    beginBrowserRun(this.#target.threadId)
    const workspace = this.#target.workspace
    // Taken while the agent starts, so it usually costs the turn nothing; before the prompt, so nothing has changed yet.
    if (!follow || !this.#base) this.#base = snapshot(workspace).catch(() => undefined)
    const base = this.#base
    this.#start()
      .then(async (sessionId) => {
        if (!sessionId) return
        // A slow first snapshot (a huge untracked folder) isn't waited on: this turn goes without,
        // and the snapshot carries on warming git's cache for the next one.
        const before = await Promise.race([base, Bun.sleep(SNAPSHOT_WAIT_MS).then(() => 'late' as const)])
        if (before === 'late' && this.#base === base) this.#base = Promise.resolve(undefined)
        this.#prompting = true
        const prime = this.#prime
        this.#prime = undefined
        const prompt = [...(prime ? [{ type: 'text', text: `About the app you're running in (from Vellum, not the user):\n\n${prime}` }] : []), ...(await promptBlocks(text, images))]
        const res: any = await this.#conn!.request('session/prompt', { sessionId, prompt }).finally(() => {
          this.#prompting = false
        })
        if (before && before !== 'late') {
          const after = await snapshot(workspace).catch(() => undefined)
          const files = after ? await changedFiles(before, after, workspace).catch(() => []) : []
          if (files.length) this.#listener.record({ type: 'vellum/git-changes', files })
        }
        this.#end({ type: 'acp/end', stopReason: res?.stopReason ?? 'end_turn' })
      })
      .catch((e) => this.#fail(e))
  }

  /** Whether this agent said, as it started, that it takes messages mid-turn at all. */
  get steers() {
    return this.#steering
  }

  /** Whether a message now could go into the running turn rather than wait for the next one. */
  get canSteer() {
    return this.#steering && this.#turn && this.#prompting && !this.#stopping && this.#session !== undefined && this.#conn !== undefined && !this.#conn.closed
  }

  /**
   * Your message into the turn Claude is running: it reads it as soon as it can (mid-reply, or
   * when the tool it's in returns; a question or approval card waits for your answer first), and
   * the turn ends once it has answered it. `promptRequired`: the turn had ended by the time it
   * arrived, so nothing was sent and the caller sends it as a turn of its own. `unavailable`: this
   * agent can't steer, or there's no turn.
   */
  async steer(text: string, images: string[] = []): Promise<'injected' | 'promptRequired' | 'unavailable'> {
    if (!this.canSteer) return 'unavailable'
    try {
      const res: any = await this.#conn!.request('_session/steering', {
        sessionId: this.#session,
        prompt: await promptBlocks(text, images),
        // An idle session says so instead of starting a turn Vellum didn't open.
        _meta: { steering: { idleBehavior: 'promptRequired' } },
      })
      return res?.outcome === 'injected' ? 'injected' : 'promptRequired'
    } catch {
      return 'unavailable'
    }
  }

  /** Stop the current turn. The session stays; the next message continues it. */
  interrupt() {
    if (!this.#conn || !this.#session) return
    this.#stopping = true
    this.#conn.notify('session/cancel', { sessionId: this.#session })
    this.#dropAsks()
    // An agent that doesn't settle the prompt soon after a cancel is ended the hard way.
    const conn = this.#conn
    setTimeout(() => {
      if (this.#turn && this.#conn === conn) conn.kill()
    }, 4000)
  }

  /** End the process (closing the note, switching account). Resolves once it has exited. */
  async dispose() {
    live.delete(this)
    const browserCleanup = closeBrowser(this.#target.threadId).catch(() => {
      this.#listener.record({ type: 'vellum/error', text: 'Browser cleanup failed. Reconnect this note and retry disconnect.' })
    })
    const conn = this.#conn
    this.#dropAsks()
    if (conn) {
      conn.kill()
      await conn.exited
    }
    if (this.#locked) await release(this.#locked)
    await browserCleanup
  }

  // ---------------------------------------------------------------- lifecycle

  #start(): Promise<string | undefined> {
    if (this.#starting) return this.#ready!
    if (this.#ready && this.#conn && !this.#conn.closed && (this.#mcpRevision === mcp.revision || this.#prompting)) return this.#ready
    this.#starting = true
    const previous = this.#conn
    this.#conn = undefined
    this.#ready = (async () => {
      if (previous && !previous.closed) { previous.kill(); await previous.exited }
      if (this.#locked) { await release(this.#locked); this.#locked = undefined }
      return this.#open()
    })().finally(() => { this.#starting = false })
    return this.#ready
  }

  async #open(): Promise<string | undefined> {
    const { workspace, profile, sessionId, threadId } = this.#target
    if (sessionId) {
      const holder = await liveHolder(sessionId, this.#target.configDirs)
      if (holder) {
        this.#listener.record({ type: 'vellum/error', text: `This conversation is open in ${holder.where} (pid ${holder.pid}). Close it there first, so only one place writes to it.` })
        endBrowserRun(this.#target.threadId)
    this.#turn = false
        return
      }
      if (!(await acquire(sessionId, { threadId, profileId: profile.id }))) {
        this.#listener.record({ type: 'vellum/error', text: 'This conversation is open in another Vellum window.' })
        endBrowserRun(this.#target.threadId)
    this.#turn = false
        return
      }
      this.#locked = sessionId
    }
    this.#stopping = false
    this.#prepare(profile)
    const conn = new AcpConnection(agentArgv(profile), { cwd: workspace, env: agentEnv(profile, threadId) }, {
      request: (method, params, id) => this.#onRequest(method, params, id),
      notification: (method, params) => this.#onNotification(method, params),
    })
    this.#conn = conn
    conn.exited.then((code) => {
      if (this.#conn !== conn) return
      this.#conn = undefined
      this.#dropAsks()
      if (this.#turn) {
        endBrowserRun(this.#target.threadId)
    this.#turn = false
        if (this.#stopping) this.#listener.record({ type: 'vellum/stopped' })
        else this.#listener.record({ type: 'vellum/error', text: `The agent exited with code ${code}${conn.stderrTail ? `\n${conn.stderrTail}` : ''}` })
      }
    })

    const init: any = await conn.request('initialize', {
      protocolVersion: 1,
      // Each capability is an object: `form: true` fails ACP's schema and is silently dropped, and
      // without form support the adapter starts claude with --disallowedTools=AskUserQuestion.
      clientCapabilities: { auth: { terminal: true }, session: { compaction: {} }, elicitation: { form: {} }, _meta: { terminal_output_delta: true } },
      clientInfo: { name: 'vellum', title: 'Vellum', version: '0.1.0' },
    })
    const canResume = Boolean(init?.agentCapabilities?.sessionCapabilities?.resume)
    // Steering is an extension: advertised in the response's top-level `_meta`, beside the capabilities.
    this.#steering = init?._meta?.steering?.supported === true
    // What Vellum draws for the agent's tools, after its own prompt, for agents that take one.
    const agent = agentFor(profile)
    const promptText = systemPromptText(agent.claudeCode)
    const systemPrompt = init?.agentCapabilities?.sessionCapabilities?.systemPrompt ? { mode: 'append', content: [{ type: 'text', text: promptText }] } : undefined
    const pairing = bridgeAgent(threadId)
    const script = compiled ? path.join(helperDir(), 'vellum-mcp.ts') : path.resolve(import.meta.dir, '../scripts/vellum-mcp.ts')
    const mcpServers = pairing ? [{ name: 'vellum', command: process.execPath, args: [...(compiled ? ['--run'] : []), script], env: [{ name: 'VELLUM_NOTE_ID', value: threadId }, { name: 'VELLUM_BRIDGE', value: pairing.endpoint }, { name: 'VELLUM_TOKEN', value: pairing.token }] }] : []
    if (pairing) for (const server of mcp.configured()) mcpServers.push({ ...mcpServers[0]!, name: mcpKey(server), env: [...mcpServers[0]!.env, { name: 'VELLUM_MCP_SERVER', value: server.id }] })
    this.#mcpRevision = mcp.revision
    const params = { cwd: workspace, mcpServers, ...(systemPrompt ? { systemPrompt } : {}) }
    let res: any
    let id = sessionId
    if (id && canResume) {
      try {
        res = await conn.request('session/resume', { ...params, sessionId: id })
      } catch (e) {
        // Gone from this account's history (or never there): start over, and say so.
        this.#listener.record({ type: 'vellum/error', text: `Couldn't continue the earlier conversation (${e instanceof RpcFailure ? e.error.message : String(e)}). This message starts a new one.` })
        id = undefined
      }
    } else id = undefined
    if (!id) {
      res = await conn.request('session/new', params)
      id = String(res.sessionId)
      // An agent without ACP's systemPrompt reads Vellum's part once, ahead of the session's first message.
      this.#prime = systemPrompt ? undefined : promptText
      if (this.#locked) await release(this.#locked)
      await acquire(id, { threadId, profileId: profile.id })
      this.#locked = id
    }
    this.#session = id
    this.#target = { ...this.#target, sessionId: id }
    this.#emit({ type: 'acp/session', sessionId: id, agent: agent.id, profileId: profile.id })
    // The agent's starting values are where it begins, not a change it made: your picks go on top.
    this.#takeConfig(res?.configOptions, false)
    const want: [string, string][] = this.#modeSettings(this.#target.mode ?? defaultMode)
    const model = this.#target.model ?? agent.defaultModel?.value
    if (model) want.push(['model', model])
    if (this.#target.think && this.#target.think !== 'on') want.push(['thought_level', effortFor(this.#target.think)])
    for (const [cat, value] of want) await this.#applyConfig(cat, value)
    return id
  }

  /**
   * Before an account's agent starts: its links to ~/.claude are right, and it has every MCP
   * server the other accounts have. Nothing of this account is running yet, so its .claude.json
   * has no other writer.
   */
  #prepare(profile: Profile) {
    if (!profile.configDir || !agentFor(profile).claudeCode) return
    try {
      const fixed = linkAccount(profile.id, profile.configDir).filter((a) => a.did !== 'linked')
      if (fixed.length)
        this.#listener.notice?.(`${profile.name}: merged ${fixed.map((a) => a.name).join(', ')} into ~/.claude${fixed.some((a) => a.backup) ? ' (the old copies are in ~/.vellum/backups)' : ''}`)
      const others = [defaultClaudeJson(), ...this.#target.configDirs.filter((d): d is string => Boolean(d) && d !== profile.configDir).map((d) => path.join(d, '.claude.json'))]
      const mcp = mergeMcpServers(path.join(profile.configDir, '.claude.json'), others)
      if (mcp.conflicts.length) this.#listener.notice?.(`MCP servers set up differently on two accounts: ${mcp.conflicts.join(', ')}. ${profile.name} uses the most recent.`)
    } catch (e) {
      this.#listener.notice?.(`Couldn't link ${profile.name} to ~/.claude: ${String((e as Error)?.message ?? e)}`)
    }
  }

  // ---------------------------------------------------------------- config options

  #option(category: string) {
    return this.#config.find((o: any) => o.category === category || o.id === category)
  }

  /** Take the agent's config. `react`: report a mode the agent switched to on its own. */
  #takeConfig(options: SessionConfigOption[] | undefined, react = true) {
    if (!Array.isArray(options)) return
    this.#config = options
    const model: any = this.#option('model')
    if (model?.options) {
      const flat = model.options.flatMap((x: any) => x.options ?? [x])
      const list: ModelOption[] = flat.map((x: any) => ({ value: String(x.value), displayName: String(x.name ?? x.value), description: x.description ?? undefined }))
      if (list.length) this.#listener.models?.(list)
    }
    const effort: any = this.#option('thought_level')
    if (effort?.options) {
      const flat = effort.options.flatMap((x: any) => x.options ?? [x])
      const list: EffortOption[] = flat.flatMap((x: any) => {
        const value = effortValue(String(x.value))
        return value ? [{ value, displayName: x.name && x.name !== x.value ? String(x.name) : effortLabel(value), description: x.description ?? undefined }] : []
      })
      if (list.length) this.#listener.efforts?.(list)
    }
    if (react) this.#modeFromAgent()
  }

  /** The agent changed its mode itself (Claude leaving plan mode): say which Vellum mode that is. */
  #modeFromAgent() {
    if (!this.#session) return
    const m = modeFromOptions(agentFor(this.#target.profile), (key) => {
      const value = (this.#option(key) as any)?.currentValue
      return value === undefined ? undefined : String(value)
    })
    if (m && m !== modeFor(agentFor(this.#target.profile), this.mode)) {
      this.#target = { ...this.#target, mode: m }
      this.#listener.modeChanged?.(m)
    }
  }

  async #applyConfig(category: string, value: string) {
    const opt: any = this.#option(category)
    if (!opt || !this.#session || !this.#conn || opt.currentValue === value) return
    const values = (opt.options ?? []).flatMap((x: any) => x.options ?? [x]).map((x: any) => x.value)
    if (values.length && !values.includes(value)) return
    try {
      const res: any = await this.#conn.request('session/set_config_option', { sessionId: this.#session, configId: opt.id, value })
      // Our own change, not the agent's: a mode made of two options (Codex's plan) is half-set in between.
      this.#takeConfig(res?.configOptions, false)
    } catch (e) {
      this.#listener.record({ type: 'vellum/error', text: `Couldn't change ${opt.name ?? category}: ${e instanceof RpcFailure ? e.error.message : String(e)}` })
    }
  }

  #setConfig(category: string, value: string) {
    if (this.#session && this.#conn && !this.#conn.closed) void this.#applyConfig(category, value)
  }

  // ---------------------------------------------------------------- from the agent

  #emit(rec: AcpRecord) {
    this.#listener.line(JSON.stringify(rec), rec)
  }

  #end(rec: Extract<AcpRecord, { type: 'acp/end' }>) {
    endBrowserRun(this.#target.threadId)
    this.#turn = false
    this.#stopping = false
    this.#toolNames.clear()
    this.#activeTools.clear()
    this.#dropAsks()
    this.#emit(rec)
  }

  #fail(e: unknown) {
    if (!this.#turn && !(e instanceof RpcFailure)) return
    endBrowserRun(this.#target.threadId)
    this.#turn = false
    this.#toolNames.clear()
    this.#activeTools.clear()
    this.#dropAsks()
    const err = e instanceof RpcFailure ? e.error : { code: 0, message: String(e) }
    // Exits are reported by the exit handler, with stderr.
    if (err.code === -32099) return
    const login = err.code === -32000 || /\b(authentication required|not logged in|not signed in|log ?in required|unauthorized)\b/i.test(err.message)
    this.#listener.record({ type: 'vellum/error', text: err.message, login })
  }

  #onNotification(method: string, params: any) {
    if (method === 'session/update') {
      let update = (params as SessionNotification).update as any
      if (update?.sessionUpdate === 'tool_call' || update?.sessionUpdate === 'tool_call_update') {
        const name = update.name || update._meta?.claudeCode?.toolName ? toolName(update) : this.#toolNames.get(update.toolCallId) ?? toolName(update)
        this.#toolNames.set(update.toolCallId, name)
        const input = normalizeToolCall(update).arguments
        if (update.status === 'completed' || update.status === 'failed') this.#activeTools.delete(update.toolCallId)
        else this.#activeTools.set(update.toolCallId, { name, runner: typeof input?.code === 'string' || this.#activeTools.get(update.toolCallId)?.runner === true })
        const definition = mcp.describeTool(name)
        if (definition) update = { ...update, _meta: { ...update._meta, vellumTool: definition } }
      }
      switch (update?.sessionUpdate) {
        // Large and only useful live (slash-command lists); not part of the note.
        case 'available_commands_update':
          return
        case 'config_option_update':
          this.#takeConfig(update.configOptions)
          return
        case 'current_mode_update':
          if (update.currentModeId) {
            const mode: any = this.#option('mode')
            if (mode) this.#config = this.#config.map((o) => (o === mode ? { ...mode, currentValue: String(update.currentModeId) } : o))
            this.#modeFromAgent()
          }
          return
      }
      this.#emit({ type: 'acp/update', update, at: new Date().toISOString() })
      return
    }
    if (method === '_auth/status_update') {
      const s = params?.authStatus
      if (s?.kind === 'account') this.#listener.account?.({ email: s.account?.email, plan: s.account?.plan, label: s.label })
    }
  }

  async #onRequest(method: string, params: any, id: number | string): Promise<unknown> {
    if (method === 'elicitation/create') {
      if (params.mode && params.mode !== 'form') throw new RpcFailure(method, { code: -32602, message: 'Only question forms are supported' })
      let questions: Ask['questions']
      try { questions = formQuestions(String(params.message ?? ''), params.requestedSchema) }
      catch (error) { throw new RpcFailure(method, { code: -32602, message: String((error as Error).message) }) }
      const ask: Ask = { requestId: String(id), threadId: this.#target.threadId, tool: 'AskUserQuestion', title: questions[0]!.title, detail: String(params.message ?? ''), input: {}, questions, at: new Date().toISOString() }
      return new Promise((resolve) => {
        this.#asks.set(ask.requestId, { ask, resolve })
        this.#listener.ask(ask)
      })
    }
    if (method !== 'session/request_permission') throw new RpcFailure(method, { code: -32601, message: `Vellum does not handle ${method}` })
    const req = params as RequestPermissionRequest
    const call: any = req.toolCall ?? {}
    const normalized = normalizeToolCall(call)
    // The managed proxy performs the permission check at the actual call boundary.
    // Only our exact server namespaces qualify; arbitrary tools keep their ACP prompt.
    if (mcp.managedTool(normalized.name)) {
      const allow = req.options.find(option => option.kind === 'allow_once')
      return allow ? { outcome: { outcome: 'selected', optionId: allow.optionId } } : { outcome: { outcome: 'cancelled' } }
    }
    const named = normalized.name
    const raw = normalized.input ?? {}
    const tool = named === 'Edit' && !call._meta?.claudeCode && writesWhole(raw) ? 'Write' : named
    const input = tool === 'Bash' && !call._meta?.claudeCode ? { ...raw, command: Array.isArray(raw.command) ? raw.command.join(' ') : (raw.command ?? call.title ?? '') }
      : tool === 'Edit' && !raw.file_path && call.locations?.[0]?.path ? { ...raw, file_path: String(call.locations[0].path) }
      : raw
    const diff = (call.content ?? []).find((c: any) => c?.type === 'diff')
    const { title, detail } = describe(tool, input, this.#target.workspace, call.title)
    const byKind = (k: string) => req.options.find((o) => o.kind === k)
    const always = byKind('allow_always')
    const ask: Ask = {
      requestId: String(id),
      threadId: this.#target.threadId,
      tool,
      title,
      detail,
      input,
      reason: typeof input.description === 'string' ? input.description : undefined,
      patch: ['Edit', 'Write', 'MultiEdit'].includes(tool)
        ? (filePatch(this.#target.workspace, tool, input) ?? (diff ? diffPatch(this.#target.workspace, diff) : undefined) ?? patchFromInput(tool, input))
        : undefined,
      suggestions: always ? [always.optionId] : undefined,
      // The agent's own words for what "always" does, so you approve exactly that.
      alwaysLabel: always ? sentence(always.name.replace(/^yes,\s*(and\s+)?/i, '')) : undefined,
      optionIds: { allow: byKind('allow_once')?.optionId, always: always?.optionId, reject: byKind('reject_once')?.optionId ?? byKind('reject_always')?.optionId },
      at: new Date().toISOString(),
    }
    return new Promise((resolve) => {
      this.#asks.set(ask.requestId, { ask, resolve })
      this.#listener.ask(ask)
    })
  }

  #dropAsks() {
    for (const [rid, p] of this.#asks) {
      p.resolve(p.ask.questions ? { action: 'cancel' } : { outcome: { outcome: 'cancelled' } })
      this.#listener.askGone(rid)
    }
    this.#asks.clear()
  }
}

/** End every agent process on quit. */
export function killAllAgents() {
  for (const r of live) void r.dispose()
}

/** Why the account's agent can't run here (not installed, a broken install), or undefined when it can. */
export function agentMissing(profile: Pick<Profile, 'agent'>): string | undefined {
  if (process.env.VELLUM_AGENT) return Bun.file(realpathSync(process.env.VELLUM_AGENT)).size > 0 ? undefined : `No fake agent at ${process.env.VELLUM_AGENT}`
  return agentFor(profile).missing()
}
