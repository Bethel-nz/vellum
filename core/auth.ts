// Logging accounts in and out, and knowing who each one is.
//
// Who: `claude auth status --json` under the account's CLAUDE_CONFIG_DIR. It reads the login
// without a model turn (loggedIn, email, subscriptionType; exit 1 when logged out).
//
// Logging in follows ACP's terminal authentication: the agent lists its methods at initialize
// (the Claude adapter offers `claude-ai-login` and `console-login`), and the client runs the agent
// program again with the method's args in a terminal the person can see. Exit 0 means it worked.
// For the Claude adapter that is `--cli auth login --claudeai`, which hands over to your `claude`.

import { homedir } from 'node:os'
import { AcpConnection } from './acp'
import { agentArgv, agentEnv } from './agent'
import { claudeBin } from './platform'
import type { Profile } from './profiles'

export type AccountStatus = { loggedIn: boolean; email?: string; plan?: string }

const planNames: Record<string, string> = { pro: 'Claude Pro', max: 'Claude Max', team: 'Claude Team', enterprise: 'Claude Enterprise' }

/** Who is logged in to this account, or that nobody is. Undefined if it couldn't be read. */
export async function accountStatus(profile: Profile): Promise<AccountStatus | undefined> {
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

export type LoginMethod = { id: string; name: string; description?: string; args: string[]; env: Record<string, string> }

/** What the Claude adapter offers today, for when asking it fails. */
const knownMethods: LoginMethod[] = [
  { id: 'claude-ai-login', name: 'Claude Subscription', args: ['--cli', 'auth', 'login', '--claudeai'], env: {} },
  { id: 'console-login', name: 'Anthropic Console', description: 'API usage billing', args: ['--cli', 'auth', 'login', '--console'], env: {} },
]

let methods: Promise<LoginMethod[]> | undefined

/** The agent's terminal login methods, asked once per run. */
export function loginMethods(profile: Profile): Promise<LoginMethod[]> {
  return (methods ??= (async () => {
    const conn = new AcpConnection(agentArgv(), { cwd: homedir(), env: agentEnv(profile) }, { request: async () => null, notification: () => {} })
    try {
      const init: any = await Promise.race([
        conn.request('initialize', { protocolVersion: 1, clientCapabilities: { auth: { terminal: true } }, clientInfo: { name: 'vellum', version: '0.1.0' } }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 20_000)),
      ])
      const list: LoginMethod[] = (init?.authMethods ?? [])
        .filter((m: any) => m?.type === 'terminal' && Array.isArray(m.args))
        .map((m: any) => ({ id: String(m.id), name: String(m.name ?? m.id), description: m.description || undefined, args: m.args.map(String), env: m.env ?? {} }))
      return list.length ? list : knownMethods
    } catch {
      methods = undefined
      return knownMethods
    } finally {
      conn.kill()
    }
  })())
}

/** argv and env for one login method under an account. */
export function loginCommand(profile: Profile, method: LoginMethod): { argv: string[]; env: Record<string, string> } {
  return { argv: [...agentArgv(), ...method.args], env: { ...agentEnv(profile), ...method.env } }
}

/** Log an account out (the adapter hands `auth logout` to your claude). */
export async function logout(profile: Profile): Promise<boolean> {
  const proc = Bun.spawn([...agentArgv(), '--cli', 'auth', 'logout'], { env: agentEnv(profile), cwd: homedir(), stdout: 'ignore', stderr: 'ignore', stdin: 'ignore' })
  return (await proc.exited) === 0
}
