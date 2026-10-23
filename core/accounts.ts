// Accounts share your Claude setup and history; only the login is their own.
//
// Each Vellum account's CLAUDE_CONFIG_DIR links the entries in SHARED to ~/.claude, so every
// account has your skills, settings, plugins, agents, commands and session history, and can
// continue a conversation another account started. Claude writes through those links (checked:
// `claude plugin enable` and `claude mcp add` keep a symlinked settings.json / .claude.json).
// Everything else stays per account: .claude.json (the login identity), credentials, the live
// sessions/ registry, caches, telemetry. The list is an allowlist, so anything new Claude adds
// stays private until it is chosen here.
//
// The link check (`linkAccount`) runs at launch and before an account's agent starts. An entry
// that isn't a link to ~/.claude (missing, a real file or folder, or a link elsewhere, like the
// old ~/.vellum/shared) is merged into ~/.claude first and then linked, and whatever it replaced
// is kept under ~/.vellum/backups. Nothing is ever deleted without a copy.

import {
  appendFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { linkShared } from './platform'
import { paths } from './store'

/**
 * Shared with ~/.claude, once ~/.claude has them. Nothing is created there ahead of time: if an
 * account's claude makes one of these first, the next check merges it in and links it.
 */
export const SHARED: { name: string; dir: boolean }[] = [
  { name: 'settings.json', dir: false },
  { name: 'settings.local.json', dir: false },
  { name: 'CLAUDE.md', dir: false },
  { name: 'history.jsonl', dir: false },
  { name: 'skills', dir: true },
  { name: 'agents', dir: true },
  { name: 'commands', dir: true },
  { name: 'output-styles', dir: true },
  { name: 'plugins', dir: true },
  { name: 'themes', dir: true },
  { name: 'projects', dir: true },
  { name: 'file-history', dir: true },
  { name: 'session-env', dir: true },
  { name: 'todos', dir: true },
  { name: 'plans', dir: true },
  { name: 'paste-cache', dir: true },
]

/** ~/.claude, the hub every account links to. VELLUM_CLAUDE_HOME moves it for checks. */
export const claudeHome = () => process.env.VELLUM_CLAUDE_HOME ?? path.join(homedir(), '.claude')
/** The default account's .claude.json lives beside ~/.claude, not in it. */
export const defaultClaudeJson = () => path.join(path.dirname(claudeHome()), '.claude.json')

export type LinkAction = { name: string; did: 'linked' | 'merged' | 'relinked'; backup?: string; note?: string }

function real(p: string) {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

/** Is `link` already the hub's entry (a symlink or junction to it, or a hard link of it)? */
function linked(link: string, target: string): boolean {
  const st = lstatSync(link)
  if (st.isSymbolicLink()) return real(path.resolve(path.dirname(link), readlinkSync(link))) === real(target)
  if (!st.isDirectory() && existsSync(target)) {
    const t = statSync(target)
    return t.ino === st.ino && t.dev === st.dev
  }
  return false
}

// ---------------------------------------------------------------- merging

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Deep-merge two settings objects. Lists are combined (permission rules from both survive);
 * where both set one value differently, `newer` wins.
 */
export function mergeJson(base: unknown, other: unknown, otherIsNewer: boolean): unknown {
  if (isObject(base) && isObject(other)) {
    const out: Record<string, unknown> = { ...base }
    for (const [k, v] of Object.entries(other)) out[k] = k in base ? mergeJson(base[k], v, otherIsNewer) : v
    return out
  }
  if (Array.isArray(base) && Array.isArray(other)) {
    const seen = new Set(base.map((x) => JSON.stringify(x)))
    return [...base, ...other.filter((x) => !seen.has(JSON.stringify(x)))]
  }
  return otherIsNewer ? other : base
}

function readJsonFile(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

/** Fold one file into the hub's copy. Returns a note when the stray copy lost anything. */
function mergeFile(stray: string, hub: string): string | undefined {
  if (!existsSync(hub)) {
    cpSync(stray, hub)
    return
  }
  const a = readFileSync(hub)
  const b = readFileSync(stray)
  if (a.equals(b)) return
  const newer = statSync(stray).mtimeMs > statSync(hub).mtimeMs
  if (hub.endsWith('.json')) {
    const base = readJsonFile(hub)
    const other = readJsonFile(stray)
    if (base !== undefined && other !== undefined) {
      const merged = mergeJson(base, other, newer)
      // Your file is only rewritten when the merge adds to it.
      if (JSON.stringify(merged) !== JSON.stringify(base)) writeFileSync(hub, JSON.stringify(merged, null, 2) + '\n')
      return
    }
  }
  if (hub.endsWith('.jsonl')) {
    // Logs (history, transcripts): keep every line from both, the hub's first.
    const have = new Set(a.toString('utf8').split('\n'))
    const extra = b.toString('utf8').split('\n').filter((l) => l.trim() && !have.has(l))
    if (extra.length) appendFileSync(hub, (a.toString('utf8').endsWith('\n') || !a.length ? '' : '\n') + extra.join('\n') + '\n')
    return
  }
  if (!b.toString('utf8').trim()) return
  if (!a.toString('utf8').trim() || newer) {
    writeFileSync(hub, b)
    return a.toString('utf8').trim() ? `${path.basename(hub)}: kept the newer copy` : undefined
  }
  return `${path.basename(hub)}: kept ~/.claude's copy`
}

/** Fold a folder into the hub's, entry by entry. */
function mergeDir(stray: string, hub: string, notes: string[]) {
  mkdirSync(hub, { recursive: true })
  for (const entry of readdirSync(stray)) {
    const from = path.join(stray, entry)
    const to = path.join(hub, entry)
    const st = lstatSync(from)
    if (st.isSymbolicLink()) {
      if (!existsSync(to)) cpSync(from, to, { verbatimSymlinks: true })
    } else if (st.isDirectory()) mergeDir(from, to, notes)
    else {
      const note = mergeFile(from, to)
      if (note) notes.push(note)
    }
  }
}

function backupPath(account: string, name: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = path.join(paths.home, 'backups', account)
  mkdirSync(dir, { recursive: true })
  return path.join(dir, `${name}-${stamp}`)
}

// ---------------------------------------------------------------- the link check

/**
 * Make `configDir` link every shared entry to ~/.claude, merging first whatever was there.
 * Returns what changed (nothing, when it was already right).
 */
export function linkAccount(account: string, configDir: string): LinkAction[] {
  const hub = claudeHome()
  mkdirSync(configDir, { recursive: true })
  const actions: LinkAction[] = []
  for (const { name, dir } of SHARED) {
    const link = path.join(configDir, name)
    const target = path.join(hub, name)
    let st
    try {
      st = lstatSync(link)
    } catch {
      st = undefined
    }
    if (!st) {
      if (existsSync(target) && existsSync(hub)) {
        linkShared(target, link)
        actions.push({ name, did: 'linked' })
      }
      continue
    }
    if (linked(link, target)) continue
    // No ~/.claude at all (claude has never run as the default account): leave the account's own.
    if (!st.isSymbolicLink() && !existsSync(hub)) continue

    // Something else is here: fold it into the hub, keep a copy, then link.
    const pointsElsewhere = st.isSymbolicLink()
    const source = pointsElsewhere ? real(path.resolve(path.dirname(link), readlinkSync(link))) : link
    const notes: string[] = []
    if (existsSync(source)) {
      if (statSync(source).isDirectory()) mergeDir(source, target, notes)
      else {
        const note = mergeFile(source, target)
        if (note) notes.push(note)
      }
    }
    const backup = backupPath(account, name)
    if (pointsElsewhere) {
      // The link's old target belongs to someone else (e.g. ~/.vellum/shared): copy, don't move.
      if (existsSync(source)) cpSync(source, backup, { recursive: true, verbatimSymlinks: true })
      rmSync(link, { force: true })
    } else renameSync(link, backup)
    linkShared(target, link)
    actions.push({ name, did: pointsElsewhere ? 'relinked' : 'merged', backup: existsSync(backup) ? backup : undefined, note: notes.join('; ') || undefined })
  }
  return actions
}

// ---------------------------------------------------------------- MCP servers

export type McpMerge = { added: string[]; conflicts: string[] }

/**
 * Bring user-scope MCP servers (`mcpServers` in .claude.json, which is per account) into one
 * account's file from every other: the default account's ~/.claude.json and each Vellum account's.
 * Where two define one name differently, the most recently changed file wins and the name is
 * reported. Only `target` is written, and only its `mcpServers` key: call it before that account's
 * agent starts, so no claude of that account is writing the file at the same time.
 */
export function mergeMcpServers(target: string, sources: string[]): McpMerge {
  const ordered = sources
    .filter((f) => f !== target && existsSync(f))
    .map((f) => ({ f, at: statSync(f).mtimeMs }))
    .sort((a, b) => a.at - b.at)
  const mine = (existsSync(target) ? readJsonFile(target) : {}) as Record<string, any> | undefined
  if (!isObject(mine)) return { added: [], conflicts: [] }
  const servers: Record<string, unknown> = { ...(isObject(mine.mcpServers) ? mine.mcpServers : {}) }
  const myTime = existsSync(target) ? statSync(target).mtimeMs : 0
  const added: string[] = []
  const conflicts: string[] = []
  for (const { f, at } of ordered) {
    const theirs = (readJsonFile(f) as any)?.mcpServers
    if (!isObject(theirs)) continue
    for (const [name, cfg] of Object.entries(theirs)) {
      if (!(name in servers)) {
        servers[name] = cfg
        added.push(name)
      } else if (JSON.stringify(servers[name]) !== JSON.stringify(cfg)) {
        if (!conflicts.includes(name)) conflicts.push(name)
        if (at > myTime) servers[name] = cfg
      }
    }
  }
  if (JSON.stringify(servers) !== JSON.stringify(mine.mcpServers ?? {})) writeFileSync(target, JSON.stringify({ ...mine, mcpServers: servers }, null, 2) + '\n')
  return { added, conflicts }
}
