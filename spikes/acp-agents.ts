// Spike: what Codex (through @agentclientprotocol/codex-acp) and OpenCode (`opencode acp`) say
// about themselves over ACP, beside the Claude adapter Vellum already runs. Only initialize and
// session/new: no prompt, so no model turn and nothing billed. Sessions start in a scratch folder.
// With SPIKE_SCRATCH_HOMES=1 the agents also get scratch homes, so nothing lands in your history.
// Each agent's answers go to spikes/out/acp-agents-<name>.json.
//   bun spikes/acp-agents.ts [claude|codex|opencode]
import path from 'node:path'
import { AcpConnection } from '../core/acp'
import { scratchDir } from '../scripts/scratch'

const cwd = await scratchDir('vellum-acp-agents-')
const homes = process.env.SPIKE_SCRATCH_HOMES === '1' ? await scratchDir('vellum-acp-homes-') : undefined
// Codex refuses a CODEX_HOME that isn't there yet.
if (homes) await Bun.$`mkdir -p ${path.join(homes, 'codex')}`.quiet()
const claudeAdapter = path.join(import.meta.dir, '..', 'node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js')

const agents: Record<string, { argv: string[]; env?: Record<string, string> }> = {
  claude: { argv: ['bun', claudeAdapter], env: { CLAUDE_CODE_EXECUTABLE: Bun.which('claude') ?? 'claude', ...(homes ? { CLAUDE_CONFIG_DIR: path.join(homes, 'claude') } : {}) } },
  codex: { argv: ['bunx', '--bun', '@agentclientprotocol/codex-acp'], env: homes ? { CODEX_HOME: path.join(homes, 'codex') } : {} },
  opencode: { argv: [Bun.which('opencode') ?? 'opencode', 'acp'], env: homes ? { XDG_DATA_HOME: path.join(homes, 'data'), XDG_STATE_HOME: path.join(homes, 'state') } : {} },
}

const only = process.argv[2]
for (const [name, agent] of Object.entries(agents)) {
  if (only && only !== name) continue
  const seen: unknown[] = []
  const conn = new AcpConnection(agent.argv, { cwd, env: { ...process.env, ...agent.env } }, {
    // Nothing is asked of us without a prompt; refuse anything that comes anyway.
    request: async (method) => {
      seen.push({ request: method })
      throw new Error(`spike answers no ${method}`)
    },
    notification: (method, params) => void seen.push({ method, params }),
  })
  const result: Record<string, unknown> = { name, argv: agent.argv }
  try {
    result.initialize = await withTimeout(conn.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { auth: { terminal: true }, session: { compaction: {} }, elicitation: { form: {} }, fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'vellum-spike', title: 'Vellum spike', version: '0.0.0' },
    }))
    result.sessionNew = await withTimeout(conn.request('session/new', { cwd, mcpServers: [] })).catch((e) => ({ error: String(e?.error?.message ?? e) }))
  } catch (e) {
    result.error = String((e as any)?.error?.message ?? e)
  }
  result.notifications = seen
  result.stderr = conn.stderrTail
  conn.kill()
  const file = path.join(import.meta.dir, 'out', `acp-agents-${name}.json`)
  await Bun.write(file, JSON.stringify(result, null, 2))
  console.log(`${name}: ${result.error ? `error: ${result.error}` : 'ok'} → ${file}`)
}
process.exit(0)

function withTimeout<T>(p: Promise<T>, ms = 60_000): Promise<T> {
  return Promise.race([p, Bun.sleep(ms).then(() => Promise.reject(new Error(`no answer in ${ms / 1000}s`)))])
}
