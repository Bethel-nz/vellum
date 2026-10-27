// Self-check for the agents besides Claude (core/agents.ts), against scripts/fake-acp.ts posing
// as each one (FAKE_ACP_AS), without the window:
// - Vellum's modes go out as that agent's own options: Codex's sandbox and its separate plan
//   option, OpenCode's build and plan. A mode the agent doesn't have falls back to one it does.
// - When the agent changes its mode itself, the note follows, in Vellum's terms.
// - An agent without ACP's systemPrompt gets Vellum's prompt ahead of the session's first
//   message, once, without Claude Code's tool names; Claude still gets it as a systemPrompt.
// - Skills (Claude Code's) aren't offered on another agent's account.
//   bun scripts/check-agents.ts
import path from 'node:path'
import { scratchDir } from './scratch'

const home = await scratchDir('vellum-agents-')
Object.assign(process.env, { VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home'), VELLUM_AGENT: path.resolve(import.meta.dir, 'fake-acp.ts') })
const { AgentRunner } = await import('../core/agent')
const { skills } = await import('../core/tags')
const { newThread, reduce } = await import('../core/threads')
type Ask = import('../core/asks').Ask
type Profile = import('../core/profiles').Profile
type PermissionMode = import('../core/asks').PermissionMode

let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const workspace = await scratchDir('vellum-agents-ws-')

const note = (s: { note: { thread: { blocks: any[] } } }) => s.note.thread.blocks

/** A runner on a fake that poses as `as`, and what it was sent. */
async function session(as: 'claude' | 'codex' | 'opencode', mode?: PermissionMode) {
  const log = path.join(home, `fake-${as}.log`)
  await Bun.write(log, '')
  process.env.FAKE_ACP_AS = as
  process.env.FAKE_ACP_LOG = log
  const profile: Profile = { id: as, name: as, color: '#000', configDir: null, workspaces: [], ...(as === 'claude' ? {} : { agent: as }) }
  let ended = 0
  const changed: PermissionMode[] = []
  const asks: Ask[] = []
  const note = { thread: newThread({ id: `agents-${as}`, title: as, profileId: as, workspace, createdAt: new Date().toISOString() }) }
  const runner: InstanceType<typeof AgentRunner> = new AgentRunner(
    { threadId: `agents-${as}`, workspace, profile, configDirs: [null], mode },
    {
      line(_raw, ev: any) {
        note.thread = reduce(note.thread, ev)
        if (ev.type === 'acp/end') ended++
      },
      record() {},
      ask(a) {
        asks.push(a)
        runner.answer(a.requestId, { allow: true })
      },
      askGone() {},
      modeChanged: (m) => void changed.push(m),
    },
  )
  const sent = async () => (await Bun.file(log).text()).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).in).filter(Boolean)
  const turn = async (text: string) => {
    const before = ended
    runner.send(text)
    const start = Date.now()
    while (ended === before && Date.now() - start < 15_000) await wait(30)
  }
  const settings = async () => (await sent()).filter((m) => m.method === 'session/set_config_option').map((m) => `${m.params.configId}=${m.params.value}`)
  const prompts = async () => (await sent()).filter((m) => m.method === 'session/prompt').map((m) => m.params.prompt.map((c: any) => c.text ?? '').join('\n'))
  return { runner, turn, settings, prompts, changed, profile, asks, note }
}

