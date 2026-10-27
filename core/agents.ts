// The agents a note can run, all over ACP. An account (core/profiles.ts) belongs to one of them,
// and everything that starts an agent for that account asks here: which program, where the
// agent keeps its sign-in and history, and whether it's installed.
//
// What an agent can do is read from its `initialize` answer and the session's config options,
// not from this table. VELLUM-V3-PLAN.md has what each one reported.
//
// - Claude: the bundled @agentclientprotocol/claude-agent-acp, running your installed `claude`.
// - Codex: the bundled @agentclientprotocol/codex-acp, pointed at your installed `codex`
//   (CODEX_PATH). The adapter ships its own Codex too, but that can't go into the compiled app.
// - OpenCode: your installed `opencode acp`. OpenCode speaks ACP itself.

import { homedir } from 'node:os'
import path from 'node:path'
import { defaultMode, modes as vellumModes, type PermissionMode } from './asks'
import { compiled } from './platform'

export type AgentId = 'claude' | 'codex' | 'opencode'

export type Agent = {
  id: AgentId
  /** How Vellum names it: "Claude", "Codex", "OpenCode". */
  title: string
  /** The ACP agent program. */
  argv(): string[]
  /** Points the agent at an account's own home, or at its default one when `home` is null. */
  home(env: Record<string, string>, home: string | null): void
  /** Why it can't run here, or undefined when it can. */
  missing(): string | undefined
  /**
   * Vellum's permission modes this agent has, each as the config options that make it (by
   * category or id) and, where the agent's own word is clearer, its label and hint. A value the
   * agent's session doesn't offer is never sent (core/agent.ts `#applyConfig`).
   */
  modes: Partial<Record<PermissionMode, { set: Record<string, string>; label?: string; hint?: string }>>
  /** Where a note on this agent starts when Vellum's default mode isn't one it has. */
  fallback: PermissionMode
  /** Claude Code's own extras: ~/.claude linking, slash commands, "Open in Claude Code". */
  claudeCode: boolean
  /**
   * The folders this agent loads skills from (each skill a folder with a SKILL.md), project ones
   * first: the `@` menu offers exactly the skills the agent can use. `home` is the account's own
   * home or null for the default one; `user` is the home directory.
   */
  skillRoots(workspace: string, home: string | null, user: string): string[]
  /** Where the agent keeps an account that uses its default home, as you'd write it. */
  defaultHome: string
  /** Vellum's default model when a note hasn't picked one explicitly. */
  defaultModel?: { value: string; displayName: string }
  /** Only one account of it for now (OpenCode). */
  single?: boolean
}

const bundled = (pkg: string, entry = 'dist/index.js') => Bun.fileURLToPath(import.meta.resolve(`${pkg}/${entry}`))
const present = (file: () => string) => {
  try {
    return Bun.file(file()).size > 0
  } catch {
    return false
  }
}

const tools = new Map<string, string | null>()
/** An installed command line tool, looked up once. */
export function tool(name: string): string | undefined {
  if (!tools.has(name)) tools.set(name, Bun.which(name))
  return tools.get(name) ?? undefined
}

const CLAUDE_ADAPTER = '@agentclientprotocol/claude-agent-acp'
const CODEX_ADAPTER = '@agentclientprotocol/codex-acp'

