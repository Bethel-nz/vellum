// Spike: does Claude get AskUserQuestion over ACP once the client says it can show forms, and does
// an answer to the form reach it? One tiny haiku turn in a temp folder.
//   bun spikes/ask-question.ts [account-id]       default: main
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AcpConnection } from '../core/acp'
import { agentArgv, agentEnv } from '../core/agent'
import { loadProfiles } from '../core/profiles'

const profile = loadProfiles().find((p) => p.id === (process.argv[2] ?? 'main'))
if (!profile) throw new Error('no such account')
const cwd = mkdtempSync(path.join(tmpdir(), 'vellum-ask-'))
let reply = ''
let form: any
const conn = new AcpConnection(agentArgv(), { cwd, env: agentEnv(profile) }, {
  request: async (method, params) => {
    if (method === 'elicitation/create') {
      form = params
      const field = Object.keys(params.requestedSchema?.properties ?? {})[0]!
      return { action: 'accept', content: { [field]: 'Blue' } }
    }
    return { outcome: { outcome: 'selected', optionId: params.options?.find((o: any) => o.kind === 'allow_once')?.optionId } }
  },
  notification: (method, params) => {
    if (method === 'session/update' && params.update.sessionUpdate === 'agent_message_chunk') reply += params.update.content?.text ?? ''
  },
})
try {
  await conn.request('initialize', { protocolVersion: 1, clientCapabilities: { elicitation: { form: {} } }, clientInfo: { name: 'vellum-spike', version: '0' } })
  const res: any = await conn.request('session/new', { cwd, mcpServers: [] })
  const model = res.configOptions?.find((o: any) => o.category === 'model')
  if (model) await conn.request('session/set_config_option', { sessionId: res.sessionId, configId: model.id, value: 'haiku' })
  await conn.request('session/prompt', {
    sessionId: res.sessionId,
    prompt: [{ type: 'text', text: 'Use your AskUserQuestion tool to ask me one question: which colour I prefer, with the options Red and Blue. Then reply with just the colour I picked.' }],
  })
  console.log(form ? `form arrived: ${JSON.stringify(form.message)} fields ${Object.keys(form.requestedSchema.properties).join(', ')}` : 'NO FORM: the tool was not used')
  console.log(`reply: ${reply.trim()}`)
  console.log(form && /blue/i.test(reply) ? 'works' : 'FAILED')
} finally {
  conn.kill()
  await conn.exited
}
