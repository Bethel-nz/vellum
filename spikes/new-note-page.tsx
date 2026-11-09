// Throwaway fresh-page exploration. No agent calls or saved notes.
//   bun spikes/new-note-page.tsx
// Enter sends into a marked sample conversation; Shift+Enter adds a line.
import { useEffect, useReducer, useRef, useState } from 'react'
import type { Profile } from '../core/profiles'
import type { Tag } from '../core/threads'
import type { AgentId } from '../core/agents'
import type { PermissionMode } from '../core/asks'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Isolate every shared module that reads Vellum's storage at import time.
process.env.VELLUM_HOME ??= mkdtempSync(path.join(tmpdir(), 'vellum-page-spike-'))
process.env.VELLUM_CLAUDE_HOME ??= path.join(process.env.VELLUM_HOME, 'claude-home')
const { render, useGpuixRequired, useWindowSize } = await import('@gpuix/react')
const { Button, Icon, Field, Menu, MaterialContext, ExpandingButtonGroup, closedByOutsidePress, useM } = await import('../components')
const { AgentContext } = await import('../components/AgentContext')
const { agents, agentModes, modeFor } = await import('../core/agents')
const { fallbackModels } = await import('../core/models')
const { keys, primary, isMac } = await import('../core/platform')
const { tokens, tagsIn } = await import('../core/tags')
const { Composer } = await import('../ui/Composer')
const { materials, font, type, readingWidthFor, shellInset, windowRadius, concentric, shortPath } = await import('../ui/theme')
const { stripHeight } = await import('../components/TabStrip')
const { FONTS } = await import('../assets/fonts')
const faces = await Promise.all(FONTS.map(async (file) => Buffer.from(await Bun.file(file).arrayBuffer())))
const firstWorkspace = process.env.VELLUM_SPIKE_PROJECT ?? process.cwd()
const seededProjects = [firstWorkspace, ...(process.env.VELLUM_SPIKE_PROJECTS?.split(path.delimiter).filter(Boolean) ?? [])]
const sampleReply = 'Let’s work through it. We’ll start with the shape of the idea, then narrow it down to a useful first step.'

type Exchange = { text: string; tags: Tag[]; agent: AgentId }
type Page = { id: number; workspace: string; agent: AgentId; model: string; mode: PermissionMode; draft: string; tags: Tag[]; exchanges: Exchange[] }
type State = { pages: Page[]; active: number; last: Record<string, number> }
type Action = { type: 'new' } | { type: 'pick'; id: number } | { type: 'write'; text: string; tags: Tag[] } | { type: 'workspace'; value: string } | { type: 'agent'; value: AgentId } | { type: 'model'; value: string } | { type: 'mode'; value: PermissionMode } | { type: 'send' }
const initial: State = { pages: [{ id: 1, workspace: firstWorkspace, agent: 'claude', model: 'default', mode: 'acceptEdits', draft: '', tags: [], exchanges: [] }], active: 1, last: { [firstWorkspace]: 1 } }
function reduce(state: State, action: Action): State {
  const current = state.pages.find((page) => page.id === state.active)!
  if (action.type === 'pick') {
    const target = state.pages.find((page) => page.id === action.id)!
    return { ...state, active: target.id, last: { ...state.last, [target.workspace]: target.id } }
  }
  if (action.type === 'workspace' || action.type === 'new') {
    const workspace = action.type === 'workspace' ? action.value : current.workspace
    const previous = action.type === 'workspace' ? state.last[workspace] : undefined
    if (previous) return { ...state, active: previous }
    const id = state.pages.length + 1
    return { pages: [...state.pages, { id, workspace, agent: current.agent, model: current.model, mode: current.mode, draft: '', tags: [], exchanges: [] }], active: id, last: { ...state.last, [workspace]: id } }
  }
  return { ...state, pages: state.pages.map((page) => {
    if (page.id !== state.active) return page
    if (action.type === 'write') return { ...page, draft: action.text, tags: action.tags }
    if (action.type === 'agent') return { ...page, agent: action.value, model: 'default', mode: modeFor(agents[action.value], page.mode), tags: page.tags.filter((tag) => tag.type !== 'skill') }
    if (action.type === 'model') return { ...page, model: action.value }
    if (action.type === 'mode') return { ...page, mode: action.value }
    if (!page.draft.trim()) return page
    return { ...page, draft: '', tags: [], exchanges: [...page.exchanges, { text: page.draft.trim(), tags: tagsIn(page.draft, page.tags), agent: page.agent }] }
  }) }
}