export const agents: Record<AgentId, Agent> = {
  claude: {
    id: 'claude',
    title: 'Claude',
    argv: () => (compiled ? [process.execPath, '--agent'] : [process.execPath, bundled(CLAUDE_ADAPTER)]),
    home(env, home) {
      if (home) env.CLAUDE_CONFIG_DIR = home
      else delete env.CLAUDE_CONFIG_DIR
      env.CLAUDE_CODE_EXECUTABLE = tool('claude') ?? 'claude'
    },
    missing: () => (compiled || present(() => bundled(CLAUDE_ADAPTER)) ? undefined : 'Vellum’s Claude adapter is missing. Reinstall Vellum.'),
    modes: {
      manual: { set: { mode: 'default' } },
      acceptEdits: { set: { mode: 'acceptEdits' } },
      plan: { set: { mode: 'plan' } },
      auto: { set: { mode: 'auto' } },
      dontAsk: { set: { mode: 'dontAsk' } },
      bypassPermissions: { set: { mode: 'bypassPermissions' } },
    },
    fallback: 'acceptEdits',
    claudeCode: true,
    skillRoots: (workspace, home, user) => [path.join(workspace, '.claude', 'skills'), path.join(home ?? path.join(user, '.claude'), 'skills')],
    defaultHome: '~/.claude',
  },
  codex: {
    id: 'codex',
    title: 'Codex',
    argv: () => (compiled ? [process.execPath, '--agent', 'codex'] : [process.execPath, bundled(CODEX_ADAPTER)]),
    home(env, home) {
      if (home) env.CODEX_HOME = home
      else delete env.CODEX_HOME
      const codex = tool('codex')
      if (codex) env.CODEX_PATH = codex
    },
    missing: () => (tool('codex') ? undefined : 'Codex isn’t installed. Install it with `npm install -g @openai/codex`, then sign in with `codex login`.'),
    // Codex's modes are sandboxes; planning is a separate option (`collaboration_mode`), so every
    // mode says which side of it it's on.
    modes: {
      // No Ask: Codex has no "ask before each edit". Its read-only sandbox was the nearest, and in
      // it Codex as often stopped as asked. A note set to Ask runs in Edits.
      acceptEdits: { set: { mode: 'workspace-write', collaboration_mode: 'default' }, hint: 'Edit this folder; ask before anything outside it or the network' },
      plan: { set: { mode: 'read-only', collaboration_mode: 'plan' } },
      auto: { set: { mode: 'agent', collaboration_mode: 'default' }, label: 'Auto review', hint: 'Codex asks only for actions it judges unsafe' },
      bypassPermissions: { set: { mode: 'agent-full-access', collaboration_mode: 'default' } },
    },
    fallback: 'acceptEdits',
    claudeCode: false,
    // The shared .agents folders, and Codex's own home.
    skillRoots: (workspace, home, user) => [path.join(workspace, '.agents', 'skills'), path.join(user, '.agents', 'skills'), path.join(home ?? path.join(user, '.codex'), 'skills')],
    defaultHome: '~/.codex',
  },
  opencode: {
    id: 'opencode',
    title: 'OpenCode',
    argv: () => [tool('opencode') ?? 'opencode', 'acp'],
    // One OpenCode account for now: its own default home. Its data lives under XDG folders that
    // other tools read too, so a second account needs more than an env var (VELLUM-V3-PLAN.md).
    home() {},
    missing: () => (tool('opencode') ? undefined : 'OpenCode isn’t installed. Install it from opencode.ai, then sign in with `opencode auth login`.'),
    // OpenCode's two agents. What Build asks about is OpenCode's own permission config.
    modes: {
      auto: { set: { mode: 'build' }, label: 'Build', hint: 'OpenCode works; its own permission settings decide what it asks' },
      plan: { set: { mode: 'plan' } },
    },
    fallback: 'auto',
    claudeCode: false,
    // Its own folders, and the Claude and .agents ones it also reads.
    skillRoots: (workspace, _home, user) => [
      ...['.opencode', '.claude', '.agents'].map((dir) => path.join(workspace, dir, 'skills')),
      path.join(user, '.config', 'opencode', 'skills'),
      ...['.claude', '.agents'].map((dir) => path.join(user, dir, 'skills')),
    ],
    defaultHome: '~/.local/share/opencode',
    defaultModel: { value: 'opencode/big-pickle', displayName: 'Big Pickle' },
    single: true,
  },
}

/** The agent an account runs. Accounts from before there was a choice are Claude's. */
export function agentFor(profile: { agent?: AgentId }): Agent {
  return agents[profile.agent ?? 'claude'] ?? agents.claude
}

/** Where a new account of this agent keeps its sign-in and history, under Vellum's home. */
export function accountHome(profileDir: string, agent: AgentId): string {
  return agent === 'claude' ? profileDir : path.join(path.dirname(profileDir), agent)
}

/** The mode a note on this agent runs in: the one asked for if the agent has it, else its fallback. */
export function modeFor(agent: Agent, mode: PermissionMode | undefined): PermissionMode {
  const want = mode ?? defaultMode
  return agent.modes[want] ? want : agent.fallback
}

/** Vellum's modes as this agent has them, in Vellum's order, with the agent's own words where it has them. */
export function agentModes(agent: Agent): { id: PermissionMode; label: string; hint: string }[] {
  return vellumModes.flatMap((m) => {
    const own = agent.modes[m.id]
    return own ? [{ id: m.id, label: own.label ?? m.label, hint: own.hint ?? m.hint }] : []
  })
}

/**
 * Which Vellum mode the agent's current options amount to, when it changed them itself (Claude
 * leaving plan mode, say). The mode whose settings all match; the one with more settings wins.
 */
export function modeFromOptions(agent: Agent, current: (key: string) => string | undefined): PermissionMode | undefined {
  let best: { id: PermissionMode; n: number } | undefined
  for (const [id, m] of Object.entries(agent.modes) as [PermissionMode, { set: Record<string, string> }][]) {
    const pairs = Object.entries(m.set)
    if (pairs.every(([k, v]) => current(k) === v) && (!best || pairs.length > best.n)) best = { id, n: pairs.length }
  }
  return best?.id
}

/**
 * Which agents a new account can run: the one Vellum ships, and the others when they're
 * installed. Each says why not when it can't be picked.
 */
export function agentChoices(profiles: { agent?: AgentId }[]): { agent: Agent; why?: string }[] {
  return Object.values(agents).map((agent) => {
    const why = agent.missing() ?? (agent.single && profiles.some((p) => agentFor(p) === agent) ? `There's already an ${agent.title} account. A second one isn't supported yet.` : undefined)
    return { agent, why }
  })
}
