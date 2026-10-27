// Logging accounts in and out, and knowing who each one is.
//
// Who: `claude auth status --json` under the account's CLAUDE_CONFIG_DIR. It reads the login
// without a model turn (loggedIn, email, subscriptionType; exit 1 when logged out).
//
// Logging in follows ACP's terminal authentication: the agent lists its methods at initialize
// (the Claude adapter offers `claude-ai-login` and `console-login`), and the client runs the agent
// program again with the method's args in a terminal the person can see. Exit 0 means it worked.
// For the Claude adapter that is `--cli auth login --claudeai`, which hands over to your `claude`.
// OpenCode's is `opencode acp --login`.
//
// Codex's adapter only offers methods it runs itself (a browser it opens, a key in its env), so
// Vellum runs `codex login` in the same terminal instead, under the account's CODEX_HOME, and
// asks `codex login status` who's in. Neither starts a session.

import { homedir } from 'node:os'
import path from 'node:path'
import { AcpConnection } from './acp'
import { agentArgv, agentEnv } from './agent'
import { agentFor, tool, type AgentId } from './agents'
import { profileEnv } from './profiles'
import { claudeBin } from './platform'
import type { Profile } from './profiles'

export type AccountStatus = { loggedIn?: boolean; email?: string; plan?: string }

/** Status polling cadence, not a token lifetime. The agent owns OAuth renewal. */
export function accountRefreshInterval(profile: Pick<Profile, 'agent'>): number {
  return { claude: 5, opencode: 10, codex: 30 }[agentFor(profile).id] * 60_000
}

const planNames: Record<string, string> = { pro: 'Claude Pro', max: 'Claude Max', team: 'Claude Team', enterprise: 'Claude Enterprise' }

/** Who is logged in to this account, or that nobody is. Undefined if it couldn't be read. */
export async function accountStatus(profile: Profile): Promise<AccountStatus | undefined> {
  const agent = agentFor(profile).id
  if (agent === 'codex') return codexStatus(profile)
  if (agent === 'opencode') return opencodeStatus(profile)
  if (agent !== 'claude') return
  try {
    const proc = Bun.spawn([claudeBin(), 'auth', 'status', '--json'], { env: agentEnv(profile), cwd: homedir(), stdout: 'pipe', stderr: 'ignore', stdin: 'ignore' })
    const timer = setTimeout(() => proc.kill(), 15_000)
    const text = await new Response(proc.stdout).text()
    clearTimeout(timer)
    await proc.exited
    const s = JSON.parse(text)
    if (typeof s?.loggedIn !== 'boolean') return
    if (!s.loggedIn) return { loggedIn: false }
    const plan = s.authMethod === 'console' || s.apiProvider !== 'firstParty' ? 'API usage' : (planNames[String(s.subscriptionType)] ?? s.subscriptionType)
    return { loggedIn: true, email: typeof s.email === 'string' ? s.email : undefined, plan: typeof plan === 'string' ? plan : undefined }
  } catch {
    return
  }
}

/** Provider connections, without opening a model turn or reading credential files. */
async function opencodeStatus(profile: Profile): Promise<AccountStatus> {
  const opencode = tool('opencode')
  if (!opencode) return {}
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const proc = Bun.spawn([opencode, 'auth', 'list', '--format', 'json'], { env: profileEnv(profile), cwd: homedir(), stdout: 'pipe', stderr: 'ignore', stdin: 'ignore' })
    timer = setTimeout(() => proc.kill(), 15_000)
    const text = await new Response(proc.stdout).text()
    if ((await proc.exited) !== 0) return {}
    const list: unknown = JSON.parse(text)
    if (!Array.isArray(list)) return {}
    const connected = list.filter((provider) => typeof provider?.id === 'string' && !provider.id.startsWith('mcp_') && Array.isArray(provider.connections) && provider.connections.some((connection: { type?: string }) => connection?.type === 'credential')).length
    // No stored providers doesn't prove logout: free models and environment keys also work.
    return connected ? { loggedIn: true, plan: `${connected} provider${connected === 1 ? '' : 's'} configured` } : {}
  } catch { return {} }
  finally { clearTimeout(timer) }
}

export type LoginMethod = {
  id: string
  name: string
  description?: string
  /** Added to the agent program's argv (ACP terminal auth)... */
  args: string[]
  /** ...or a whole command of its own instead (Codex's `codex login`). */
  argv?: string[]
  env: Record<string, string>
}

