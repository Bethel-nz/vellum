// Profiles are Claude accounts, separated purely by CLAUDE_CONFIG_DIR.
//
// Vellum never reads, copies or displays credential files. A profile folder gets
// symlinks to the shared config (settings, CLAUDE.md, skills, agents, commands)
// and nothing else: the login and the session history (projects/) stay per profile.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { linkShared } from './platform'
import path from 'node:path'
import { paths, readJson, writeJson } from './store'

export type Profile = {
  id: string
  name: string
  color: string
  /** Absolute path for CLAUDE_CONFIG_DIR. Null means Claude Code's own default (~/.claude). */
  configDir: string | null
  workspaces: string[]
  /** Set after a headless run succeeds or reports "Not logged in". */
  loggedIn?: boolean
  /** An image to show beside your paragraphs on this account, instead of the Mac's picture. */
  avatarImage?: string
}

const SHARED = ['settings.json', 'CLAUDE.md', 'skills', 'agents', 'commands'] as const
// Never linked from shared/: .credentials.json, .claude.json, projects/
const PROFILE_COLORS = ['#1447e6', '#c2453a', '#2f8a5b', '#9352c2', '#8a6200', '#1a7680']

export function loadProfiles(): Profile[] {
  const list = readJson<Profile[]>(paths.profiles, [])
  if (list.length > 0) return list
  // First run: one profile that uses the account Claude Code is already logged into.
  const seeded: Profile[] = [
    { id: 'main', name: 'Default', color: PROFILE_COLORS[0]!, configDir: null, workspaces: [] },
  ]
  saveProfiles(seeded)
  return seeded
}

export function saveProfiles(list: Profile[]) {
  writeJson(paths.profiles, list)
}

function ensureShared() {
  mkdirSync(paths.shared, { recursive: true })
  for (const name of SHARED) {
    const target = path.join(paths.shared, name)
    if (existsSync(target)) continue
    if (name.includes('.')) writeFileSync(target, name.endsWith('.json') ? '{}\n' : '')
    else mkdirSync(target, { recursive: true })
  }
}

function slug(name: string, taken: Set<string>) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'profile'
  let id = base
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`
  return id
}

export function createProfile(name: string): Profile[] {
  const list = loadProfiles()
  const id = slug(name, new Set(list.map((p) => p.id)))
  const dir = paths.profileDir(id)
  mkdirSync(dir, { recursive: true })
  ensureShared()
  for (const entry of SHARED) {
    const link = path.join(dir, entry)
    if (!existsSync(link)) linkShared(path.join(paths.shared, entry), link)
  }
  const profile: Profile = {
    id,
    name,
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

/** Environment for any `claude` process under this profile. */
export function profileEnv(profile: Profile, base: Record<string, string | undefined> = process.env) {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(base)) if (v !== undefined) env[k] = v
  if (profile.configDir) env.CLAUDE_CONFIG_DIR = profile.configDir
  else delete env.CLAUDE_CONFIG_DIR
  return env
}

/** argv for the in-app login terminal. The person types /login there themselves. */
export function loginArgv(): string[] {
  return ['claude']
}
