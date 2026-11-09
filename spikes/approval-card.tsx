// Spike: the approval card on its own, over a note-like backdrop, with four kinds of request.
// 1 a shell command with the agent's rule, 2 an edit with its diff, 3 a long command that scrolls,
// 4 an MCP tool with JSON arguments and no rule. Keys: 1–4 pick one, ↵ allows, ⌘↵ always allows,
// ⌘⌫ opens Deny, + adds a waiting request, r replays the entrance. Answers walk a queue of 3. MATERIAL=light and AGENT=opencode change the look.
//   bun spikes/approval-card.tsx        (spikes/approval-card-run.ts shoots it)
import { useEffect, useState } from 'react'
import { render, useGpuixRequired } from '@gpuix/react'
import { FONTS } from '../assets/fonts'
import { createTwoFilesPatch } from 'diff'
import { ApprovalCard, type ApprovalView } from '../components/ApprovalCard'
import { AgentContext } from '../components/AgentContext'
import { MaterialContext } from '../components/theme'
import { agents, type AgentId } from '../core/agents'
import { WrappedDiff } from '../ui/blocks'
import { dark, font, light, type } from '../ui/theme'

const m = process.env.MATERIAL === 'light' ? light : dark
const agent = agents[(process.env.AGENT ?? 'claude') as AgentId] ?? agents.claude
const workspace = '/Users/you/dev/vellum'
const at = () => new Date(Date.now() - 4000).toISOString()

const before = 'export function concentric(parentRadius: number, inset: number) {\n  return parentRadius - inset\n}\n'
const after = 'export function concentric(parentRadius: number, inset: number) {\n  // Nested rounding shares one centre, so an inset deeper than its parent gets square corners instead of a negative radius.\n  return Math.max(0, parentRadius - inset)\n}\n'
const patch = createTwoFilesPatch('ui/theme.ts', 'ui/theme.ts', before, after)

const samples: { ask: Omit<ApprovalView, 'requestId' | 'at'>; patch?: string; more?: number }[] = [
  {
    ask: { title: 'Run a command', detail: 'bun test ui/theme.test.ts', tool: 'Bash', input: { command: 'bun test ui/theme.test.ts', description: 'Run the theme tests' }, reason: 'Checks the clamp before you see it', alwaysLabel: "Don't ask again for bun test commands" },
  },
  {
    ask: { title: 'Edit a file', detail: 'ui/theme.ts', tool: 'Edit', input: { file_path: 'ui/theme.ts' }, alwaysLabel: 'Allow edits in this folder for the session' },
    patch,
  },
  {
    ask: { title: 'Run a command', detail: 'git log', tool: 'Bash', input: { command: Array.from({ length: 18 }, (_, i) => `git log --oneline --since="${i + 1} days ago" -- core/browser-runtime.ts | head -n 5`).join(' && \\\n  '), description: 'Read recent history of the browser runtime' } },
  },
  {
    ask: { title: 'Use a tool', detail: 'mcp__vellum__browser', tool: 'mcp__vellum__browser', input: { args: ['open', 'https://example.com'], title: 'Open the docs page' } },
  },
]

// The app's own faces (app.tsx registers them the same way), so mono text renders as mono.
const faces = (await Promise.all(FONTS.map((file) => Bun.file(file).arrayBuffer().then((data) => Buffer.from(data), () => undefined)))).filter((face) => face !== undefined)

function Spike() {
  const renderer = useGpuixRequired()
  useEffect(() => { for (const face of faces) { try { renderer.registerFont?.(face) } catch {} } }, [renderer])
  const [index, setIndex] = useState(0)
  const [round, setRound] = useState(0)
  const [denying, setDenying] = useState(false)
  const [last, setLast] = useState('none yet')
  const [shown, setShown] = useState(true)
  const [queue, setQueue] = useState(3)
  const sample = samples[index]!
  const ask: ApprovalView = { ...sample.ask, requestId: `r${index}-${round}`, at: at() }
  // An answer brings the next request into the same card and the count rolls down, as a queue
  // does (after the last it refills to 3); + is another request arriving; r replays the arrival.
  const answer = (what: string) => { setLast(what); setDenying(false); setIndex((i) => (i + 1) % samples.length); setRound((r) => r + 1); setQueue((q) => (q > 1 ? q - 1 : 3)) }
  const replay = () => { setShown(false); setTimeout(() => setShown(true), 250) }
  ;(globalThis as { spikeKeys?: (key: string, mods?: { cmd?: boolean }) => void }).spikeKeys = (key, mods) => {
    if (denying) return
    if (/^[1-4]$/.test(key)) { setIndex(Number(key) - 1); setRound((r) => r + 1) }
    else if (key === 'r') replay()
    else if (key === '+' || key === '=') setQueue((q) => q + 1)
    else if (key === 'enter') answer(mods?.cmd ? 'always' : 'allow')
    else if (key === 'backspace' && mods?.cmd) setDenying(true)
  }
  return (
    <MaterialContext.Provider value={m}>
      <AgentContext.Provider value={agent}>
        <div testId="backdrop" style={{ width: '100%', height: '100%', position: 'relative', backgroundColor: m.rootTint, padding: 4, fontFamily: font.sans }}>
          <div style={{ width: '100%', height: '100%', position: 'relative', backgroundColor: m.pane, borderRadius: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 40 }}>
            <div style={{ width: '100%', maxWidth: 720, paddingLeft: 32, paddingRight: 32, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <text style={{ ...type.titleLg, color: m.text }}>Tighten the concentric radius helper</text>
              {Array.from({ length: 8 }, (_, i) => <text key={i} style={{ ...type.body, color: m.text }}>{`The note behind the card, paragraph ${i + 1}: enough prose to judge the card against the page it sits over.`}</text>)}
              <text testId="spike-last" style={{ ...type.meta, color: m.textMuted }}>{`Request ${index + 1} of 4 · last answer: ${last} · 1–4 pick · ↵ allow · ⌘↵ always · ⌘⌫ deny · + a request arrives · r replay`}</text>
            </div>
          </div>
          <ApprovalCard
            ask={shown ? ask : undefined}
            more={queue - 1}
            workspace={workspace}
            model="Opus 5.5"
            denying={denying}
            onDenying={setDenying}
            onAllow={() => answer('allow')}
            onAlways={() => answer('always')}
            onDeny={(message) => answer(message ? `deny: ${message}` : 'deny')}
            preview={sample.patch ? <WrappedDiff patch={sample.patch} /> : undefined}
          />
        </div>
      </AgentContext.Provider>
    </MaterialContext.Provider>
  )
}

render(<Spike />, {
  title: 'approval-card-spike',
  ...(() => { const [w, h] = (process.env.SPIKE_WINDOW ?? '1080x780').split('x').map(Number); return { width: w || 1080, height: h || 780 } })(),
  windowBackground: 'opaque',
  onKeyDown(event) {
    ;(globalThis as { spikeKeys?: (key: string, mods?: { cmd?: boolean }) => void }).spikeKeys?.(event.key ?? '', event.modifiers)
  },
})