async function codexStatus(profile: Profile): Promise<AccountStatus | undefined> {
  const codex = tool('codex')
  if (!codex) return
  try {
    const proc = Bun.spawn([codex, 'login', 'status'], { env: profileEnv(profile), cwd: homedir(), stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' })
    const timer = setTimeout(() => proc.kill(), 15_000)
    // It says who's in on stdout or stderr, depending on the version.
    const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
    clearTimeout(timer)
    if ((await proc.exited) !== 0) return { loggedIn: false }
    const text = `${out}\n${err}`
    const plan = /chatgpt/i.test(text) ? 'ChatGPT' : /api key/i.test(text) ? 'API usage' : undefined
    return { loggedIn: true, plan }
  } catch {
    return
  }
}

function codexMethods(): LoginMethod[] {
  const codex = tool('codex') ?? 'codex'
  return [
    { id: 'chat-gpt', name: 'ChatGPT', description: 'Your ChatGPT plan', args: [], argv: [codex, 'login'], env: {} },
    { id: 'api-key', name: 'OpenAI API key', description: 'Paste the key in the terminal', args: [], argv: [codex, 'login', '--with-api-key'], env: {} },
  ]
}

/** What the Claude adapter offers today, for when asking it fails. */
const knownMethods: LoginMethod[] = [
  { id: 'claude-ai-login', name: 'Claude Subscription', args: ['--cli', 'auth', 'login', '--claudeai'], env: {} },
  { id: 'console-login', name: 'Anthropic Console', description: 'API usage billing', args: ['--cli', 'auth', 'login', '--console'], env: {} },
]

const methods = new Map<AgentId, Promise<LoginMethod[]>>()

/** The agent's terminal login methods, asked once per run for each agent. */
export function loginMethods(profile: Profile): Promise<LoginMethod[]> {
  const agent = agentFor(profile).id
  if (agent === 'codex') return Promise.resolve(codexMethods())
  const known = agent === 'claude' ? knownMethods : []
  if (!methods.has(agent)) methods.set(agent, (async () => {
    const conn = new AcpConnection(agentArgv(profile), { cwd: homedir(), env: agentEnv(profile) }, { request: async () => null, notification: () => {} })
    try {
      const init: any = await Promise.race([
        conn.request('initialize', { protocolVersion: 1, clientCapabilities: { auth: { terminal: true } }, clientInfo: { name: 'vellum', version: '0.1.0' } }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 20_000)),
      ])
      const list: LoginMethod[] = (init?.authMethods ?? [])
        .filter((m: any) => m?.type === 'terminal' && Array.isArray(m.args))
        .map((m: any) => ({ id: String(m.id), name: String(m.name ?? m.id), description: m.description || undefined, args: m.args.map(String), env: m.env ?? {} }))
      return list.length ? list : known
    } catch {
      methods.delete(agent)
      return known
    } finally {
      conn.kill()
    }
  })())
  return methods.get(agent)!
}

/**
 * argv and env for one login method under an account, and how it reads (`claude auth login …`).
 * An account that was logged in before asks for the same email again (`--email`, which claude's
 * login takes; an addition to the method's args, so the browser offers the right account).
 */
export function loginCommand(profile: Profile, method: LoginMethod): { argv: string[]; env: Record<string, string>; label: string } {
  if (method.argv) return { argv: method.argv, env: { ...profileEnv(profile), ...method.env }, label: [path.basename(method.argv[0]!), ...method.argv.slice(1)].join(' ') }
  const login = method.args.includes('login')
  // `--email` is claude's login flag; other agents' logins get the method's args as they are.
  const args = [...method.args, ...(login && profile.email && agentFor(profile).id === 'claude' ? ['--email', profile.email] : [])]
  const claude = agentFor(profile).id === 'claude'
  const label = claude ? ['claude', ...args.filter((a) => a !== '--cli')].join(' ') : [path.basename(agentArgv(profile)[0]!), ...agentArgv(profile).slice(1), ...args].join(' ')
  return { argv: [...agentArgv(profile), ...args], env: { ...agentEnv(profile), ...method.env }, label }
}

/**
 * Another logged-in account with the same login as `profileId`. Easy to do by accident: a browser
 * still signed in to one account hands that same account to the next login. (Subrouter keys its
 * accounts by identity for the same reason.)
 */
export function sameLogin(profiles: Profile[], profileId: string, email: string): Profile | undefined {
  const key = email.trim().toLowerCase()
  return profiles.find((p) => p.id !== profileId && p.loggedIn && p.email?.trim().toLowerCase() === key)
}

/** Log an account out (the adapter hands `auth logout` to your claude). */
export async function logout(profile: Profile): Promise<boolean> {
  const agent = agentFor(profile).id
  if (agent === 'codex') {
    const codex = tool('codex')
    if (!codex) return false
    return (await Bun.spawn([codex, 'logout'], { env: profileEnv(profile), cwd: homedir(), stdout: 'ignore', stderr: 'ignore', stdin: 'ignore' }).exited) === 0
  }
  if (agent !== 'claude') return false
  const proc = Bun.spawn([...agentArgv(profile), '--cli', 'auth', 'logout'], { env: agentEnv(profile), cwd: homedir(), stdout: 'ignore', stderr: 'ignore', stdin: 'ignore' })
  return (await proc.exited) === 0
}