/** Real native text and measured dots; no rasterized text or controls. */
function Reference({ text, skill }: { text: string; skill: boolean }) {
  const m = useM()
  const [width, setWidth] = useState(0)
  return <div onLayout={(event) => setWidth(Math.round(event.width ?? 0))} style={{ position: 'relative', flexShrink: 0, height: type.user.lineHeight }}>
    <text style={{ ...type.user, fontWeight: 500, color: skill ? m.accent : m.text }}>{text}</text>
    <div aria-hidden style={{ position: 'absolute', left: 0, bottom: 1, height: 1, display: 'flex', flexDirection: 'row', gap: 3, pointerEvents: 'none' }}>
      {Array.from({ length: Math.min(240, Math.floor(width / 4)) }, (_, index) => <div key={index} style={{ width: 1, height: 1, borderRadius: 0.5, backgroundColor: skill ? m.accent : m.blue }} />)}
    </div>
  </div>
}
function Paragraph({ exchange }: { exchange: Exchange }) {
  const m = useM()
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
    {exchange.text.split('\n').map((line, index) => <div key={index} style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 4, minHeight: type.user.lineHeight }}>
      {tokens(line, exchange.tags).flatMap((token, i) => token.kind === 'tag' ? [<Reference key={i} text={token.text} skill={token.tag.type === 'skill'} />] : token.text.split(/\s+/).filter(Boolean).map((word, j) => <text key={`${i}-${j}`} style={{ ...type.user, fontWeight: 500, color: m.text }}>{word}</text>))}
    </div>)}
  </div>
}

