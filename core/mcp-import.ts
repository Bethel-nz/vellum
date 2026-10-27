// Read the agents' global configuration without changing it. Every format becomes
// the same connection shape before deduplication; private headers never enter UI state.
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { paths, readJson } from './store'
import type { McpServer } from './mcp'

export type McpSource = { provider: 'Codex' | 'Claude' | 'OpenCode'; file: string; key: string }
export type McpConnection = Pick<McpServer, 'name' | 'transport' | 'url' | 'command' | 'args' | 'env' | 'cwd'>
export type ImportedMcp = { connection: McpConnection; enabled: boolean; headers: Record<string, string>; sources: McpSource[] }
type ObjectValue = Record<string, any>
const object = (value: unknown): ObjectValue => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {}
const strings = (value: unknown) => Object.fromEntries(Object.entries(object(value)).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))

export function mcpIdentity(server: McpConnection) {
  if (server.url) {
    const url = new URL(server.url)
    url.hash = ''; url.pathname = url.pathname.replace(/\/+$/, '') || '/'; url.searchParams.sort()
    return `url:${url.href}`
  }
  // Local servers have no URL. Keep distinct arguments, environments and working directories.
  return `stdio:${JSON.stringify([server.command, server.args ?? [], Object.entries(server.env ?? {}).sort(([a], [b]) => a.localeCompare(b)), server.cwd ?? ''])}`
}
export const importedId = (key: string) => createHash('sha256').update(key).digest('hex').slice(0, 12)

function expand(value: string, provider: McpSource['provider']) {
  return provider === 'OpenCode'
    ? value.replace(/\{env:([A-Za-z_][\w]*)\}/g, (_, key) => process.env[key] ?? '')
    : value.replace(/\$\{([A-Za-z_][\w]*)(?::-([^}]*))?\}/g, (_, key, fallback) => process.env[key] ?? fallback ?? '')
}

function normalize(name: string, input: unknown, source: McpSource): ImportedMcp | undefined {
  const value = object(input), provider = source.provider
  const resolve = (text: string) => expand(text, provider)
  const env = Object.fromEntries(Object.entries(strings(value.environment ?? value.env)).map(([key, text]) => [key, resolve(text)]))
  for (const item of Array.isArray(value.env_vars) ? value.env_vars : []) {
    const key = typeof item === 'string' ? item : item?.source !== 'remote' ? item?.name : undefined
    if (key && process.env[key] !== undefined) env[key] = process.env[key]!
  }
  const headers = Object.fromEntries(Object.entries(strings(value.http_headers ?? value.headers)).map(([key, text]) => [key, resolve(text)]))
  for (const [key, variable] of Object.entries(strings(value.env_http_headers))) if (process.env[variable]) headers[key] = process.env[variable]!
  if (typeof value.bearer_token_env_var === 'string' && process.env[value.bearer_token_env_var]) headers.Authorization = `Bearer ${process.env[value.bearer_token_env_var]}`
  const enabled = value.enabled !== false && value.disabled !== true
  if (typeof value.url === 'string') {
    const url = new URL(resolve(value.url))
    if (url.username || url.password || url.hash || url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Unsupported server URL')
    return { connection: { name, transport: value.type === 'sse' ? 'sse' : 'http', url: url.href }, enabled, headers, sources: [source] }
  }
  const command = Array.isArray(value.command) ? value.command.filter((item: unknown) => typeof item === 'string') : undefined
  const executable = command?.[0] ?? value.command
  if (typeof executable !== 'string' || !executable.trim()) return
  const args = command ? command.slice(1) : Array.isArray(value.args) ? value.args.filter((item: unknown) => typeof item === 'string') : []
  const cwd = typeof value.cwd === 'string' ? resolve(value.cwd) : undefined
  return { connection: { name, transport: 'stdio', command: resolve(executable), args: args.map(resolve), env, ...(cwd ? { cwd: path.resolve(path.dirname(source.file), cwd) } : {}) }, enabled, headers: {}, sources: [source] }
}

/** Global/user configs only. Project-scoped servers must not leak into other notes. */
export function readLocalMcp(options: { home?: string; profiles?: { agent?: string; configDir: string | null }[] } = {}) {
  const home = options.home ?? homedir(), custom = options.home !== undefined
  const profiles = options.profiles ?? readJson<{ agent?: string; configDir: string | null }[]>(paths.profiles, [])
  const files: { provider: McpSource['provider']; file: string }[] = []
  const add = (provider: McpSource['provider'], file: string) => { if (!files.some(item => item.file === file)) files.push({ provider, file }) }
  add('Codex', path.join(!custom && process.env.CODEX_HOME || path.join(home, '.codex'), 'config.toml'))
  add('Claude', path.join(home, '.claude.json'))
  if (!custom && process.env.CLAUDE_CONFIG_DIR) add('Claude', path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json'))
  for (const profile of profiles) if (profile.configDir && (profile.agent === 'codex' || !profile.agent || profile.agent === 'claude')) add(profile.agent === 'codex' ? 'Codex' : 'Claude', path.join(profile.configDir, profile.agent === 'codex' ? 'config.toml' : '.claude.json'))
  const opencode = !custom && process.env.OPENCODE_CONFIG_DIR || path.join(!custom && process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'opencode')
  add('OpenCode', path.join(opencode, 'opencode.json')); add('OpenCode', path.join(opencode, 'opencode.jsonc'))
  if (!custom && process.env.OPENCODE_CONFIG) add('OpenCode', process.env.OPENCODE_CONFIG)
  const entries: ImportedMcp[] = [], issues: string[] = []
  for (const { provider, file } of files) {
    if (!existsSync(file)) continue
    try {
      const text = readFileSync(file, 'utf8')
      const config = object(provider === 'Codex' ? Bun.TOML.parse(text) : Bun.JSONC.parse(text))
      const definitions = object(provider === 'Codex' ? config.mcp_servers : provider === 'Claude' ? config.mcpServers : config.mcp)
      const all = provider === 'OpenCode' ? { ...object(definitions.servers), ...definitions } : definitions
      for (const [name, value] of Object.entries(all)) {
        if (name === 'servers' && provider === 'OpenCode') continue
        try { const entry = normalize(name, value, { provider, file, key: name }); if (entry) entries.push(entry) }
        catch { issues.push(`${provider}: could not import ${name}`) }
      }
    } catch { issues.push(`${provider}: could not read ${path.basename(file)}`) }
  }
  const unique = new Map<string, ImportedMcp>()
  for (const entry of entries) {
    const key = mcpIdentity(entry.connection), previous = unique.get(key)
    if (previous) {
      previous.sources.push(...entry.sources)
      // Prefer an enabled definition, without merging credentials across accounts.
      if (!previous.enabled && entry.enabled) { previous.connection = entry.connection; previous.headers = entry.headers; previous.enabled = true }
    } else unique.set(key, entry)
  }
  return { entries: [...unique.values()], issues }
}
