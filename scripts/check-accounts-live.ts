// Live check for two accounts (spends two tiny haiku turns): both are logged in as different
// people, and a conversation started on one continues on the other through the shared history.
// Run it after logging the second account in (Settings › Accounts).
//   bun scripts/check-accounts-live.ts [first-id] [second-id]      default: main work
import path from 'node:path'
import { AcpConnection } from '../core/acp'
import { agentArgv, agentEnv } from '../core/agent'
import { accountStatus } from '../core/auth'
import { loadProfiles } from '../core/profiles'
import { scratchDir } from './scratch'

const [firstId = 'main', secondId = 'work'] = process.argv.slice(2)
const profiles = loadProfiles()
const first = profiles.find((p) => p.id === firstId)
const second = profiles.find((p) => p.id === secondId)
if (!first || !second) throw new Error(`no account ${!first ? firstId : secondId} (have: ${profiles.map((p) => p.id).join(', ')})`)

let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}

const a = await accountStatus(first)
const b = await accountStatus(second)
expect(`${first.name} is logged in`, Boolean(a?.loggedIn))
expect(`${second.name} is logged in`, Boolean(b?.loggedIn))
expect('as two different people', Boolean(a?.email && b?.email && a.email.toLowerCase() !== b.email.toLowerCase()), `${a?.email ? 'one' : '?'} vs ${b?.email ? 'another' : '?'}`)
if (failed) process.exit(1)

const cwd = await scratchDir('vellum-accounts-live-')
/** One prompt on one account; returns the session id and the reply text. */
async function turn(profile: typeof first, text: string, sessionId?: string) {
  let reply = ''
  const conn = new AcpConnection(agentArgv(profile!), { cwd, env: agentEnv(profile!) }, {
    request: async (_m, params) => ({ outcome: { outcome: 'selected', optionId: params.options.find((o: any) => o.kind === 'allow_once')?.optionId } }),
    notification: (method, params) => {
      if (method === 'session/update' && params.update.sessionUpdate === 'agent_message_chunk') reply += params.update.content?.text ?? ''
    },
  })
  try {
    await conn.request('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'vellum-check', version: '0' } })
    const res: any = sessionId ? await conn.request('session/resume', { sessionId, cwd, mcpServers: [] }) : await conn.request('session/new', { cwd, mcpServers: [] })
    const id = sessionId ?? res.sessionId
    const model = res.configOptions?.find((o: any) => o.category === 'model')
    if (model) await conn.request('session/set_config_option', { sessionId: id, configId: model.id, value: 'haiku' })
    await conn.request('session/prompt', { sessionId: id, prompt: [{ type: 'text', text }] })
    return { id, reply }
  } finally {
    conn.kill()
    await conn.exited
  }
}

const word = ['pineapple', 'lighthouse', 'marmalade', 'saxophone'][Math.floor(Math.random() * 4)]!
const one = await turn(first, `Remember this word for later: ${word}. Reply with just OK.`)
console.log(`${first.name}: started ${one.id.slice(0, 8)}…`)
const two = await turn(second, 'What word did I ask you to remember? Reply with just the word.', one.id)
expect(`${second.name} continues the same conversation`, two.id === one.id)
expect('and remembers what was said on the other account', two.reply.toLowerCase().includes(word), two.reply.trim())
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
