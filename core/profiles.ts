// Profiles are Claude accounts, separated by CLAUDE_CONFIG_DIR: each has its own login.
//
// Vellum never reads, copies or displays credential files. A profile folder links your setup and
// history from ~/.claude (core/accounts.ts), so the login is the only thing that differs.

// mkdir with a mode has no Bun.file form.
import { mkdirSync } from 'node:fs'
import { linkAccount } from './accounts'
import { accountHome, agentFor, type AgentId } from './agents'
import { loadJson, paths, writeJson } from './store'

export type Profile = {
  id: string
  name: string
  color: string
  /** Which agent this account runs (core/agents.ts). Missing on accounts from before: Claude. */
  agent?: AgentId
  /**
   * The agent's home for this account: CLAUDE_CONFIG_DIR for Claude, CODEX_HOME for Codex.
   * Null means the agent's own default (~/.claude, ~/.codex), where your existing sign-in is.
   */
  configDir: string | null
  workspaces: string[]
  /** Set after a headless run succeeds or reports "Not logged in". */
  loggedIn?: boolean
  /** Who is logged in here, as the agent reports it (`_auth/status_update`). */
  email?: string
  /** The plan's label, e.g. "Claude Pro". */
  plan?: string
  /** An image to show beside your paragraphs on this account, instead of the Mac's picture. */
  avatarImage?: string
}

const PROFILE_COLORS = ['#1447e6', '#c2453a', '#2f8a5b', '#9352c2', '#8a6200', '#1a7680']

// Read once, before anything renders; Vellum is the only writer while it runs.
let saved = await loadJson<Profile[]>(paths.profiles, [])

/** Copies, so a caller can change them and save what it wants. */
export function loadProfiles(): Profile[] {
  const list = structuredClone(saved)
  if (list.length > 0) return list
  // First run: one profile that uses the account Claude Code is already logged into.
  const seeded: Profile[] = [
    { id: 'main', name: 'Default', color: PROFILE_COLORS[0]!, configDir: null, workspaces: [] },
  ]
  saveProfiles(seeded)
  return seeded
}

export function saveProfiles(list: Profile[]) {
  saved = structuredClone(list)
  writeJson(paths.profiles, list)
}

/** Onboarding can use an agent's existing local sign-in without making an isolated account. */
export function existingAgentProfile(agent: AgentId): Profile {
  const list = loadProfiles()
  const existing = list.find((p) => agentFor(p).id === agent && p.configDir === null) ?? list.find((p) => agentFor(p).id === agent)
  if (existing) return existing
  const title = agentFor({ agent }).title
  const profile: Profile = {
    id: slug(title, new Set(list.map((p) => p.id))),
    name: title,
    agent,
    configDir: null,
    color: PROFILE_COLORS[list.length % PROFILE_COLORS.length]!,
    workspaces: [],
  }
  saveProfiles([...list, profile])
  return profile
}

function slug(name: string, taken: Set<string>) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'profile'
  let id = base
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`
  return id
}

/**
 * A new account. A Claude one shares your settings, skills and MCP servers with ~/.claude
 * (core/accounts.ts); a Codex one gets an empty CODEX_HOME of its own; OpenCode has one account,
 * its default home, for now.
 */
export function createProfile(name: string, agent: AgentId = 'claude'): Profile[] {
  const list = loadProfiles()
  const id = slug(name, new Set(list.map((p) => p.id)))
  let dir: string | null = accountHome(paths.profileDir(id), agent)
  if (agent === 'claude') linkAccount(id, dir)
  else if (agent === 'codex') mkdirSync(dir, { recursive: true, mode: 0o700 })
  else dir = null
  const profile: Profile = {
    id,
    name,
    ...(agent === 'claude' ? {} : { agent }),
    color: PROFILE_COLORS[list.length % PROFILE_COLORS.length]!,
    configDir: dir,
    workspaces: [],
  }
  const next = [...list, profile]
  saveProfiles(next)
  return next
}

export function updateProfile(id: string, patch: Partial<Profile>): Profile[] {
  const next = loadProfiles().map((p) => (p.id === id ? { ...p, ...patch } : p))
  saveProfiles(next)
  return next
}

/** Remember that a folder belongs to a profile so the next thread there preselects it. */
export function rememberWorkspace(id: string, workspace: string): Profile[] {
  const next = loadProfiles().map((p) => ({
    ...p,
    workspaces:
      p.id === id
        ? [workspace, ...p.workspaces.filter((w) => w !== workspace)].slice(0, 20)
        : p.workspaces.filter((w) => w !== workspace),
  }))
  saveProfiles(next)
  return next
}

export function profileForWorkspace(list: Profile[], workspace: string): Profile | undefined {
  return list.find((p) => p.workspaces.includes(workspace))
}

/** Environment for the account's agent, or any of its CLI's processes: pointed at its home. */
export function profileEnv(profile: Profile, base: Record<string, string | undefined> = process.env) {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(base)) if (v !== undefined) env[k] = v
  agentFor(profile).home(env, profile.configDir)
  return env
}

/** argv for the in-app login terminal. The person types /login there themselves. */
export function loginArgv(): string[] {
  return ['claude']
}