function Spike() {
  const renderer = useGpuixRequired()
  const window = useWindowSize()
  const writing = useRef<import('@gpuix/react').PublicInstance>(null)
  const [state, dispatch] = useReducer(reduce, initial)
  const [material, setMaterial] = useState<'dark' | 'light'>(process.env.MATERIAL === 'light' ? 'light' : 'dark')
  const [projectOpen, setProjectOpen] = useState(false)
  const [pillMenu, setPillMenu] = useState<'agent' | 'model' | 'mode'>()
  const [projectQuery, setProjectQuery] = useState('')
  const projectSearch = useRef<import('@gpuix/react').PublicInstance>(null)
  const page = state.pages.find((item) => item.id === state.active)!
  const agent = agents[page.agent]
  const m = materials[material]
  const profile: Profile = { id: `spike-${page.agent}`, name: agent.title, agent: page.agent, configDir: null, color: m.blue, workspaces: [] }
  const fresh = page.exchanges.length === 0
  const projects = [...new Set([page.workspace, ...state.pages.map((item) => item.workspace), ...seededProjects])]
  const foundProjects = projects.filter((item) => item.toLowerCase().includes(projectQuery.toLowerCase()))
  const modes = agentModes(agent)
  const models = page.agent === 'claude' ? fallbackModels : [{ value: 'default', displayName: 'Default' }]
  const modelTitle = models.find((item) => item.value === page.model)?.displayName.replace(' (recommended)', '') ?? 'Default'
  const modeTitle = modes.find((item) => item.id === page.mode)?.label ?? 'Edits'
  const projectPages = state.pages.filter((item) => item.workspace === page.workspace)
  const width = Math.min(readingWidthFor(window.width), window.width - 64)
  useEffect(() => { for (const face of faces) renderer.registerFont?.(face) }, [renderer])
  useEffect(() => {
    const timer = setTimeout(() => {
      if (writing.current) { renderer.focusElement?.(writing.current.id); renderer.scrollIntoView?.(writing.current.id) }
    }, 40)
    return () => clearTimeout(timer)
  }, [state.active, page.exchanges.length, renderer])
  const focus = () => { setTimeout(() => { if (writing.current) renderer.focusElement?.(writing.current.id) }, 30) }
  const selectProject = (workspace: string) => { dispatch({ type: 'workspace', value: workspace }); setProjectOpen(false); focus() }
  const browse = async () => { const picked = await renderer.promptForPaths?.({ directories: true, files: false, multiple: false }); if (picked?.[0]) selectProject(picked[0]); else focus() }
  const togglePill = (next: 'agent' | 'model' | 'mode') => { setPillMenu((current) => current === next || closedByOutsidePress(`spike-${next}`) ? undefined : next); setProjectOpen(false) }
  useEffect(() => {
    if (!projectOpen) return
    const timer = setTimeout(() => { if (projectSearch.current) renderer.focusElement?.(projectSearch.current.id) }, 30)
    return () => clearTimeout(timer)
  }, [projectOpen, renderer])

  return <MaterialContext.Provider value={m}><AgentContext.Provider value={agent}>
    {/* biome-ignore lint/a11y/noStaticElementInteractions: Window-level shortcut boundary; child controls own focus. */}
    <div onKeyDown={(event) => {
      if (event.defaultPrevented) return
      if (primary(event.modifiers) && event.key === 'n') { event.preventDefault(); dispatch({ type: 'new' }) }
      if (primary(event.modifiers) && event.key === 'o') { event.preventDefault(); void browse() }
    }} style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', padding: shellInset, backgroundColor: m.rootTint, color: m.text, fontFamily: font.sans }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: stripHeight, paddingLeft: 12, paddingRight: 12, gap: 8, flexShrink: 0 }}>
        <div style={{ position: 'relative', maxWidth: 210 }}>
          <Button testId="spike-project" title={page.workspace} selected={projectOpen} onPress={() => { setProjectOpen((value) => !value && !closedByOutsidePress('spike-project')); setPillMenu(undefined); setProjectQuery('') }} style={{ height: 26, gap: 7, minWidth: 0, maxWidth: '100%' }}><Icon name="folder" size={14} /><text style={{ ...type.label, color: m.text, whiteSpace: 'nowrap', textOverflow: 'ellipsis', minWidth: 0 }}>{path.basename(page.workspace)}</text><Icon name="chevronDown" size={11} /></Button>
          <Menu open={projectOpen} onClose={() => setProjectOpen(false)} width={Math.min(340, window.width - 40)} side="bottom" closeKey="spike-project" testId="spike-projects"
            header={(submit) => <div style={{ padding: 8 }}><Field fieldRef={projectSearch} testId="spike-project-search" value={projectQuery} onChange={setProjectQuery} placeholder="Search projects…" onSubmit={submit} onKeyDown={(event) => { if (!['escape', 'up', 'down', 'enter'].includes(event.key ?? '')) event.stopPropagation() }} /></div>}
            items={[
              { kind: 'label', label: 'This window' },
              { label: path.basename(page.workspace), hint: shortPath(path.dirname(page.workspace)), checked: true, icon: 'folder', testId: 'spike-current-project', onSelect: () => focus() },
              { kind: 'label', label: 'Recent projects' },
              ...foundProjects.filter((item) => item !== page.workspace).slice(0, 7).map((item, index) => ({ label: path.basename(item), hint: shortPath(path.dirname(item)), icon: 'folder' as const, testId: `spike-recent-${index}`, onSelect: () => selectProject(item) })),
              ...(!foundProjects.some((item) => item !== page.workspace) ? [{ kind: 'label' as const, label: projectQuery ? 'No matching recent projects' : 'Open a folder to add a project' }] : []),
              { kind: 'separator' },
              { label: 'Open folder…', icon: 'folderPlus', shortcut: '⌘O', testId: 'spike-open-folder', onSelect: () => { void browse() } },
            ]} />
        </div><div style={{ flexGrow: 1 }} />
        {projectPages.slice(-4).map((item) => <Button key={item.id} testId={`spike-page-${item.id}`} selected={item.id === page.id} onPress={() => dispatch({ type: 'pick', id: item.id })} style={{ maxWidth: 160, paddingLeft: 10, paddingRight: 10 }}><text style={{ ...type.label, color: item.id === page.id ? m.text : m.textMuted, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{item.exchanges[0]?.text.slice(0, 24) ?? 'New note'}</text></Button>)}
        <Button testId="spike-new" title="New page (⌘N)" onPress={() => dispatch({ type: 'new' })} style={{ width: 24, paddingLeft: 0, paddingRight: 0 }}><Icon name="plus" size={14} /></Button><div style={{ flexGrow: 1 }} />
        <text style={{ ...type.caption, color: m.textMuted }}>Local preview</text><Button testId="spike-theme" title="Switch appearance" onPress={() => setMaterial((value) => value === 'dark' ? 'light' : 'dark')} style={{ width: 24, paddingLeft: 0, paddingRight: 0 }}><Icon name={material === 'dark' ? 'sun' : 'moon'} size={14} /></Button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, borderRadius: concentric(windowRadius, shellInset), backgroundColor: m.pane }}>
        <div testId="spike-page" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexGrow: 1, minHeight: 0, overflowY: 'scroll', scrollbarColor: m.scrollbar, scrollbarWidth: 6 }}>
          <div style={{ display: 'flex', flexDirection: 'column', width, flexShrink: 0, paddingTop: fresh ? 48 : 32, paddingBottom: 100 }}>
            {page.exchanges.map((exchange, index) => <div key={index} testId={`spike-exchange-${index}`} style={{ display: 'flex', flexDirection: 'column', gap: 22, paddingBottom: 32 }}>
              <Paragraph exchange={exchange} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name={exchange.agent} size={14} /><text style={{ ...type.caption, color: m.textMuted }}>Sample reply</text></div><text style={{ ...type.body, color: m.textUi }}>{sampleReply}</text></div>
            </div>)}
            <Composer key={`${page.id}:${page.workspace}:${page.agent}`} variant="new-note" mode={page.mode} modes={modes} onMode={(value) => dispatch({ type: 'mode', value })} value={page.draft} tags={page.tags} onChange={(text, tags) => dispatch({ type: 'write', text, tags })} onSend={() => dispatch({ type: 'send' })} composerRef={writing} workspace={page.workspace} profile={profile} placeholder={fresh ? 'What would you like to work on?' : 'Keep writing…'} tokenCtx={{ workspace: page.workspace }} />
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', paddingTop: 10, gap: 12 }}><text style={{ ...type.meta, color: m.textMuted }}>{keys('↵ send · ⇧↵ new line · @ skills & files')}</text><div style={{ flexGrow: 1 }} /><Button testId="spike-send" title="Send message (Enter)" disabled={!page.draft.trim()} onPress={() => dispatch({ type: 'send' })} style={{ width: 28, height: 28, paddingLeft: 0, paddingRight: 0 }}><Icon name="send" size={14} color={m.text} /></Button></div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'center', paddingTop: 12, paddingBottom: 16, flexShrink: 0 }}>
          <ExpandingButtonGroup label="Agent controls" testId="spike-controls" defaultExpanded="spike-agent" items={[
            { id: 'spike-agent', label: agent.title, ariaLabel: `Agent: ${agent.title}`, icon: <Icon name={page.agent} size={14} />, selected: pillMenu === 'agent', onPress: () => togglePill('agent'), popover: <Menu open={pillMenu === 'agent'} onClose={() => setPillMenu(undefined)} side="top" width={200} closeKey="spike-agent" testId="spike-agents" items={Object.values(agents).map((item) => ({ label: item.title, icon: item.id, checked: page.agent === item.id, testId: `spike-agent-${item.id}`, onSelect: () => { dispatch({ type: 'agent', value: item.id }); focus() } }))} /> },
            { id: 'spike-model', label: modelTitle, ariaLabel: `Model: ${modelTitle}`, icon: <Icon name="layers" size={14} />, selected: pillMenu === 'model', onPress: () => togglePill('model'), popover: <Menu open={pillMenu === 'model'} onClose={() => setPillMenu(undefined)} side="top" width={220} closeKey="spike-model" testId="spike-models" items={models.map((item) => ({ label: item.displayName, checked: page.model === item.value, testId: `spike-model-${item.value}`, onSelect: () => { dispatch({ type: 'model', value: item.value }); focus() } }))} /> },
            { id: 'spike-mode', label: modeTitle, ariaLabel: `Permissions: ${modeTitle}`, icon: <Icon name={page.mode === 'plan' ? 'listChecks' : page.mode === 'manual' ? 'shield' : 'pencil'} size={14} />, selected: pillMenu === 'mode', onPress: () => togglePill('mode'), popover: <Menu open={pillMenu === 'mode'} onClose={() => setPillMenu(undefined)} side="top" width={320} closeKey="spike-mode" testId="spike-modes" items={modes.map((item) => ({ label: item.label, hint: item.hint, checked: page.mode === item.id, testId: `spike-mode-${item.id}`, onSelect: () => { dispatch({ type: 'mode', value: item.id }); focus() } }))} /> },
          ]} />
        </div>
      </div>
    </div>
  </AgentContext.Provider></MaterialContext.Provider>
}

render(<Spike />, { title: 'Vellum · New note spike', appName: 'Vellum preview', appId: 'dev.vellum.new-note-spike', width: 1080, height: 780, focus: process.env.GPUIX_BACKGROUND !== '1', ...(isMac ? { titlebarTransparent: true, trafficLightX: -200, trafficLightY: -200 } : {}) })
