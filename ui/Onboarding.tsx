import { scrollbarWidth } from './theme'
import { useEffect, useRef, useState } from 'react'
import { DismissableLayer, useGpuixRequired, type PublicInstance } from '@gpuix/react'
import { Button as Choice } from '@gpuix/react/button'
import { Button, Icon, Kbd, Label, useM } from '../components'
import { agents, agentFor, tool, type AgentId } from '../core/agents'
import { keys } from '../core/platform'
import type { Profile } from '../core/profiles'
import { ThemeCards } from './settings/controls'
import type { MaterialName } from './theme'
import type { TabMode } from './Settings'

const steps = ['Welcome', 'Agent', 'Appearance', 'First note']
const starters = [
  { label: 'Get to know a project', prompt: 'Walk me through this project. What does it do, how is it organized, and where should I start?' },
  { label: 'Think through an idea', prompt: 'Help me think through an idea. Ask me a few questions to understand what I want to make before we start.' },
  { label: 'Find a small improvement', prompt: 'Look through this project and suggest one small, useful improvement. Explain it before making any changes.' },
]
const shortcuts = [
  ['New note', '⌘N'], ['Find a note', '⌘K'], ['Ask your agent', '⌘↵'], ['Settings', '⌘,'],
]

export function Onboarding({
  step, onStep, profiles, profileId, onAgent, busy, refreshing, onRefresh, onLogin,
  material, onMaterial, tabs, onTabs, loginActive, error, onFinish,
}: {
  step: number
  onStep: (step: number) => void
  profiles: Profile[]
  profileId?: string
  onAgent: (agent: AgentId) => void
  busy: Set<string>
  refreshing: Set<string>
  onRefresh: (id: string) => void
  onLogin: (id: string) => void
  material: MaterialName
  onMaterial: (material: MaterialName) => void
  tabs: TabMode
  onTabs: (tabs: TabMode) => void
  loginActive: boolean
  error?: string
  onFinish: (prompt?: string) => void
}) {
  const m = useM()
  const renderer = useGpuixRequired()
  const root = useRef<PublicInstance>(null)
  const content = useRef<PublicInstance>(null)
  const [prompt, setPrompt] = useState(starters[0]!.prompt)
  const selected = profiles.find((p) => p.id === profileId)
  const selectedAgent = selected ? agentFor(selected) : undefined
  // Login uses Vellum's existing terminal. Keep the step and draft while it is visible.
  useEffect(() => {
    if (loginActive) return
    const timer = setTimeout(() => {
      if (content.current) renderer.scrollTo?.(content.current.id, 0, 0)
      if (root.current) renderer.focusElement?.(root.current.id)
    }, 80)
    return () => clearTimeout(timer)
  }, [step, loginActive, renderer])
  if (loginActive) return null

  const heading = ['A little room to think.', 'Pick your agent.', 'Make yourself at home.', 'Start with a question.'][step]
  const detail = [
    'A note you can talk to. Bring your thoughts, your code, and an agent to work through it with you.',
    'Use the account you already have. Your agent reads and works alongside you, right in the note.',
    'A familiar place for your work. You can change all of this later in Settings.',
    'Choose a starting point, or write your own. Then pick a folder to give your note some context.',
  ][step]
  const card = { borderRadius: 14, borderWidth: 1, borderColor: m.border, backgroundColor: m.panel }

  return <DismissableLayer initialFocus={() => root.current?.id ?? null} onEscapeKeyDown={() => { if (step > 0) onStep(step - 1) }}>
    {/* biome-ignore lint/a11y/noNoninteractiveTabindex: Native dialog focus target, restored after terminal login. */}
    <div ref={root} testId="onboarding" role="dialog" aria-modal aria-label="Welcome to Vellum" tabIndex={0} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', backgroundColor: m.pane, keyboardFocusDim: false }}>
      <div ref={content} style={{ flexGrow: 1, minHeight: 0, overflowY: 'scroll', display: 'flex', flexDirection: 'column', alignItems: 'center', scrollbarColor: m.scrollbar, scrollbarWidth }}>
        <div style={{ width: '100%', maxWidth: 660, flexGrow: 1, flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingTop: 44, paddingBottom: 28, paddingLeft: 28, paddingRight: 28 }}>
          <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10, marginBottom: 24 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, borderWidth: 1, borderColor: m.border, backgroundColor: m.codeBg, alignItems: 'center', justifyContent: 'center', display: 'flex' }}><text style={{ fontSize: 22, lineHeight: 27, fontWeight: 600, color: m.accent }}>V</text></div>
            <text style={{ fontSize: 16, fontWeight: 600, color: m.text }}>Vellum</text>
          </div>
          {/* biome-ignore lint/a11y/useSemanticElements: GPUIX has native div groups, not HTML fieldsets. */}
          <div role="group" aria-label={`Setup step ${step + 1} of 4`} style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginBottom: 34 }}>
            {steps.map((label, index) => <Button key={label} testId={`onboarding-step-${index}`} title={`${index + 1}. ${label}${index === step ? ', current step' : ''}`} disabled={index > step} onPress={() => onStep(index)} style={{ height: 29, borderRadius: 18, paddingLeft: 9, paddingRight: 11, gap: 7, backgroundColor: index === step ? m.selected : '#00000000', opacity: index > step ? 0.6 : 1 }}>
              <div style={{ width: 17, height: 17, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: index === step ? m.text : '#00000000' }}>
                {index < step ? <Icon name="check" size={13} color={m.success} /> : <text style={{ fontSize: 10.5, fontWeight: 600, color: index === step ? m.pane : m.textMuted }}>{index + 1}</text>}
              </div>
              <text style={{ fontSize: 12, color: index === step ? m.text : m.textMuted }}>{label}</text>
            </Button>)}
          </div>
          <div key={step} style={{ display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
            <text testId="onboarding-heading" style={{ fontSize: 28, lineHeight: 36, fontWeight: 600, color: m.text, textAlign: 'center', marginBottom: 8 }}>{heading}</text>
            <text style={{ fontSize: 13.5, lineHeight: 21, color: m.textMuted, textAlign: 'center', marginBottom: 28, maxWidth: 490, alignSelf: 'center' }}>{detail}</text>

            {step === 0 ? <div style={{ ...card, display: 'flex', flexDirection: 'column', paddingLeft: 24, paddingRight: 24 }}>
              {[
                { icon: 'pencil' as const, title: 'Think on the page', hint: 'Write freely. Ask a question when you need a hand.' },
                { icon: 'folder' as const, title: 'Keep your work close', hint: 'Bring in files, explore code, and review changes together.' },
                { icon: 'notes' as const, title: 'Pick up where you left off', hint: 'Your notes and conversations stay saved on this computer.' },
              ].map((item, index) => <div key={item.title} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 18, paddingTop: 21, paddingBottom: 21, borderTopWidth: index ? 1 : 0, borderColor: m.border }}>
                <Icon name={item.icon} size={21} color={m.textMuted} />
                <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0, gap: 4 }}><text style={{ fontSize: 13.5, fontWeight: 500, color: m.text }}>{item.title}</text><text style={{ fontSize: 12.5, lineHeight: 19, color: m.textMuted }}>{item.hint}</text></div>
              </div>)}
            </div> : null}

            {step === 1 ? <>
              {/* biome-ignore lint/a11y/useSemanticElements: GPUIX has native div groups, not HTML fieldsets. */}
              <div role="group" aria-label="Agents" style={{ ...card, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {Object.values(agents).map((agent, index) => {
                  const profile = (selectedAgent?.id === agent.id ? selected : undefined) ?? profiles.find((p) => agentFor(p).id === agent.id && p.configDir === null) ?? profiles.find((p) => agentFor(p).id === agent.id)
                  const missing = agent.id === 'claude' && !tool('claude') ? 'Claude Code isn’t installed on this computer.' : agent.missing()
                  const chosen = profile?.id === profileId
                  const checking = profile && refreshing.has(profile.id)
                  const signingIn = profile && busy.has(profile.id)
                  const status = missing ? 'Not installed' : checking ? 'Checking…' : profile?.loggedIn ? 'Signed in' : profile?.loggedIn === false ? 'Sign in to get started' : 'Uses your local account'
                  return <div key={agent.id} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', minHeight: 76, backgroundColor: chosen ? m.selected : '#00000000', borderTopWidth: index ? 1 : 0, borderColor: m.border, borderTopLeftRadius: index === 0 ? 13 : 0, borderTopRightRadius: index === 0 ? 13 : 0, borderBottomLeftRadius: index === 2 ? 13 : 0, borderBottomRightRadius: index === 2 ? 13 : 0, paddingRight: 18 }}>
                    <Choice testId={`onboarding-agent-${agent.id}`} aria-label={`${agent.title}: ${status}`} aria-pressed={chosen} disabled={Boolean(missing)} onClick={() => { if (!chosen) onAgent(agent.id) }} style={{ display: 'flex', flexDirection: 'row', flexGrow: 1, minWidth: 0, alignItems: 'center', gap: 14, minHeight: 76, padding: 18, cursor: missing ? 'default' : 'pointer', opacity: missing ? 0.55 : 1, hover: { backgroundColor: missing ? '#00000000' : m.hover }, focusVisible: { outlineWidth: 2, outlineColor: m.focusRing, outlineOffset: -3 } }}>
                      <div style={{ width: 15, height: 15, borderRadius: 8, borderWidth: chosen ? 5 : 1.5, borderColor: chosen ? m.text : m.textFaint }} />
                      <div style={{ width: 30, height: 30, backgroundColor: agent.id === 'codex' ? '#242424' : '#00000000', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={agent.id} size={25} color={agent.id === 'claude' ? '#d97757' : undefined} /></div>
                      <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0, gap: 3 }}><text style={{ fontSize: 13.5, fontWeight: 500, color: m.text }}>{agent.title}</text><text style={{ fontSize: 12, color: m.textMuted }}>{profile?.email ?? status}</text></div>
                    </Choice>
                    {profile?.loggedIn && !missing ? <div style={{ display: 'flex', flexDirection: 'row', gap: 5, alignItems: 'center' }}><Icon name="check" size={13} color={m.success} /><text style={{ fontSize: 12, color: m.success }}>Ready</text></div> : profile && !missing ? <Button testId={`onboarding-login-${agent.id}`} disabled={Boolean(signingIn || checking)} onPress={() => { if (!chosen) onAgent(agent.id); onLogin(profile.id) }} style={{ borderWidth: 1, borderColor: m.border, height: 29, borderRadius: 8 }}><Label>{signingIn ? 'Signing in…' : 'Sign in'}</Label></Button> : null}
                  </div>
                })}
              </div>
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10 }}><text style={{ fontSize: 12, lineHeight: 18, color: m.textMuted, flexGrow: 1, flexShrink: 1 }}>Your agent keeps its own sign-in. Add more accounts in Settings.</text>{selected ? <Button testId="onboarding-refresh" onPress={() => onRefresh(selected.id)} disabled={refreshing.has(selected.id)} title="Check sign-in again"><Icon name="refresh" size={12} /><Label muted>Check again</Label></Button> : null}</div>
              {selectedAgent && !tool(selectedAgent.id === 'claude' ? 'claude' : selectedAgent.id) ? <text style={{ marginTop: 10, fontSize: 12, lineHeight: 18, color: m.textMuted }}>{selectedAgent.id === 'claude' ? 'Install Claude Code to use this agent. You can also choose another installed agent or set up later.' : selectedAgent.missing()}</text> : null}
              {error ? <div role="alert"><text style={{ marginTop: 10, fontSize: 12, lineHeight: 18, color: m.danger }}>{error}</text></div> : null}
            </> : null}

            {step === 2 ? <>
              <text style={{ fontSize: 12, color: m.textMuted, marginBottom: 10 }}>Appearance</text>
              <ThemeCards value={material} onChange={onMaterial} />
              <text style={{ fontSize: 12, color: m.textMuted, marginBottom: 10 }}>Your tabs</text>
              {/* biome-ignore lint/a11y/useSemanticElements: GPUIX has native div groups, not HTML fieldsets. */}
              <div role="group" aria-label="Tab strip behavior" style={{ display: 'flex', flexDirection: 'row', gap: 10 }}>
                {([{ value: 'pinned', title: 'Keep them close', hint: 'Tabs stay in view.' }, { value: 'auto', title: 'Room to write', hint: 'Hide while you write.' }, { value: 'hidden', title: 'Just the note', hint: 'Show with a shortcut.' }] as const).map((option) => <Choice key={option.value} testId={`onboarding-tabs-${option.value}`} aria-label={option.title} aria-pressed={tabs === option.value} onClick={() => onTabs(option.value)} style={{ ...card, display: 'flex', flexDirection: 'column', flexGrow: 1, flexBasis: 0, minWidth: 0, padding: 14, gap: 8, borderColor: tabs === option.value ? m.borderFocused : m.border, backgroundColor: tabs === option.value ? m.selected : m.panel, cursor: 'pointer', focusVisible: { outlineWidth: 2, outlineColor: m.focusRing, outlineOffset: 2 } }}>
                  <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name="notes" size={16} />{tabs === option.value ? <Icon name="check" size={12} color={m.text} /> : null}</div>
                  <text style={{ fontSize: 12.5, fontWeight: 500, color: m.text }}>{option.title}</text><text style={{ fontSize: 11.5, lineHeight: 17, color: m.textMuted }}>{option.hint}</text>
                </Choice>)}
              </div>
              <text style={{ marginTop: 12, fontSize: 12, color: m.textMuted }}>{keys('⇧⌘T shows or hides your tabs, whenever you need them.')}</text>
            </> : null}

            {step === 3 ? <>
              <div style={{ ...card, display: 'flex', flexDirection: 'column', padding: 18, gap: 14 }}>
                <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 7 }}><Icon name="note" size={13} /><text style={{ fontSize: 12, color: m.textMuted }}>Your first note</text><div style={{ flexGrow: 1 }} />{selectedAgent ? <text style={{ fontSize: 12, color: m.textMuted }}>{selectedAgent.title}</text> : null}</div>
                <textarea testId="onboarding-prompt" aria-label="First note prompt" value={prompt} onChange={(e) => setPrompt(e.value ?? '')} minRows={3} maxRows={6} placeholder="What would you like to work on?" style={{ width: '100%', fontSize: 14, lineHeight: 22, color: m.text, backgroundColor: '#00000000', borderWidth: 0, padding: 0 }} />
                <text style={{ fontSize: 11.5, lineHeight: 17, color: m.textMuted }}>This becomes a draft. Send it when you’re ready.</text>
              </div>
              {/* biome-ignore lint/a11y/useSemanticElements: GPUIX has native div groups, not HTML fieldsets. */}
              <div role="group" aria-label="Starting points" style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                {starters.map((starter, index) => <Button key={starter.label} testId={`onboarding-starter-${index}`} onPress={() => setPrompt(starter.prompt)} selected={prompt === starter.prompt} style={{ height: 29, paddingLeft: 11, paddingRight: 11, borderRadius: 8, borderWidth: 1, borderColor: m.border }}><text style={{ fontSize: 11.5, color: m.textUi }}>{starter.label}</text></Button>)}
              </div>
              <text style={{ marginTop: 24, marginBottom: 10, fontSize: 11, color: m.textFaint }}>A FEW KEYS TO KEEP CLOSE</text>
              <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {shortcuts.map(([label, key]) => <div key={label} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, width: '47%' }}><Kbd>{keys(key!)}</Kbd><text style={{ fontSize: 12, color: m.textMuted }}>{label}</text></div>)}
              </div>
            </> : null}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', width: '100%', maxWidth: 660, alignSelf: 'center', flexShrink: 0, paddingTop: 12, paddingBottom: 34, paddingLeft: 28, paddingRight: 28, gap: 12 }}>
        {step > 0 ? <Button testId="onboarding-back" onPress={() => onStep(step - 1)} style={{ height: 34 }}><Label muted>Back</Label></Button> : <text style={{ fontSize: 11.5, color: m.textFaint }}>A space for your next idea.</text>}
        <div style={{ flexGrow: 1 }} />
        <Button testId="onboarding-skip" onPress={() => onFinish()} style={{ height: 34 }}><Label muted>{step === 3 ? 'Go to Vellum' : 'Set up later'}</Label></Button>
        <Button testId="onboarding-next" onPress={() => step === 3 ? onFinish(prompt.trim()) : onStep(step + 1)} style={{ height: 35, paddingLeft: 17, paddingRight: 17, borderRadius: 10, backgroundColor: m.text, hover: { backgroundColor: m.textUi }, active: { backgroundColor: m.textMuted } }}><text style={{ fontSize: 12.5, fontWeight: 600, color: m.pane }}>{step === 3 ? 'Choose a folder' : 'Continue'}</text>{step === 3 ? <Icon name="chevronRight" size={13} color={m.pane} /> : null}</Button>
      </div>
    </div>
  </DismissableLayer>
}
