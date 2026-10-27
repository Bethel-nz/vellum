// Spike: Vellum's appended system prompt reaches Claude over ACP, and a resume that sends it
// again is accepted. Two tiny haiku turns in a temp folder.
//   bun spikes/system-prompt.ts [account-id]       default: main
import path from 'node:path'
import { AcpConnection } from '../core/acp'
import { agentArgv, agentEnv } from '../core/agent'
import { loadProfiles } from '../core/profiles'
import { vellumPrompt } from '../core/prompt'
import { scratchDir } from '../scripts/scratch'

const profile = loadProfiles().find((p) => p.id === (process.argv[2] ?? 'main'))
if (!profile) throw new Error('no such account')
const cwd = await scratchDir('vellum-prompt-')
const systemPrompt = { mode: 'append', content: [{ type: 'text', text: vellumPrompt }] }
async function turn(text: string, sessionId?: string) {
  let reply = ''
  const conn = new AcpConnection(agentArgv(profile!), { cwd, env: agentEnv(profile!) }, {
    request: async () => ({ outcome: { outcome: 'cancelled' } }),
    notification: (method, params) => {
      if (method === 'session/update' && params.update.sessionUpdate === 'agent_message_chunk') reply += params.update.content?.text ?? ''
    },
  })
  try {
    const init: any = await conn.request('initialize', { protocolVersion: 1, clientCapabilities: { elicitation: { form: {} } }, clientInfo: { name: 'vellum-spike', version: '0' } })
    console.log('agent takes a system prompt:', JSON.stringify(init.agentCapabilities?.sessionCapabilities?.systemPrompt))
    const params = { cwd, mcpServers: [], systemPrompt }
    const res: any = sessionId ? await conn.request('session/resume', { ...params, sessionId }) : await conn.request('session/new', params)
    const id = sessionId ?? res.sessionId
    const model = res.configOptions?.find((o: any) => o.category === 'model')
    if (model) await conn.request('session/set_config_option', { sessionId: id, configId: model.id, value: 'haiku' })
    await conn.request('session/prompt', { sessionId: id, prompt: [{ type: 'text', text }] })
    return { id, reply: reply.trim() }
  } finally {
    conn.kill()
    await conn.exited
  }
}
const one = await turn('Without using any tools: which app are you running inside, and which tool would you use to have me choose between options? One sentence.')
console.log('new:', one.reply)
const two = await turn('Without using any tools, in one sentence: what does the app show for your file edits?', one.id)
console.log('resumed:', two.reply)
console.log(/vellum/i.test(one.reply) && /AskUserQuestion/.test(one.reply) && /diff/i.test(two.reply) ? 'works' : 'CHECK THE REPLIES')