try {
  // ------------------------------------------------------------ Codex
  const codex = await session('codex')
  await codex.turn('hello')
  expect('Codex: Vellum’s default (Edits) goes out as workspace-write', (await codex.settings()).join(' ') === 'mode=workspace-write', (await codex.settings()).join(' '))
  const [first] = await codex.prompts()
  expect('Codex: Vellum’s prompt goes ahead of the first message', first!.startsWith('About the app you\'re running in') && first!.includes('Captures:') && first!.endsWith('hello'))
  expect('…without Claude Code’s tools (AskUserQuestion, TodoWrite, Task)', !/AskUserQuestion|TodoWrite|Subagents:/.test(first!))
  codex.runner.setMode('plan')
  await wait(300)
  expect('Codex: Plan is read-only plus its plan option', (await codex.settings()).slice(1).join(' ') === 'mode=read-only collaboration_mode=plan', (await codex.settings()).slice(1).join(' '))
  await codex.turn('again')
  expect('…and the prompt went only once', !(await codex.prompts())[1]!.includes('About the app'), (await codex.prompts())[1]!.slice(0, 40))
  await codex.turn('leave plan')
  await wait(100)
  expect('Codex leaving plan by itself is Edits in the note, and nothing else changed it', codex.changed.join(',') === 'acceptEdits', codex.changed.join(','))
  expect('Codex offers no Ask', !(await import('../core/agents')).agentModes((await import('../core/agents')).agents.codex).some((m) => m.id === 'manual'))
  codex.runner.setMode('dontAsk')
  await wait(300)
  expect('Codex has no Don’t ask: it stays on what it has', (await codex.settings()).every((s) => !s.includes('dontAsk')), (await codex.settings()).join(' '))
  // A command and an edit, named Codex's way (exec_command, apply_patch) with only ACP's kind.
  await codex.turn('run the tests')
  const run = codex.asks.at(-1)
  expect('Codex: a command’s approval reads as one', run?.tool === 'Bash' && run.title === `Run in ${path.basename(workspace)}/` && run.detail === 'bun test ui/theme.test.ts', `${run?.tool} · ${run?.title} · ${run?.detail}`)
  const shell = note(codex).filter((b) => b.kind === 'shell').at(-1)
  expect('…and it shows in the note as a command, not a generic tool', shell?.command === 'bun test ui/theme.test.ts' && shell.output === '2 pass' && !note(codex).some((b) => b.kind === 'activity'), JSON.stringify(shell))
  await codex.turn('edit the radius')
  const change = codex.asks.at(-1)
  expect('Codex: an edit’s approval names the file and shows the diff', change?.tool === 'Edit' && change.title === 'Edit ui/theme.ts' && Boolean(change.patch?.includes('+export const radiusXl = 16')), `${change?.tool} · ${change?.title}`)
  const edited = note(codex).filter((b) => b.kind === 'edit').at(-1)
  expect('…and the note shows it as an edit with its diff', edited?.path === 'ui/theme.ts' && edited.added === 1 && edited.removed === 1, JSON.stringify(edited && [edited.path, edited.added, edited.removed]))
  await codex.runner.dispose()
  // The @ menu offers the skills Codex loads: the shared .agents folder, not Claude's.
  for (const [dir, name] of [['.agents', 'from-agents'], ['.claude', 'from-claude']]) {
    await Bun.write(path.join(workspace, dir, 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\n`)
  }
  const offered = skills(workspace, codex.profile, await scratchDir('vellum-agents-home-'))
  expect('Codex: offers its own skills, not Claude\'s', offered.join() === 'from-agents', offered.join())

  // ------------------------------------------------------------ OpenCode
  const oc = await session('opencode', 'manual')
  await oc.turn('hello')
  // Ask isn't OpenCode's: the note runs in Build, which it already is, so nothing is sent.
  expect('OpenCode: a mode it lacks (Ask) falls back to Build', (await oc.settings()).length === 0, (await oc.settings()).join(' '))
  oc.runner.setMode('plan')
  await wait(300)
  expect('OpenCode: Plan is its plan agent', (await oc.settings()).join(' ') === 'mode=plan', (await oc.settings()).join(' '))
  await oc.turn('leave plan')
  await wait(100)
  expect('OpenCode leaving plan by itself is Build (Auto) in the note', oc.changed.at(-1) === 'auto', oc.changed.join(','))
  expect('OpenCode doesn’t steer', !oc.runner.canSteer)
  await oc.runner.dispose()

  // ------------------------------------------------------------ Claude, as before
  const claude = await session('claude')
  await claude.turn('hello')
  const news = (await Bun.file(path.join(home, 'fake-claude.log')).text()).split('\n').filter(Boolean).map((l) => JSON.parse(l).in).filter((m) => m?.method === 'session/new')
  expect('Claude still gets Vellum’s prompt as a systemPrompt, with its tools', Boolean(news[0]?.params?.systemPrompt?.content?.[0]?.text?.includes('AskUserQuestion')))
  expect('…and not in the message', (await claude.prompts())[0] === 'hello', (await claude.prompts())[0])
  claude.runner.setMode('plan')
  await wait(300)
  await claude.turn('leave plan')
  await wait(100)
  expect('Claude leaving plan by itself is Edits, as before', claude.changed.join(',') === 'acceptEdits', claude.changed.join(','))
  await claude.runner.dispose()
} catch (e) {
  failed++
  console.log(`FAIL ${String((e as Error)?.stack ?? e)}`)
}

console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
