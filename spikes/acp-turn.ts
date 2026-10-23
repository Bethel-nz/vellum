// Spike: drive the Claude ACP adapter (@agentclientprotocol/claude-agent-acp) over stdio JSON-RPC
// the way Vellum will. initialize → session/new → pick haiku → one prompt that writes a file and runs
// Bash (answering request_permission with allow) → then a fresh process does session/load to see the
// replay. Every message in both directions is written to spikes/out/acp-turn.jsonl as a fixture.
//   bun spikes/acp-turn.ts
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const out = path.join(import.meta.dir, 'out', 'acp-turn.jsonl')
mkdirSync(path.dirname(out), { recursive: true })
writeFileSync(out, '')
const cwd = mkdtempSync(path.join(tmpdir(), 'vellum-acp-'))
const adapter = path.join(import.meta.dir, '..', 'node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js')
const claude = Bun.which('claude')!

function start(tag: string) {
  const proc = Bun.spawn(['bun', adapter], {
    cwd,
    env: { ...process.env, CLAUDE_CODE_EXECUTABLE: claude },
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  let seq = 0
  const pending = new Map<number, (r: any) => void>()
  const log = (dir: string, msg: unknown) => appendFileSync(out, JSON.stringify({ tag, dir, at: Date.now(), msg }) + '\n')
  const write = (msg: any) => {
    log('out', msg)
    proc.stdin.write(JSON.stringify(msg) + '\n')
    proc.stdin.flush()
  }
  const request = (method: string, params: unknown) =>
    new Promise<any>((resolve) => {
      const id = ++seq
      pending.set(id, resolve)
      write({ jsonrpc: '2.0', id, method, params })
    })
  ;(async () => {
    const dec = new TextDecoder()
    let buf = ''
    for await (const chunk of proc.stdout) {
      buf += dec.decode(chunk, { stream: true })
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        if (!line.trim()) continue
        const msg = JSON.parse(line)
        log('in', msg)
        if (msg.id !== undefined && msg.method === undefined) {
          pending.get(msg.id)?.(msg)
          pending.delete(msg.id)
        } else if (msg.method === 'session/request_permission') {
          const opt = msg.params.options.find((o: any) => o.kind === 'allow_once') ?? msg.params.options[0]
          console.log(`[${tag}] permission: ${msg.params.toolCall?.title} → ${opt.optionId}`)
          write({ jsonrpc: '2.0', id: msg.id, result: { outcome: { outcome: 'selected', optionId: opt.optionId } } })
        } else if (msg.method === 'session/update') {
          const u = msg.params.update
          if (u.sessionUpdate !== 'agent_message_chunk' && u.sessionUpdate !== 'agent_thought_chunk') console.log(`[${tag}] update ${u.sessionUpdate}${u.title ? ' · ' + u.title : ''}${u.status ? ' · ' + u.status : ''}`)
        } else if (msg.id !== undefined) {
          console.log(`[${tag}] unhandled request ${msg.method}`)
          write({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'not supported' } })
        } else console.log(`[${tag}] notification ${msg.method}`)
      }
    }
  })()
  ;(async () => {
    const dec = new TextDecoder()
    for await (const chunk of proc.stderr) appendFileSync(out + '.stderr', dec.decode(chunk))
  })()
  return { proc, request }
}

const init = { protocolVersion: 1, clientCapabilities: { auth: { terminal: true } }, clientInfo: { name: 'vellum', version: '0.1.0' } }

const a = start('first')
const ir = await a.request('initialize', init)
console.log('authMethods', ir.result?.authMethods?.map((m: any) => m.id), 'caps', Object.keys(ir.result?.agentCapabilities ?? {}))
const nr = await a.request('session/new', { cwd, mcpServers: [] })
if (nr.error) throw new Error(JSON.stringify(nr.error))
const sessionId = nr.result.sessionId
console.log('session', sessionId)
console.log('modes', nr.result.modes?.availableModes?.map((m: any) => m.id), 'current', nr.result.modes?.currentModeId)
for (const o of nr.result.configOptions ?? []) console.log('config', o.id, o.category, o.type, '=', o.currentValue, (o.options ?? []).map((x: any) => x.value ?? x.group).join(','))
const model = (nr.result.configOptions ?? []).find((o: any) => o.category === 'model')
const haiku = model?.options?.flatMap((x: any) => x.options ?? [x]).find((x: any) => /haiku/i.test(x.value))
if (haiku) console.log('set model', (await a.request('session/set_config_option', { sessionId, configId: model.id, value: haiku.value })).error ?? 'ok')
await a.request('session/set_mode', { sessionId, modeId: 'default' })
const t0 = Date.now()
const pr = await a.request('session/prompt', {
  sessionId,
  prompt: [{ type: 'text', text: 'Create hello.txt containing the word hi, then run `cat hello.txt` with Bash. Reply with one word: done.' }],
})
console.log('prompt result', JSON.stringify(pr.result ?? pr.error), `${Date.now() - t0}ms`)
a.proc.kill()
await a.proc.exited

const b = start('reload')
const ir2 = await b.request('initialize', init)
console.log('reload caps loadSession', ir2.result?.agentCapabilities?.loadSession)
const lr = await b.request('session/load', { sessionId, cwd, mcpServers: [] })
console.log('load result', JSON.stringify(lr.error ?? Object.keys(lr.result ?? {})))
b.proc.kill()
await b.proc.exited
console.log('fixture', out)
process.exit(0)
