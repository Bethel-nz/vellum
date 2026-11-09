// One MCP client per configured server. Agents receive note-scoped stdio proxies;
// credentials, tool switches and permission enforcement stay inside Vellum.
import { chmodSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { McpAuth, credentials, mcpFetch, saveCredentials } from './mcp-auth'
import { paths, readJson } from './store'
import { importedId, mcpIdentity, readLocalMcp, type McpSource } from './mcp-import'

export type McpServer = { id: string; name: string; transport: 'http' | 'sse' | 'stdio'; url?: string; command?: string; args?: string[]; env?: Record<string, string>; cwd?: string; sources?: McpSource[]; inherited?: { key: string; enabledOverride?: boolean }; enabled: boolean; disabledTools: string[]; policy: 'ask' | 'reads' }
export type McpStatus = 'disconnected' | 'connecting' | 'connected' | 'needs-auth' | 'authorizing' | 'error'
export type McpView = { server: McpServer; status: McpStatus; tools: Tool[]; error?: string }
type Snapshot = { servers: McpView[]; revision: number; importIssues: string[] }
export type McpApproval = (server: McpServer, tool: Tool, args: Record<string, unknown>, signal: AbortSignal) => Promise<'allow' | 'reads' | 'deny'>
const configPath = () => path.join(paths.home, 'mcp-servers.json')
export const mcpKey = (server: Pick<McpServer, 'id'>) => `vellum_${server.id}`
/** A token as copied: strip a Bearer prefix and quotes; refuse anything with whitespace left. */
export function cleanToken(raw: string): string {
  const clean = raw.trim().replace(/^["']|["']$/g, '').replace(/^bearer\s+/i, '').trim()
  if (/\s/.test(clean)) throw new Error('The clipboard has more than an access token in it')
  return clean
}
export const toolTokens = (tool: Tool) => Math.ceil(JSON.stringify({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations }).length / 4)
export const readTool = (tool: Tool) => tool.annotations?.readOnlyHint === true && tool.annotations?.destructiveHint !== true
const textError = (error: unknown) => error instanceof Error ? error.message : String(error)
const openAuthorization = (url: URL) => {
  if (process.env.GPUIX_BACKGROUND) throw new Error('Browser authorization is disabled in background checks')
  const args = process.platform === 'darwin' ? ['open', url.href] : process.platform === 'win32' ? ['rundll32.exe', 'url.dll,FileProtocolHandler', url.href] : ['xdg-open', url.href]
  Bun.spawn(args, { stdout: 'ignore', stderr: 'ignore' })
}

export class McpManager {
  #snapshot: Snapshot
  #listeners = new Set<() => void>()
  #clients = new Map<string, Client>()
  #connecting = new Map<string, Promise<void>>()
  #auth = new Map<string, McpAuth>()
  #generation = new Map<string, number>()
  #stdio = new Map<string, StdioClientTransport>()
  #closed = false
  #localHome?: string
  #open: (url: URL) => void
  constructor(options: { openAuthorization?: (url: URL) => void; inherit?: boolean; localHome?: string } = {}) {
    this.#localHome = options.localHome
    this.#open = options.openAuthorization ?? openAuthorization
    const configs = readJson<McpServer[]>(configPath(), [])
    this.#snapshot = { revision: 0, importIssues: [], servers: Array.isArray(configs) ? configs.filter(s => /^[a-f0-9]{12}$/.test(s.id) && ['http', 'sse', 'stdio'].includes(s.transport)).map(server => ({ server: { ...server, enabled: server.enabled !== false, disabledTools: Array.isArray(server.disabledTools) ? server.disabledTools : [], policy: server.policy === 'reads' ? 'reads' : 'ask' }, status: 'disconnected', tools: [] })) : [] }
    if (options.inherit ?? !process.env.GPUIX_BACKGROUND) this.#inherit()
  }
  #inherit() {
    const imported = readLocalMcp({ home: this.#localHome }), ignored = new Set(readJson<string[]>(path.join(paths.home, 'mcp-imports-ignored.json'), []))
    const previous = JSON.stringify(this.#snapshot.servers.map(view => view.server))
    const changed: string[] = [], present = new Set<string>()
    for (const entry of imported.entries) {
      const key = importedId(mcpIdentity(entry.connection)); present.add(key)
      if (ignored.has(key)) continue
      const sameSource = (source: McpSource) => entry.sources.some(item => item.provider === source.provider && item.file === source.file && item.key === source.key)
      const existing = this.#snapshot.servers.find(view => view.server.inherited?.key === key || mcpIdentity(view.server) === mcpIdentity(entry.connection)) ?? this.#snapshot.servers.find(view => view.server.inherited && view.server.sources?.some(sameSource))
      if (existing) {
        const { server } = existing
        if (server.inherited) {
          const next = { ...server, ...entry.connection, sources: entry.sources, inherited: { ...server.inherited, key }, enabled: server.inherited.enabledOverride ?? entry.enabled }
          if (server.url !== next.url) { this.#auth.get(server.id)?.dispose(); this.#auth.delete(server.id); saveCredentials(server.id, null) }
          if (server.enabled !== next.enabled || JSON.stringify([server.command, server.args, server.env, server.cwd, server.url]) !== JSON.stringify([next.command, next.args, next.env, next.cwd, next.url]) || JSON.stringify(credentials(server.id).headers ?? {}) !== JSON.stringify(entry.headers)) changed.push(server.id)
          existing.server = next
          if (JSON.stringify(credentials(server.id).headers ?? {}) !== JSON.stringify(entry.headers)) saveCredentials(server.id, { headers: entry.headers })
        } else {
          existing.server = { ...server, sources: entry.sources }
          const secret = credentials(server.id)
          if (!secret.bearer && !secret.tokens && !Object.keys(secret.headers ?? {}).length && Object.keys(entry.headers).length) { saveCredentials(server.id, { headers: entry.headers }); changed.push(server.id) }
        }
      } else {
        const server: McpServer = { ...entry.connection, id: key, enabled: entry.enabled, disabledTools: [], policy: 'ask', sources: entry.sources, inherited: { key } }
        this.#snapshot.servers.push({ server, status: 'disconnected', tools: [] })
        if (Object.keys(entry.headers).length) saveCredentials(server.id, { headers: entry.headers })
      }
    }
    // Retire old copies of a changed definition, keeping genuinely removed entries paused.
    const stale = new Set<string>()
    for (const view of this.#snapshot.servers) if (view.server.inherited && !present.has(view.server.inherited.key) && !imported.issues.length) {
      const moved = view.server.sources?.some(source => imported.entries.some(entry => entry.sources.some(item => item.provider === source.provider && item.file === source.file && item.key === source.key)))
      if (moved) { stale.add(view.server.id); changed.push(view.server.id); this.#auth.get(view.server.id)?.dispose(); this.#auth.delete(view.server.id); saveCredentials(view.server.id, null) }
      else { if (view.server.enabled) changed.push(view.server.id); view.server = { ...view.server, enabled: false } }
    }
    this.#snapshot.servers = this.#snapshot.servers.filter(view => !stale.has(view.server.id))
    this.#snapshot = { ...this.#snapshot, importIssues: imported.issues }
    if (previous !== JSON.stringify(this.#snapshot.servers.map(view => view.server))) this.#save()
    else this.#emit()
    return changed
  }
  async refreshLocal() {
    const changed = this.#inherit()
    await Promise.all(changed.map(id => this.disconnect(id)))
    await Promise.all(this.#snapshot.servers.filter(view => view.server.enabled && view.status === 'disconnected').map(view => this.connect(view.server.id).catch(() => {})))
  }
  getSnapshot = () => this.#snapshot
  subscribe = (listener: () => void) => { this.#listeners.add(listener); return () => { this.#listeners.delete(listener) } }
  get revision() { return this.#snapshot.revision }
  configured() { return this.#snapshot.servers.map(item => item.server).filter(server => server.enabled) }
  #update(id: string, patch: Partial<McpView>) { this.#snapshot = { ...this.#snapshot, servers: this.#snapshot.servers.map(view => view.server.id === id ? { ...view, ...patch } : view) }; this.#emit() }
  #emit() { for (const listener of this.#listeners) listener() }
  #save() {
    writeFileSync(configPath(), JSON.stringify(this.#snapshot.servers.map(item => item.server), null, 2), { mode: 0o600 }); chmodSync(configPath(), 0o600)
    this.#snapshot = { ...this.#snapshot, revision: this.revision + 1 }; this.#emit()
  }
  #view(id: string) { const view = this.#snapshot.servers.find(item => item.server.id === id); if (!view) throw new Error('This MCP server has been removed'); return view }
  #provider(server: McpServer) { let provider = this.#auth.get(server.id); if (!provider) { provider = new McpAuth(server.id, server.url!); this.#auth.set(server.id, provider) } return provider }
  add(input: { name: string; transport: McpServer['transport']; url?: string; command?: string; args?: string[]; env?: Record<string, string>; cwd?: string; bearer?: string }) {
    const name = input.name.trim()
    if (!name || name.length > 80) throw new Error('Enter a server name of up to 80 characters')
    if (input.transport === 'stdio') { if (!input.command?.trim()) throw new Error('Enter the command that starts this server') }
    else {
      let url: URL
      try { url = new URL(input.url ?? '') } catch { throw new Error('Enter a valid MCP server URL') }
      if (url.username || url.password || url.hash || url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Use HTTPS, or HTTP for a server on localhost')
      input = { ...input, url: url.href }
    }
    const duplicate = this.#snapshot.servers.find(view => mcpIdentity(view.server) === mcpIdentity(input))
    if (duplicate) {
      if (input.bearer?.trim()) saveCredentials(duplicate.server.id, { bearer: input.bearer.trim() })
      if (!duplicate.server.enabled) {
        const server = duplicate.server
        this.#update(server.id, { server: { ...server, enabled: true, ...(server.inherited ? { inherited: { ...server.inherited, enabledOverride: true } } : {}) } }); this.#save()
      }
      return this.#view(duplicate.server.id).server
    }
    const id = crypto.randomUUID().replaceAll('-', '').slice(0, 12)
    const { bearer, ...connection } = input
    const server: McpServer = { ...connection, name, id, enabled: true, disabledTools: [], policy: 'ask' }
    this.#snapshot = { ...this.#snapshot, servers: [...this.#snapshot.servers, { server, status: 'disconnected', tools: [] }] }
    if (bearer?.trim()) saveCredentials(id, { bearer: bearer.trim() })
    this.#save(); return server
  }
  async remove(id: string) {
    const server = this.#view(id).server
    if (server.sources?.length) {
      const file = path.join(paths.home, 'mcp-imports-ignored.json')
      const ignored = new Set(readJson<string[]>(file, [])); ignored.add(importedId(mcpIdentity(server)))
      writeFileSync(file, JSON.stringify([...ignored]), { mode: 0o600 }); chmodSync(file, 0o600)
    }
    this.#auth.get(id)?.dispose(); await this.disconnect(id); this.#auth.delete(id); saveCredentials(id, null)
    this.#snapshot = { ...this.#snapshot, servers: this.#snapshot.servers.filter(view => view.server.id !== id) }; this.#save()
  }
  async enable(id: string, enabled: boolean) {
    const view = this.#view(id); this.#update(id, { server: { ...view.server, enabled, ...(view.server.inherited ? { inherited: { ...view.server.inherited, enabledOverride: enabled } } : {}) } }); this.#save()
    if (enabled) await this.connect(id); else await this.disconnect(id)
  }
  policy(id: string, policy: McpServer['policy']) { const view = this.#view(id); this.#update(id, { server: { ...view.server, policy } }); this.#save() }
  toggleTool(id: string, name: string, enabled: boolean) {
    const view = this.#view(id)
    const disabled = new Set(view.server.disabledTools); if (enabled) disabled.delete(name); else disabled.add(name)
    this.#update(id, { server: { ...view.server, disabledTools: [...disabled] } }); this.#save()
  }
  async disconnect(id: string) {
    this.#generation.set(id, (this.#generation.get(id) ?? 0) + 1)
    this.#auth.get(id)?.cancel()
    const client = this.#clients.get(id); this.#clients.delete(id)
    if (client) await client.close().catch(() => {})
    if (this.#snapshot.servers.some(item => item.server.id === id)) this.#update(id, { status: 'disconnected', error: undefined })
  }
  async connect(id: string) {
    if (this.#closed) throw new Error('The MCP service is closed')
    const pending = this.#connecting.get(id); if (pending) return pending
    const task = this.#connect(id).finally(() => { if (this.#connecting.get(id) === task) this.#connecting.delete(id) })
    this.#connecting.set(id, task); return task
  }
  async #connect(id: string) {
    const { server } = this.#view(id)
    if (!server.enabled) return
    const generation = (this.#generation.get(id) ?? 0) + 1; this.#generation.set(id, generation)
    const old = this.#clients.get(id); this.#clients.delete(id); await old?.close().catch(() => {})
    this.#update(id, { status: 'connecting', error: undefined })
    const client = new Client({ name: 'vellum', version: '0.1.0' }, { capabilities: {} })
    this.#clients.set(id, client)
    const current = () => this.#generation.get(id) === generation && this.#snapshot.servers.some(view => view.server.id === id && view.server.enabled)
    const secret = credentials(id)
    try {
    const headers = new Headers(secret.headers)
    if (secret.bearer) headers.set('Authorization', `Bearer ${secret.bearer}`)
    const options = { authProvider: headers.has('Authorization') || server.transport === 'stdio' || !secret.tokens ? undefined : this.#provider(server), requestInit: { headers }, fetch: mcpFetch }
    const transport = server.transport === 'stdio' ? new StdioClientTransport({ command: server.command!, args: server.args, env: server.env, cwd: server.cwd, stderr: 'pipe' }) : server.transport === 'sse' ? new SSEClientTransport(new URL(server.url!), options) : new StreamableHTTPClientTransport(new URL(server.url!), options)
    if (transport instanceof StdioClientTransport) { this.#stdio.set(id, transport); transport.stderr?.on('data', () => {}) }
    client.onclose = () => { if (this.#stdio.get(id) === transport) this.#stdio.delete(id); if (current() && this.#clients.get(id) === client) { this.#clients.delete(id); this.#update(id, { status: 'disconnected' }) } }
      await client.connect(transport, { timeout: 20_000 })
      const tools: Tool[] = []; let cursor: string | undefined; const cursors = new Set<string>()
      if (client.getServerCapabilities()?.tools) do { const page = await client.listTools(cursor ? { cursor } : {}, { timeout: 15_000 }); tools.push(...page.tools); if (tools.length > 5000) throw new Error('The server returned too many tools'); cursor = page.nextCursor; if (cursor && cursors.has(cursor)) throw new Error('The server repeated a tool-list cursor'); if (cursor) cursors.add(cursor) } while (cursor)
      if (!current()) { await client.close(); return }
      this.#update(id, { status: 'connected', tools, error: undefined })
    } catch (error) {
      if (!current()) return
      this.#clients.delete(id); await client.close().catch(() => {})
      let message = textError(error)
      for (const value of [secret.bearer, secret.tokens?.access_token, secret.tokens?.refresh_token, ...Object.values(secret.headers ?? {})]) if (value) message = message.replaceAll(value, '[redacted]')
      const needsAuth = error instanceof UnauthorizedError || /\b401\b|unauthorized|sign in/i.test(message)
      this.#update(id, { status: needsAuth ? 'needs-auth' : 'error', error: message.slice(0, 600) })
      throw new Error(message)
    }
  }
  async signIn(id: string) {
    const { server } = this.#view(id)
    if (server.transport === 'stdio') throw new Error('Local servers use their command environment to authenticate')
    await this.disconnect(id)
    saveCredentials(id, { bearer: undefined, headers: Object.fromEntries(Object.entries(credentials(id).headers ?? {}).filter(([key]) => key.toLowerCase() !== 'authorization')) })
    this.#update(id, { status: 'authorizing', error: undefined })
    try { await this.#provider(server).signIn(this.#open); await this.connect(id) }
    catch (error) { if (this.#snapshot.servers.some(view => view.server.id === id)) this.#update(id, { status: 'needs-auth', error: textError(error).slice(0, 600) }); throw error }
  }
  async setToken(id: string, token: string) {
    const clean = cleanToken(token)
    if (!clean) throw new Error('The clipboard is empty')
    await this.disconnect(id)
    saveCredentials(id, { bearer: clean })
    await this.connect(id)
  }
  async listTools(id: string) {
    let view = this.#view(id)
    if (!view.server.enabled) return []
    if (view.status !== 'connected') await this.connect(id)
    view = this.#view(id)
    return view.tools.filter(tool => !view.server.disabledTools.includes(tool.name))
  }
  async call(id: string, name: string, args: Record<string, unknown>, approve: McpApproval, signal: AbortSignal) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be an object')
    const tools = await this.listTools(id)
    const tool = tools.find(tool => tool.name === name)
    if (!tool) throw new Error('This tool is disabled or no longer available')
    let view = this.#view(id)
    if (!(view.server.policy === 'reads' && readTool(tool))) {
      const decision = await approve(view.server, tool, args, signal)
      if (decision === 'deny') throw new Error('The tool request was denied')
      if (decision === 'reads' && readTool(tool)) this.policy(id, 'reads')
    }
    view = this.#view(id)
    if (signal.aborted || !view.server.enabled || view.server.disabledTools.includes(name)) throw new Error('The tool request was cancelled or disabled')
    const client = this.#clients.get(id); if (!client) throw new Error('Reconnect the MCP server and try again')
    try { return await client.callTool({ name, arguments: args }, undefined, { signal, timeout: 120_000 }) }
    catch (error) { if (error instanceof UnauthorizedError) this.#update(id, { status: 'needs-auth', error: 'Sign in again to use this server' }); throw error }
  }
  describeTool(name: string) {
    for (const { server, tools } of this.#snapshot.servers) {
      const prefix = `mcp__${mcpKey(server)}__`
      if (!name.startsWith(prefix)) continue
      const tool = tools.find(tool => tool.name === name.slice(prefix.length))
      if (tool) return { title: tool.title ?? tool.annotations?.title, inputSchema: tool.inputSchema, outputSchema: tool.outputSchema, source: { name: server.name, url: server.url } }
    }
  }
  managedTool(name: string) { return this.configured().some(server => name.startsWith(`mcp__${mcpKey(server)}__`)) }
  close() {
    this.#closed = true
    for (const { server } of this.#snapshot.servers) this.#generation.set(server.id, (this.#generation.get(server.id) ?? 0) + 1)
    for (const auth of this.#auth.values()) auth.dispose()
    // Stop only our own children; exit handlers cannot wait for graceful shutdown.
    for (const transport of this.#stdio.values()) if (transport.pid) { try { process.kill(transport.pid, 'SIGTERM') } catch {} }
    for (const client of this.#clients.values()) void client.close().catch(() => {})
    this.#clients.clear(); this.#stdio.clear()
  }
}
export const mcp = new McpManager()
