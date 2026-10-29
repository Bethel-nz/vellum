// Vellum: a markdown note you can talk to. Drives the official `claude` CLI.
//
// Layout: a tab bar of open notes on the glass, then the page: its title (with
// a menu) and the note itself. The note is one editable document; new writing
// goes at its end, and Enter asks the agent. Cmd+K finds any note; Cmd+N starts one.

import { homedir } from 'node:os'
import path from 'node:path'
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { render, useGpuixRequired, useWindowSize, type EventPayload, type KeyEvent, type PublicInstance } from '@gpuix/react'
import { AnimatePresence, motion } from './components/spring'
import { ApprovalCard, Button, closedByOutsidePress, DockPanel, Field, Menu, stripHeight, TabStrip, useToast, type MenuItem as MenuEntry, type StripTab } from './components'
import { FloatingLayer } from '@gpuix/react/floating'
import { StreamChunk, useStreamChunks } from './components/StreamChunk'
import { AgentMark } from './components/AgentMark'
import { AgentWorking } from './components/AgentWorking'
import { ConfirmMorph } from './components/ConfirmMorph'
import { UsageLimitBanner } from './components/UsageLimitBanner'
import { usageLimitFromText, usageLimitKey } from './core/usage'
import { duration, ease, setReducedMotion, tween } from './components/motion'
import { AgentRunner, killAllAgents } from './core/agent'
import { mcp } from './core/mcp'
import { recoverCaptureDeliveries, startBridge, updateCapture } from './core/bridge'
import { closeAllBrowsers, closeBrowser } from './core/browser'
import { capturePrompt, type BrowserSession, type CaptureStatus, type SavedCapture } from './core/capture'
import { captureDir, captureImages, copyCapture, readCapture } from './core/captures'
import { captureOpen, collectAnnotations } from './core/annotations'
import { CaptureViewer } from './ui/Capture'
import { Annotations } from './ui/Annotations'
import { NotificationBanner, NotificationInboxButton } from './ui/Notifications'
import { BrowserViewer } from './ui/BrowserBlock'
import { AgentScreenHost, BrowserLauncher } from './ui/AgentScreenHost'
import { closeBrowserSessionsOnExit, getBrowserSession, subscribeBrowserRuntime, validateBrowser } from './core/browser-runtime'
import { MobileView, type PhoneCapture } from './ui/MobileView'
import { mobileSupported, registerMobileOpener } from './core/mobile'
import { accountRefreshInterval, accountStatus, loginCommand, loginMethods, logout, sameLogin, type AccountStatus } from './core/auth'
import { linkAccount } from './core/accounts'
import { identityFor, machineAvatar, realName } from './core/avatar'
import { cacheModels, cachedModels, shortModel, type EffortOption, type ModelOption } from './core/models'
import { StatusBar } from './ui/StatusBar'
import { AskUserQuestions } from './components/AskUserQuestions'
import type { QuestionContent } from './core/questions'
import { type Ask, type PermissionMode, type Think } from './core/asks'
import { createProfile, existingAgentProfile, loadProfiles, profileEnv, profileForWorkspace, rememberWorkspace, updateProfile, type Profile } from './core/profiles'
import { loadJson, paths, readSettings, updateSettings, writeJson } from './core/store'
import { promptFor, relabel, tagsIn, tagText } from './core/tags'
import { heldTerms, holdTerm, killAllTerms, restoreTmuxTerms, startTerm, tmuxShell, type TermSession } from './core/term'
import { appIsActive, setDockIcon } from './core/dock'
import { activity } from './core/activity'
import { askNoticeId, notificationInbox, notify } from './core/notify'
import { HELP_ID } from './core/help'
import { HelpNote } from './ui/Help'
import { FONTS } from './assets/fonts'
import { ImageViewer, type Viewing } from './ui/ImageViewer'
import { fitFile, FILE_MIN, FilePreview, previewLayout, TREE_MAX, TREE_MIN, TREE_WIDTH, type Previewing } from './ui/FilePreview'
import { purgeTrash, trashNote } from './core/trash'
import { claudeBin, clipboardText, compiled, hasPty, isImageName, isMac, keys, openConsole, pasteImage, primary, revealFolder, revealLabel, shellArgv, tabStep } from './core/platform'
import {
  appendLine,
  appendRecord,
  loadThreads,
  newThread,
  newThreadId,
  describeEdits,
  handoffContext,
  pendingEdits,
  reduce,
  titleFrom,
  writeMarkdown,
  type Block,
  type Tag,
  type Thread,
  type VellumRecord,
} from './core/threads'
import { BlockView, DiffCard, toolActivityGroups, type BlockActions } from './ui/blocks'
import { Composer, type QueuedMessage } from './ui/Composer'
import { ProjectPicker } from './ui/ProjectPicker'
import { TrustNotice } from './components/TrustNotice'
import { History } from './ui/History'
import { expandRecipe, gitBranch, loadRecipes, recipeCall, type Recipe } from './core/recipes'
import { useLoaded } from './ui/useLoaded'
import { Changes } from './ui/Changes'
import { followStreaming, revealEnd } from './ui/glide'
import { Timeline, watchRows } from './ui/Timeline'
import { changeSummary, collectChanges, commentTags, hunkTags, type Hunk } from './core/changes'
import { listDir, prepareTree } from './core/filetree'
import { agentChoices, agentFor, agentModes, folderConfig, modeFor, type AgentId } from './core/agents'
import { AgentContext } from './components/AgentContext'
import { uncommittedFiles } from './core/gitsnap'
import type { ChangeSummary } from './components/ChangesSummary'
import { Icon, Kbd, MaterialContext, Meta, Quiet, useM } from './ui/kit'
import { SettingsPage, type MotionPref, type TabMode } from './ui/Settings'
import { Onboarding } from './ui/Onboarding'
import { StartupScreen } from './ui/Startup'
import { CELL_W, TerminalBlock } from './ui/TerminalBlock'
import {
  accentFor,
  concentric,
  elevation,
  radiusBase,
  font,
  readingWidthFor,
  shellInset,
  materialNamed,
  materialNames,
  materials,
  windowRadius,
  type MaterialName,
} from './ui/theme'

/** Most tabs open at once: one per ⌘1–⌘9. The rest live in History (⌘Y). */
const MAX_TABS = 9
/** The phone pane's bounds when dragged: room for the phone and its controls, up to the phone's own size. */
const MOBILE_MIN = 300
const MOBILE_MAX = 520
/** ↵ / ⌘↵ in the composer don't answer a card younger than this. */
const ASK_KEY_DELAY_MS = 400
const motionPref = (p: MotionPref) => setReducedMotion(p === 'system' ? undefined : p === 'reduce')
motionPref(readSettings().motion ?? 'system')
// What has been in the trash 30 days goes for good at launch (core/trash.ts).
void purgeTrash()

/**
 * A terminal of its own in the terminal view: a login, Claude Code on a note, or a shell.
 * `title` names its tab; `label` is what runs, as you'd type it (the header); `hint` what to do.
 */
type Term = {
  id: string
  kind: 'login' | 'claude' | 'shell'
  title: string
  label: string
  hint?: string
  session: TermSession
  threadId?: string
  workspace?: string
  /** Shell tabs under tmux: the session name, terms.json's way back in. */
  tmux?: string
}

type Draft = { text: string; tags: Tag[]; images?: string[] }

// Window-level shortcuts are registered once in render(); App swaps the handler in.
const shortcuts: { current?: (e: KeyEvent) => void } = {}

// ---------------------------------------------------------------- document

function Paragraph({ children, kind, nodeRef }: { children: React.ReactNode; kind?: Block['kind'] | 'title' | 'status' | 'composer' | 'stream'; nodeRef?: React.Ref<PublicInstance> }) {
  const top = kind === 'user' || kind === 'composer' ? 12 : kind === 'title' ? 20 : 12
  const width = readingWidthFor(useWindowSize().width)
  const bottom = kind === 'composer' ? 52 : 6
  return (
    <div ref={nodeRef} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', paddingTop: kind === 'stream' ? 6 : top, paddingBottom: kind === 'stream' ? 6 : bottom }}>
      <div style={{ width: '100%', maxWidth: width, paddingLeft: 28, paddingRight: 28 }}>{children}</div>
    </div>
  )
}

function Reply({ block, actions }: { block: Extract<Block, { kind: 'assistant' }>; actions: BlockActions }) {
  const chunks = useStreamChunks(block.markdown, block.streaming)
  if (!block.streaming) return <Paragraph kind="assistant"><BlockView block={block} actions={actions} /></Paragraph>
  return <>{chunks.map((chunk, index) => <Paragraph key={chunk.id} kind="stream"><div style={{ position: 'relative' }}>{index === 0 ? <AgentMark /> : null}<StreamChunk text={chunk.text} id={`stream-${block.id}-${chunk.id}`} /></div></Paragraph>)}</>
}

// The whole page is the note: your paragraphs, Claude's replies and tool work,
// then the paragraph being written. There is no separate input box.
const Document = memo(function Document({
  thread,
  actions,
  composer,
  onStop,
  waiting,
  onTailClick,
  listRef,
  onVisibleRange,
  captureTarget,
  notice,
}: {
  thread: Thread
  actions: BlockActions
  composer: React.ReactNode
  /** In place above the composer: what's keeping the note from sending. */
  notice?: React.ReactNode
  onStop: () => void
  waiting?: boolean
  onTailClick: () => void
  listRef?: React.Ref<PublicInstance>
  onVisibleRange?: (range: [number, number]) => void
  captureTarget?: { id: string; nonce: number }
}) {
  const m = useM()
  const renderer = useGpuixRequired()
  const captureNode = useRef<PublicInstance>(null)
  useEffect(() => {
    if (!captureTarget) return
    const timer = setTimeout(() => { if (captureNode.current) renderer.scrollIntoView?.(captureNode.current.id) }, 32)
    return () => clearTimeout(timer)
  }, [captureTarget, renderer])
  const [dismissedLimit, setDismissedLimit] = useState('')
  const toolGroups = useMemo(() => toolActivityGroups(thread.blocks), [thread.blocks])
  const [inspectingTools, setInspectingTools] = useState(false)
  const onInspectTools = useCallback(() => setInspectingTools(true), [])
  const displayedActions = useMemo(() => ({ ...actions, onInspectTools }), [actions, onInspectTools])
  const limit = thread.usageLimit
  const limitKey = limit ? `${thread.id}:${usageLimitKey(limit)}` : ''
  const lastUser = thread.blocks.map((block) => block.kind).lastIndexOf('user')
  const lastUserId = thread.blocks[lastUser]?.id
  useEffect(() => setInspectingTools(false), [lastUserId])
  // While Claude streams, new rows land above the composer: keep the end in view while
  // the viewport is already near it. Further up, leave the reader alone; a scroll of
  // your own stops the glide and reads as further away, so nothing restarts it.
  // Inspecting tools pauses it, like followTail.
  const running = thread.running
  const blocks = thread.blocks
  useEffect(() => {
    if (!running || inspectingTools) return
    const id = (listRef as React.MutableRefObject<PublicInstance | null> | undefined)?.current?.id
    if (id == null) return
    followStreaming(renderer, id)
  }, [running, blocks, inspectingTools, listRef, renderer])
  const hasLimitError = limit?.state === 'reached' && thread.blocks.slice(lastUser + 1).some((block) => {
    if (block.kind !== 'error') return false
    const error = block.usageLimit ?? usageLimitFromText(block.text)
    return error?.state === 'reached' && (error.window === limit.window || error.window === 'usage') && (!error.resetsAt || !limit.resetsAt || error.resetsAt === limit.resetsAt)
  })
  return (
    <virtual-list
      ref={listRef}
      onVisibleRange={(e) => onVisibleRange?.([e.startIndex ?? 0, e.endIndex ?? 0])}
      onScroll={() => activity.touch()}
      alignment="top"
      followTail={!inspectingTools}
      estimatedItemHeight={90}
      overdraw={600}
      style={{ flexGrow: 1, minHeight: 0, width: '100%', scrollbarColor: m.scrollbar, scrollbarWidth: 10 }}
    >
      <div key="head" style={{ height: 16 }} />
      {thread.blocks.map((original) => {
        const grouped = toolGroups.get(original.id)
        if (grouped === null) return <div key={original.id} style={{ height: 0 }} />
        const b = grouped ?? original
        return b.kind === 'activity' && !actions.showThoughts && !b.items.length ? <div key={b.id} style={{ height: 1 }} /> : b.kind === 'assistant' ? <Reply key={b.id} block={b} actions={actions} /> : (
          <Paragraph key={b.id} kind={b.kind} nodeRef={b.kind === 'capture' && b.saved.capture.id === captureTarget?.id ? captureNode : undefined}>
            <BlockView block={b} actions={displayedActions} />
          </Paragraph>
        )
      })}
      {thread.running ? (
        <Paragraph key="working" kind="status">
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <AgentWorking label={waiting ? 'Waiting for you' : thread.r.last === 'agent_message_chunk' ? 'Writing' : thread.r.last === 'agent_thought_chunk' ? 'Thinking' : 'Thinking'} />
            <Quiet onPress={onStop} testId="stop" title="Stop">
              <Meta color={m.textFaint}>{keys('Stop ⌘.')}</Meta>
            </Quiet>
          </div>
        </Paragraph>
      ) : null}
      {limit && !hasLimitError && dismissedLimit !== limitKey ? <Paragraph key="usage-limit" kind="status">
        <UsageLimitBanner limit={limit} hideAfterReset onDismiss={limit.state === 'approaching' ? () => setDismissedLimit(limitKey) : undefined} />
      </Paragraph> : null}
      {notice ? <Paragraph key="notice" kind="status">{notice}</Paragraph> : null}
      <Paragraph key="composer" kind="composer">
        {composer}
      </Paragraph>
      {/* Room past the end, like an editor; clicking it puts the caret back at the end. */}
      <div key="tail" onClick={onTailClick} style={{ height: 160, cursor: 'text' }} />
    </virtual-list>
  )
})

// ---------------------------------------------------------------- header

const clock = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** The account a note runs on. The account menu hangs off it. */
/**
 * The note's account, on the strip: a menu of your accounts that moves the note to the one you
 * pick (Claude carries on there in a new session, with the note so far), and the way to Settings.
 */
/**
 * The file the pane opens on when it's asked for the files: the one this note changed last,
 * else the folder's README, else its first file. Undefined only for an empty folder.
 */
async function defaultFile(thread: Thread): Promise<string | undefined> {
  const workspace = thread.workspace
  // Newest group first, and in a group the file edited last.
  const recent = collectChanges(thread).flatMap((group) => group.files.map((f) => path.relative(workspace, path.resolve(workspace, f.path))).reverse())
  for (const rel of recent) if (!rel.startsWith('..') && (await Bun.file(path.join(workspace, rel)).exists())) return rel
  const files = listDir(workspace).filter((e) => !e.dir)
  return (files.find((e) => /^readme(\.|$)/i.test(e.name)) ?? files.find((e) => !e.ignored) ?? files[0])?.rel
}

/**
 * The current note's menu, hung off its tab pill: rename, open in Claude Code, show the folder,
 * close. Rename opens a one-line field in the same place.
 */
function NoteMenu({
  thread,
  profile,
  open,
  onOpenChange,
  canOpenClaude,
  onRename,
  onOpenClaude,
  onClose,
}: {
  thread: Thread
  profile?: Profile
  open: boolean
  onOpenChange: (open: boolean) => void
  canOpenClaude: boolean
  onRename: (title: string) => void
  onOpenClaude: () => void
  onClose: () => void
}) {
  const m = useM()
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(thread.title)
  useEffect(() => {
    setRenaming(false)
    onOpenChange(false)
  }, [thread.id])
  const finishRename = () => {
    const next = name.trim()
    if (next && next !== thread.title) onRename(next)
    setRenaming(false)
  }
  const folder = thread.workspace.replace(homedir(), '~')
  const items: MenuEntry[] = [
    {
      label: 'Rename',
      testId: 'menu-rename',
      onSelect: () => {
        setName(thread.title)
        setRenaming(true)
      },
    },
    { label: 'Open in Claude Code', icon: 'terminal', testId: 'menu-open-claude', disabled: !canOpenClaude, onSelect: onOpenClaude },
    { label: revealLabel, icon: 'folder', onSelect: () => revealFolder(thread.workspace) },
    { kind: 'separator' },
    { label: 'Close tab', icon: 'x', shortcut: '⇧⌘W', testId: 'menu-close', onSelect: onClose },
  ]
  return (
    <>
      <Menu
        open={open}
        onClose={() => onOpenChange(false)}
        items={items}
        width={280}
        testId="title-menu-panel"
        header={
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: 9, paddingRight: 9, paddingTop: 5, paddingBottom: 7 }}>
            <Meta color={m.textMuted} mono>{folder}</Meta>
            <Meta>{`${profile?.name ?? thread.profileId}${thread.model ? ` · ${thread.model}` : ''}`}</Meta>
          </div>
        }
      />
      {renaming ? (
        <FloatingLayer side="bottom" align="start" sideOffset={6} style={{ width: 320, backgroundColor: '#00000000' }}>
          <div onMouseDownOutside={finishRename} style={{ display: 'flex', padding: 5, backgroundColor: m.popup, borderRadius: concentric(radiusBase + 5, 0), borderWidth: 1, borderColor: m.border, boxShadow: elevation(m, 'popover') }}>
            <Field
              testId="title-input"
              value={name}
              autoFocus
              onChange={setName}
              onSubmit={finishRename}
              onKeyDown={(e) => {
                if (e.key === 'escape') {
                  e.preventDefault()
                  setRenaming(false)
                }
              }}
            />
          </div>
        </FloatingLayer>
      ) : null}
    </>
  )
}

function EmptyState({ onNew }: { onNew: () => void }) {
  const m = useM()
  return (
    <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
      <text style={{ fontSize: 22, lineHeight: 28, fontWeight: 600, color: m.text }}>A note you can talk to</text>
      <text style={{ fontSize: 13.5, lineHeight: 20, color: m.textMuted }}>Pick an account and a folder, then write.</text>
      <Quiet onPress={onNew} testId="empty-new" style={{ height: 30, paddingLeft: 12, paddingRight: 10 }}>
        <Icon name="plus" size={13} color={m.text} />
        <text style={{ fontSize: 13, lineHeight: 16, color: m.text }}>New note</text>
        <Kbd>⌘N</Kbd>
      </Quiet>
    </div>
  )
}

/**
 * The terminal view: one terminal, full size, no title chrome — its tab in the strip names it
 * and closes it. A login or a Claude Code pane shows its hint and a floating ✕; a shell pane
 * is just the run.
 */
function TerminalView({ term, onClose, onLeave }: { term: Term; onClose: () => void; onLeave: () => void }) {
  const guided = term.kind === 'login' || term.kind === 'claude'
  return (
    <div style={{ flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <TerminalBlock
        key={term.id}
        session={term.session}
        mode="full"
        bare
        autoFocus
        onReturnFocus={onLeave}
        {...(guided ? { hint: term.hint, onClose } : {})}
        testId="pane-term"
      />
    </div>
  )
}

// ---------------------------------------------------------------- app

function initialMaterial(): MaterialName {
  return materialNamed(readSettings().material)
}

/** Stands in until the recipes are read: one array, so memoized children don't redraw for it. */
const NO_RECIPES: Recipe[] = []

/**
 * Read side by side while the startup screen shows: unsent writing and the notes from last time, the
 * bundled fonts (one that's missing is skipped), and your Mac account picture (core/avatar.ts).
 */
async function loadStartup() {
  const [savedDrafts, savedQueues, savedThreads, fontFaces, machinePicture] = await Promise.all([
    loadJson<Record<string, Draft>>(paths.drafts, {}),
    loadJson<Record<string, QueuedMessage[]>>(paths.queues, {}),
    loadThreads(),
    Promise.all(FONTS.map((file) => Bun.file(file).arrayBuffer().then((data) => ({ file, bytes: Buffer.from(data) }), () => undefined))).then((faces) => faces.filter((face) => face !== undefined)),
    machineAvatar(),
  ])
  return { savedDrafts, savedQueues, savedThreads, fontFaces, machine: { src: machinePicture, name: realName() } }
}

type StartupData = Awaited<ReturnType<typeof loadStartup>>

function Startup() {
  const [data, setData] = useState<StartupData>()
  const [error, setError] = useState<string>()
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    // A brief minimum avoids flashing the screen when local files load immediately.
    const minimum = new Promise<void>((resolve) => { timer = setTimeout(resolve, 900) })
    void Promise.all([loadStartup(), minimum]).then(([loaded]) => {
      if (!cancelled) setData(loaded)
    }).catch((cause) => { if (!cancelled) setError(String((cause as Error)?.message ?? cause)) })
    return () => { cancelled = true; clearTimeout(timer) }
  }, [attempt])
  if (data) return <App startup={data} />
  return <MaterialContext.Provider value={materials[initialMaterial()]}><StartupScreen error={error} onRetry={() => { setError(undefined); setAttempt((value) => value + 1) }} /></MaterialContext.Provider>
}

function App({ startup: { savedDrafts, savedQueues, savedThreads, fontFaces, machine } }: { startup: StartupData }) {
  const renderer = useGpuixRequired()
  const windowSize = useWindowSize()
  const [materialName, setMaterialName] = useState<MaterialName>(initialMaterial)
  const material = materials[materialName]

  const [profiles, setProfiles] = useState<Profile[]>(loadProfiles)
  const [onboarding, setOnboarding] = useState(() => !readSettings().onboardingComplete && !savedThreads.length && !readSettings().helpShown)
  const [onboardingStep, setOnboardingStep] = useState(0)
  const [onboardingProfile, setOnboardingProfile] = useState(() => profiles.find((p) => p.id === readSettings().newNoteProfile)?.id ?? profiles[0]?.id)
  const [onboardingError, setOnboardingError] = useState('')
  const [threads, setThreadsState] = useState<Thread[]>(savedThreads)
  const [activeId, setActiveId] = useState<string | undefined>(() => {
    const { lastThreadId: last, helpShown } = readSettings()
    // A first launch, with no notes yet, opens on the Help note (core/help.ts).
    if (!threads.length && !helpShown) return HELP_ID
    return threads.some((t) => t.id === last) || last === HELP_ID ? last : threads[0]?.id
  })
  // Open notes, in tab order. The active note is always one of them.
  const [tabs, setTabs] = useState<string[]>(() => {
    const open = (readSettings().openTabs ?? []).filter((id) => id === HELP_ID || threads.some((t) => t.id === id))
    return activeId && !open.includes(activeId) ? [...open, activeId] : open
  })
  // Replies that finished while their tab was in the background.
  const [unread, setUnread] = useState<Record<string, number>>({})
  /** Permission asks waiting on you, per note, oldest first. They live as long as their process. */
  const [asks, setAsks] = useState<Record<string, Ask[]>>({})
  const [models, setModels] = useState<Record<string, ModelOption[]>>(cachedModels)
  const [efforts, setEfforts] = useState<Record<string, EffortOption[]>>({})
  const [denying, setDenying] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, Draft>>(savedDrafts)
  // At-launch New note uses the same page creation path as ⌘N.
  const [overlay, setOverlay] = useState<null | 'new' | 'settings' | 'history' | 'changes' | 'annotations'>(() => (readSettings().atLaunch === 'new' ? 'new' : null))
  // Settings opens on Accounts when it's about an account (the account menu, no account yet).
  const [settingsPage, setSettingsPage] = useState<'Vellum' | 'Accounts'>('Vellum')
  const openSettings = useCallback((page: 'Vellum' | 'Accounts' = 'Vellum') => { setSettingsPage(page); setOverlay('settings') }, [])
  /** Each note's file open beside it (ui/FilePreview.tsx); pressing the same chip again closes it. */
  const [previews, setPreviews] = useState<Record<string, Previewing>>({})
  /** Messages sent while Claude was thinking, by note; drained in order after the turn. */
  const [queues, setQueues] = useState<Record<string, QueuedMessage[]>>(savedQueues)
  const queuesRef = useRef(queues)
  queuesRef.current = queues
  const togglePreview = useCallback((noteId: string, file: Previewing) => {
    setPreviews((all) => {
      const { [noteId]: open, ...rest } = all
      return open?.path === file.path && open.line === file.line && open.endLine === file.endLine ? rest : { ...rest, [noteId]: file }
    })
  }, [])
  /** Whether the file pane shows the folder's tree (⇧⌘E); one choice for every note. */
  const [fileTree, setFileTree] = useState(() => readSettings().fileTree ?? false)
  const [mobileOpen, setMobileOpen] = useState(() => mobileSupported && readSettings().mobileView === true)
  useEffect(() => registerMobileOpener(() => { setMobileOpen(true); updateSettings({ mobileView: true }) }), [])
  const toggleMobile = () => setMobileOpen((open) => { updateSettings({ mobileView: !open }); return !open })
  // The phone pane: dragged to a width of its own within bounds (wide enough for the phone's
  // controls, never past half the window), else a share of the window.
  const [mobileSize, setMobileSize] = useState(() => readSettings().mobileWidth)
  const mobileMax = Math.max(MOBILE_MIN, Math.min(MOBILE_MAX, Math.round(windowSize.width * 0.5)))
  const fitMobile = (width: number) => Math.round(Math.min(mobileMax, Math.max(MOBILE_MIN, width)))
  const mobileWidth = fitMobile(mobileSize ?? Math.min(380, Math.round(windowSize.width * 0.3)))
  /** While a finger is down on the phone, the window's moves and lift go to it. */
  const [phoneCapture, setPhoneCapture] = useState<PhoneCapture>()
  // Text selection stays in the pane it starts in. The pane under the pointer is the one that
  // selects; the others opt out. Only a move with no button down hands it over, so a drag keeps
  // its pane to the lift and its selection stops at the pane's edge instead of running on into
  // the file, the phone or the note beside it.
  type Pane = 'page' | 'file' | 'mobile'
  const [activePane, setActivePane] = useState<Pane>('page')
  const activePaneRef = useRef<Pane>('page')
  const hoverPane = (pane: Pane) => (event: EventPayload) => {
    if (event.pressedButton !== undefined || activePaneRef.current === pane) return
    activePaneRef.current = pane
    setActivePane(pane)
  }
  const mobileOverlay = windowSize.width < 960
  const workspaceWidth = windowSize.width - (mobileOpen && !mobileOverlay ? mobileWidth + shellInset : 0)
  const showTree = useCallback((open: boolean) => {
    setFileTree(open)
    updateSettings({ fileTree: open })
  }, [])
  /** A pasted image open full size over everything (ui/ImageViewer.tsx). */
  const [viewing, setViewing] = useState<Viewing>()
  const [captureViewing, setCaptureViewing] = useState<SavedCapture>()
  const [captureJump, setCaptureJump] = useState<{ noteId: string; id: string; nonce: number }>()
  const browserPage = useRef<PublicInstance>(null)
  const liveBrowser = useSyncExternalStore(subscribeBrowserRuntime, () => activeId ? getBrowserSession(activeId)?.generation + ":" + getBrowserSession(activeId)?.phase + ":" + getBrowserSession(activeId)?.lastActionId : "")
  const [browserViewing, setBrowserViewing] = useState<BrowserSession>()
  const [drivingBrowserNoteId, setDrivingBrowserNoteId] = useState<string>()
  const drivingBrowserRef = useRef(drivingBrowserNoteId)
  drivingBrowserRef.current = drivingBrowserNoteId
  // The History panel's two sides: past notes, or recipes.
  const [shelf, setShelf] = useState<'history' | 'recipes'>('history')
  const [recipesSaved, setRecipesSaved] = useState(0)
  const [noteMenu, setNoteMenu] = useState(false)
  const [terms, setTerms] = useState<Term[]>([])
  const termsRef = useRef(terms)
  termsRef.current = terms
  const [view, setView] = useState<'notes' | 'terminal'>('notes')
  const [termId, setTermId] = useState<string | null>(null)
  const term = view === 'terminal' ? terms.find((t) => t.id === termId) : undefined
  // Tab strip: the mode from settings, ⌘⇧T flipping it, and the top-edge hover in auto mode.
  const [tabMode, setTabMode] = useState<TabMode>(() => readSettings().tabs ?? 'pinned')
  const [stripToggled, setStripToggled] = useState(false)
  const [stripHover, setStripHover] = useState(false)
  const [writing, setWriting] = useState(false)
  const [showThoughts, setShowThoughts] = useState(() => readSettings().showThoughts ?? false)
  const [motionSetting, setMotionSetting] = useState<MotionPref>(() => readSettings().motion ?? 'system')
  // A tab whose Claude is still working waits here for "stop and close?".
  const [confirmClose, setConfirmClose] = useState<string | null>(null)
  const { toast, show: showToast } = useToast()
  const showToastRef = useRef(showToast)
  showToastRef.current = showToast
  const composerRef = useRef<PublicInstance>(null)
  /** The note's list, for the timeline to scroll, and which of its rows are on screen. */
  const noteList = useRef<PublicInstance>(null)
  const visibleRows = useMemo(watchRows, [])
  const runners = useRef(new Map<string, AgentRunner>())
  /** The word-cut title a note got on its first send; the agent's own title replaces only that. */
  const provisional = useRef(new Map<string, string>())
  const profilesRef = useRef(profiles)
  profilesRef.current = profiles
  // Threads go through a ref first, so a send right after an edit sees the edit.
  const threadsRef = useRef(threads)
  const setThreads = useCallback((f: (prev: Thread[]) => Thread[]) => {
    threadsRef.current = f(threadsRef.current)
    setThreadsState(threadsRef.current)
  }, [])
  const activeRef = useRef(activeId)
  activeRef.current = activeId
  const notificationView = useRef({ noteId: activeId, visible: false })
  notificationView.current = { noteId: activeId, visible: view === 'notes' && overlay === null }

  const active = threads.find((t) => t.id === activeId)
  const [selectedProject, setSelectedProject] = useState(() => active?.workspace ?? readSettings().lastProject ?? profiles.flatMap((p) => p.workspaces)[0] ?? homedir())
  const project = active?.workspace ?? selectedProject
  const [projectMenu, setProjectMenu] = useState(false)
  const lastProjectNotes = useRef(readSettings().lastProjectNotes ?? {})
  const projectTabs = tabs.filter((id) => id === HELP_ID || threads.find((thread) => thread.id === id)?.workspace === project)
  useEffect(() => {
    setSelectedProject(project)
    if (active) lastProjectNotes.current[project] = active.id
    updateSettings({ lastProject: project, lastProjectNotes: { ...lastProjectNotes.current } })
  }, [project, active?.id])

  const annotationCaptures = useMemo(() => collectAnnotations(threads), [threads])
  const annotationOpenCount = annotationCaptures.filter(({ saved }) => captureOpen(saved)).reduce((sum, { saved }) => sum + saved.capture.elements.length, 0)
  const previewing = active ? previews[active.id] : undefined
  // The pane's sizes once dragged: the file side (unset follows the window) and the tree.
  const [paneSize, setPaneSize] = useState(() => ({ file: readSettings().previewWidth, tree: readSettings().fileTreeWidth ?? TREE_WIDTH }))
  const previewSize = previewLayout(workspaceWidth, fileTree ? paneSize.tree : 0, paneSize.file)
  // A drag on the pane's edge or the tree's: where it started, and the sizes then.
  const [resizing, setResizing] = useState<{ edge: 'pane' | 'tree' | 'mobile'; x: number; file: number; tree: number }>()
  // An edge's drag is the edge's: GPUIX would also run a text selection from the press into the
  // note, so each step drops it.
  const startResize = (edge: 'pane' | 'tree' | 'mobile', x: number, reset: boolean) => {
    renderer.clearSelection?.()
    if (edge === 'mobile') {
      if (reset) { setMobileSize(undefined); updateSettings({ mobileWidth: undefined }) }
      else setResizing({ edge, x, file: mobileWidth, tree: paneSize.tree })
      return
    }
    if (reset) {
      const next = edge === 'pane' ? { ...paneSize, file: undefined } : { ...paneSize, tree: TREE_WIDTH }
      setPaneSize(next)
      updateSettings({ previewWidth: next.file, fileTreeWidth: next.tree })
      return
    }
    setResizing({ edge, x, file: previewSize.width - (fileTree ? paneSize.tree + 12 : 0), tree: paneSize.tree })
  }
  const followResize = (e: EventPayload) => {
    if (!resizing) return
    renderer.clearSelection?.()
    if (e.pressedButton !== 0) return endResize()
    // The pane's edge is its left one, so a drag to the left widens it; the tree's is the tree's
    // right one, between it and the file, so a drag to the right widens the tree.
    const dx = (e.x ?? resizing.x) - resizing.x
    if (resizing.edge === 'mobile') setMobileSize(fitMobile(resizing.file - dx))
    else if (resizing.edge === 'pane') setPaneSize((p) => ({ ...p, file: fitFile(workspaceWidth, fileTree ? p.tree : 0, resizing.file - dx) }))
    else {
      // The edge between the tree and the file: one gives what the other takes.
      const tree = Math.round(Math.max(TREE_MIN, Math.min(TREE_MAX, resizing.tree + dx, resizing.tree + resizing.file - FILE_MIN)))
      setPaneSize({ tree, file: resizing.file - (tree - resizing.tree) })
    }
  }
  const endResize = () => {
    renderer.clearSelection?.()
    setResizing(undefined)
    updateSettings({ previewWidth: paneSize.file, fileTreeWidth: paneSize.tree, mobileWidth: mobileSize })
  }
  // The note's edits by file, from its folder, oldest first: the pane's "Show changes".
  const fileChanges = useMemo(() => {
    const byFile = new Map<string, Hunk[]>()
    if (!active) return byFile
    for (const group of collectChanges(active).reverse())
      for (const f of group.files) {
        const rel = path.relative(active.workspace, path.resolve(active.workspace, f.path))
        byFile.set(rel, [...(byFile.get(rel) ?? []), ...f.hunks])
      }
    return byFile
  }, [active?.blocks, active?.workspace])
  /**
   * Files on the strip and ⇧⌘E: opens the pane on the tree, or shows the tree in an open pane;
   * with the tree showing, hides it, and closes a pane that has no file open.
   */
  const toggleFiles = () => {
    if (!active) return
    if (!previewing) {
      const thread = active
      void defaultFile(thread).then((file) => {
        setPreviews((all) => ({ ...all, [thread.id]: { path: file } }))
        showTree(true)
      })
    } else if (!fileTree) showTree(true)
    else {
      showTree(false)
      if (!previewing.path) setPreviews(({ [active.id]: _, ...rest }) => rest)
    }
  }
  const activeProfile = profiles.find((p) => p.id === active?.profileId)
  // The note's agent decides which of Vellum's modes there are, and what they're called.
  const activeAgent = agentFor(activeProfile ?? {})
  const agentModeList = useMemo(() => agentModes(activeAgent), [activeAgent])
  const activityState = useRef({ workspace: active?.workspace, agents: [] as string[] })
  const activeWorkspace = overlay || term?.kind === 'login' ? undefined : term ? term.workspace ?? threads.find((thread) => thread.id === term.threadId)?.workspace : active?.workspace
  const agentProjects = [...new Set(threads.filter((thread) => thread.running && !asks[thread.id]?.length).map((thread) => thread.workspace))].sort()
  const agentProjectKey = agentProjects.join('\0')
  activityState.current = { workspace: activeWorkspace, agents: agentProjects }
  const sampleActivity = useCallback(() => {
    activity.sample({ ...activityState.current, foreground: process.env.GPUIX_BACKGROUND !== '1' && appIsActive(), enabled: readSettings().activityTracking !== false })
  }, [])
  useEffect(sampleActivity, [sampleActivity, activeWorkspace, agentProjectKey])
  useEffect(() => {
    let samples = 0
    const timer = setInterval(() => { sampleActivity(); if (++samples % 6 === 0) activity.flush() }, 5000)
    const finish = () => { sampleActivity(); activity.flush() }
    process.on('exit', finish)
    return () => { clearInterval(timer); process.off('exit', finish); finish() }
  }, [sampleActivity])
  // The folder's own uncommitted changes, so the strip offers Changes in a project with edits
  // nobody made in this note. Read again when the note's changes move and when Changes closes.
  const noteChanges = active ? changeSummary(active) : undefined
  const [uncommitted, setUncommitted] = useState<{ workspace: string; summary: ChangeSummary }>()
  const changesOpen = overlay === 'changes'
  useEffect(() => {
    const workspace = active?.workspace
    if (!workspace || changesOpen) return
    let cancelled = false
    uncommittedFiles(workspace)
      .then((files) => {
        if (cancelled || !files) return
        setUncommitted({ workspace, summary: { files: files.length, added: files.reduce((n, f) => n + f.added, 0), removed: files.reduce((n, f) => n + f.removed, 0) } })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [active?.workspace, noteChanges?.files, noteChanges?.added, noteChanges?.removed, changesOpen])
  const stripChanges = noteChanges?.files ? noteChanges : uncommitted && uncommitted.workspace === active?.workspace ? uncommitted.summary : undefined
  const draft = (active && drafts[active.id]) || { text: '', tags: [] }
  // Yours and the note's project's; read again when the panel opens or one is saved.
  const recipes = useLoaded(() => loadRecipes(active?.workspace), [active?.workspace, recipesSaved, overlay === 'history']) ?? NO_RECIPES
  // The note's folder is mapped in the background, so the file pane opens from memory.
  useEffect(() => {
    if (active?.workspace) void prepareTree(active.workspace)
  }, [active?.workspace])

  // Fonts: Inter for UI and prose, read before the first render. Text repaints once a family registers.
  useEffect(() => {
    for (const { file, bytes } of fontFaces) {
      try {
        renderer.registerFont?.(bytes)
      } catch (err) {
        console.error(`[vellum] font ${path.basename(file)}:`, err)
      }
    }
  }, [renderer])

  useEffect(() => {
    renderer.setWindowTitle?.(active ? `${active.title} — Vellum` : 'Vellum')
    if (activeId) updateSettings({ lastThreadId: activeId })
  }, [active?.title, activeId, renderer])

  useEffect(() => {
    updateSettings({ openTabs: tabs })
  }, [tabs])

  useEffect(() => {
    if (activeId) setUnread((u) => (u[activeId] ? { ...u, [activeId]: 0 } : u))
  }, [activeId])

  // Writing, sending or coming back to the composer while it's scrolled out of view brings the
  // note down to it, smoothly (ui/glide.ts). The slack is the 160px of room under the composer:
  // its last line stays clear of the status bar.
  const glide = useRef<(() => void) | null>(null)
  const revealComposer = useCallback(() => {
    const list = noteList.current?.id
    if (list == null || glide.current) return
    glide.current = revealEnd(renderer, list, 160, () => {
      glide.current = null
    })
  }, [renderer])

  const focusComposer = useCallback(() => {
    const id = composerRef.current?.id
    if (id != null) renderer.focusElement?.(id)
    revealComposer()
  }, [renderer, revealComposer])

  // ---- thread state

  const dispatch = useCallback((threadId: string, ev: unknown) => {
    setThreads((prev) => prev.map((t) => (t.id === threadId ? reduce(t, ev) : t)))
  }, [setThreads])

  const record = useCallback(
    (threadId: string, rec: VellumRecord) => {
      appendRecord(threadId, rec)
      dispatch(threadId, rec)
    },
    [dispatch],
  )

  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  useEffect(() => {
    let bridge: ReturnType<typeof startBridge> | undefined
    try {
      bridge = startBridge({
        notes: () => threadsRef.current.filter((thread) => tabsRef.current.includes(thread.id) && thread.id !== HELP_ID).map((thread) => ({ id: thread.id, title: thread.title, workspace: thread.workspace, account: profilesRef.current.find((profile) => profile.id === thread.profileId)?.name || thread.profileId, active: thread.id === activeRef.current })),
        record,
        parentTool: (noteId, name) => runners.current.get(noteId)?.toolParent(name),
        approveMcp: (noteId, ...request) => runners.current.get(noteId)?.approveMcp(...request) ?? Promise.resolve('deny'),
        deliver: (noteId, text, images, captureId) => {
          if ((queuesRef.current[noteId] ?? []).some((item) => item.captureId === captureId)) return
          setQueues((all) => ({ ...all, [noteId]: [...(all[noteId] ?? []), { id: captureId, text, tags: [], images, captureId }] }))
        },
      })
    } catch (error) { showToastRef.current(`Browser bridge: ${String((error as Error).message)}`) }
    const stop = () => { closeBrowserSessionsOnExit(); bridge?.stop() }
    process.on('exit', stop)
    return () => { process.off('exit', stop); void closeAllBrowsers(); bridge?.stop() }
  }, [record])
  useEffect(() => { recoverCaptureDeliveries() }, [tabs])

  useEffect(() => {
    const timer = setTimeout(() => {
      const kept = Object.fromEntries(Object.entries(drafts).filter(([, d]) => d.text || d.images?.length))
      writeJson(paths.drafts, kept)
    }, 300)
    return () => clearTimeout(timer)
  }, [drafts])

  useEffect(() => {
    const timer = setTimeout(() => writeJson(paths.queues, queues), 300)
    return () => clearTimeout(timer)
  }, [queues])

  // The .md copy is rewritten shortly after a thread changes.
  const saved = useRef(new Map<string, Thread>())
  useEffect(() => {
    const timer = setTimeout(() => {
      for (const t of threads) {
        if (saved.current.get(t.id) === t) continue
        saved.current.set(t.id, t)
        writeMarkdown(t).catch((err) => console.error('[vellum] markdown', err))
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [threads])

  const setLoggedIn = useCallback((profileId: string, loggedIn: boolean) => {
    if (profilesRef.current.find((p) => p.id === profileId)?.loggedIn === loggedIn) return
    setProfiles(updateProfile(profileId, { loggedIn }))
  }, [])

  const runnerFor = useCallback(
    (thread: Thread) => {
      let runner = runners.current.get(thread.id)
      if (runner) return runner
      const profile = profilesRef.current.find((p) => p.id === thread.profileId) ?? profilesRef.current[0]!
      runner = new AgentRunner(
        {
          threadId: thread.id,
          workspace: thread.workspace,
          profile,
          configDirs: profilesRef.current.map((p) => p.configDir),
          sessionId: thread.claudeSessionId,
          mode: thread.mode,
          think: thread.think,
          model: thread.modelPick,
        },
        {
          ask(a) {
            setAsks((all) => ({ ...all, [thread.id]: [...(all[thread.id] ?? []), a] }))
            const title = threadsRef.current.find((t) => t.id === thread.id)?.title ?? 'A note'
            const what = a.questions ? `${agentFor(profile).title} has a question` : `${agentFor(profile).title} needs your OK`
            notify('ask', title, a.questions?.[0]?.title || a.title || what, { noteId: thread.id, id: askNoticeId(thread.id, a.requestId), kind: a.questions ? 'question' : 'approval', agent: agentFor(profile).title })
          },
          askGone(requestId) {
            notificationInbox.settle(askNoticeId(thread.id, requestId))
            setAsks((all) => ({ ...all, [thread.id]: (all[thread.id] ?? []).filter((a) => a.requestId !== requestId) }))
          },
          modeChanged(mode) {
            record(thread.id, { type: 'vellum/mode', mode })
          },
          models(list) {
            setModels((all) => ({ ...all, [profile.id]: list }))
            cacheModels(profile.id, list)
          },
          efforts(list) {
            setEfforts((all) => ({ ...all, [profile.id]: list }))
          },
          notice(text) {
            showToastRef.current(text)
          },
          account(a) {
            const p = profilesRef.current.find((x) => x.id === profile.id)
            if (p && (p.email !== a.email || p.plan !== a.label || p.loggedIn !== true)) setProfiles(updateProfile(profile.id, { email: a.email, plan: a.label, loggedIn: true }))
          },
          line(raw, ev) {
            appendLine(thread.id, raw)
            dispatch(thread.id, ev)
            // The agent names the conversation; that replaces the word-cut title, never yours.
            if (ev.type === 'acp/update' && ev.update?.sessionUpdate === 'session_info_update' && typeof ev.update.title === 'string') {
              const cut = provisional.current.get(thread.id)
              if (cut && threadsRef.current.find((t) => t.id === thread.id)?.title === cut) {
                provisional.current.delete(thread.id)
                record(thread.id, { type: 'vellum/title', title: ev.update.title })
              }
            }
            if (ev.type === 'acp/end') {
              notificationInbox.settleNote(thread.id)
              const title = threadsRef.current.find((t) => t.id === thread.id)?.title ?? 'A note'
              if (activeRef.current !== thread.id) {
                setUnread((u) => ({ ...u, [thread.id]: (u[thread.id] ?? 0) + 1 }))
              }
              if (ev.stopReason !== 'cancelled') notify('done', title, `${agentFor(profile).title} replied`, { noteId: thread.id, agent: agentFor(profile).title })
            }
          },
          record(rec) {
            record(thread.id, rec)
            if (rec.type === 'vellum/stopped' || rec.type === 'vellum/error') notificationInbox.settleNote(thread.id)
            if (rec.type === 'vellum/error') notify('error', threadsRef.current.find((item) => item.id === thread.id)?.title ?? 'A note', rec.text, { noteId: thread.id, agent: agentFor(profile).title })
            // OpenCode authentication is per provider, rather than for the whole account.
            if (rec.type === 'vellum/error' && rec.login && agentFor(profile).id !== 'opencode') setLoggedIn(profile.id, false)
          },
        },
      )
      runners.current.set(thread.id, runner)
      return runner
    },
    [dispatch, record, setLoggedIn],
  )

  // ---- actions

  const terminalCols = Math.max(40, Math.floor((Math.min(Math.min(960, Math.max(720, windowSize.width * 0.66)), windowSize.width - shellInset * 2) - 56 - 22) / CELL_W))

  const runShell = useCallback(
    (thread: Thread, command: string) => {
      const termId = `sh-${Date.now().toString(36)}`
      record(thread.id, { type: 'vellum/shell', termId, command, at: new Date().toISOString() })
      const session = startTerm({
        id: termId,
        argv: shellArgv(command),
        cwd: thread.workspace,
        env: process.env,
        cols: terminalCols,
        rows: 20,
      })
      session.exited.then((exitCode) => {
        record(thread.id, { type: 'vellum/shell-exit', termId, exitCode, output: session.text(), grid: session.snapshot() })
      })
    },
    [record, terminalCols],
  )

  /** Text and tags; pasted images stay unless `images` is given. */
  const setDraft = useCallback((threadId: string, text: string, tags: Tag[], images?: string[]) => {
    setDrafts((d) => ({ ...d, [threadId]: { text, tags, images: images ?? d[threadId]?.images } }))
  }, [])
  const setDraftImages = useCallback((threadId: string, update: (images: string[]) => string[]) => {
    setDrafts((d) => {
      const cur = d[threadId] ?? { text: '', tags: [] }
      return { ...d, [threadId]: { ...cur, images: update(cur.images ?? []) } }
    })
  }, [])

  const draftsRef = useRef(drafts)
  draftsRef.current = drafts

  /** Lines picked in the file preview go on the end of the draft as a `#path:12-18` chip. */
  const mentionTag = useCallback((threadId: string, tag: Tag) => {
    const d = draftsRef.current[threadId] ?? { text: '', tags: [] }
    const tags = [...d.tags, tag]
    setDraft(threadId, relabel(d.text.trim() ? `${d.text.trimEnd()} ${tagText(tag)} ` : `${tagText(tag)} `, tags), tags)
    setTimeout(focusComposer, 50)
  }, [focusComposer, setDraft])

  /**
   * Moves a note to another account. Its agent lets go of the old session (that login keeps its
   * history); the next message starts a session on the new account, with the note as context.
   */
  const moveNote = useCallback(
    (thread: Thread, profileId: string) => {
      const to = profilesRef.current.find((p) => p.id === profileId)
      const from = profilesRef.current.find((p) => p.id === thread.profileId)
      if (!to || thread.running || profileId === thread.profileId) return
      void runners.current.get(thread.id)?.dispose()
      runners.current.delete(thread.id)
      setAsks((all) => ({ ...all, [thread.id]: [] }))
      record(thread.id, { type: 'vellum/profile', profileId, from: from?.name ?? thread.profileId, to: to.name, at: new Date().toISOString() })
      showToast(`Moved to ${to.name}; ${agentFor(to).title} picks up from the note`)
    },
    [record, showToast],
  )

  // Config that runs a folder's own code as the agent starts there (core/agents.ts
  // `projectConfig`), by agent and folder: looked up once a launch, off the frame.
  const [folderConfigs, setFolderConfigs] = useState<Record<string, string[]>>({})
  const folderConfigsRef = useRef(folderConfigs)
  const [trustedFolders, setTrustedFolders] = useState(() => readSettings().trustedFolders ?? [])
  const trustedRef = useRef(trustedFolders)
  const configKey = (thread: Thread) => `${agentFor(profilesRef.current.find((p) => p.id === thread.profileId) ?? {}).id}:${thread.workspace}`
  const loadFolderConfig = useCallback(async (thread: Thread) => {
    const key = configKey(thread)
    if (folderConfigsRef.current[key]) return
    const found = await folderConfig(thread.workspace, agentFor(profilesRef.current.find((p) => p.id === thread.profileId) ?? {}))
    folderConfigsRef.current = { ...folderConfigsRef.current, [key]: found }
    setFolderConfigs(folderConfigsRef.current)
  }, [])
  /**
   * What keeps this note from sending until you trust its folder: [] when nothing does, undefined
   * before the folder's been looked at. A folder an agent has already run in counts as trusted.
   */
  const untrustedConfig = (thread: Thread): string[] | undefined => {
    const config = folderConfigsRef.current[configKey(thread)]
    if (!config?.length) return config
    const folder = thread.workspace
    return trustedRef.current.includes(folder) || threadsRef.current.some((t) => t.workspace === folder && t.claudeSessionId) ? [] : config
  }
  const untrustedRef = useRef(untrustedConfig)
  untrustedRef.current = untrustedConfig
  // Read again whenever a folder's config lands or you trust one.
  const trustFiles = useMemo(() => (active ? untrustedConfig(active) : undefined), [active, folderConfigs, trustedFolders])

  /**
   * The send path the composer and the queue drain land on: a recipe expands first — its
   * mode and model apply — then edits sync, the note gets its provisional title, and the
   * prompt goes to the runner.
   */
  const deliver = useCallback(async (thread: Thread, text: string, tags: Tag[], images: string[], captureId?: string) => {
    // `$name …`: a recipe. Its prompt is what's sent to Claude and shown; its mode and model apply first.
    // Only a recipe waits on the disk; everything else goes out in the same tick.
    let body = text
    // A folder whose config runs its own code waits for your trust (the notice above the composer).
    if (untrustedRef.current(thread) === undefined) await loadFolderConfig(thread)
    if (untrustedRef.current(thread)?.length) return
    const call = body.startsWith('$') ? recipeCall(body, await loadRecipes(thread.workspace)) : undefined
    if (call) {
      thread = threadsRef.current.find((t) => t.id === thread.id) ?? thread
      const { recipe } = call
      if (recipe.mode && recipe.mode !== thread.mode) {
        record(thread.id, { type: 'vellum/mode', mode: recipe.mode })
        runnerFor(thread).setMode(recipe.mode)
      }
      if (recipe.model) {
        record(thread.id, { type: 'vellum/model', model: recipe.model })
        runnerFor(thread).setModel(recipe.model)
      }
      body = expandRecipe(recipe, { input: call.input, folder: thread.workspace, branch: gitBranch(thread.workspace) })
    }
    const edits = describeEdits(thread)
    // The first turn after a move to another account starts a session there: give it the note.
    const handoff = thread.handoff ? handoffContext(thread) : ''
    if (!body && !edits && !images.length) return
    if (termsRef.current.some((t) => t.kind === 'claude' && t.threadId === thread.id)) return
    const used = tagsIn(body, tags)
    record(thread.id, { type: 'vellum/user', text: body, tags: used, at: new Date().toISOString(), ...(images.length ? { images } : {}) })
    if (captureId) updateCapture(thread.id, captureId, { status: 'acknowledged', delivery: 'sent' })
    if (edits) record(thread.id, { type: 'vellum/synced' })
    if (body && !thread.blocks.some((b) => b.kind === 'user') && (thread.title === 'Untitled' || thread.title === 'New thread')) {
      const cut = titleFrom(body)
      record(thread.id, { type: 'vellum/title', title: cut })
      provisional.current.set(thread.id, cut)
    }
    const prompt = body ? promptFor(body, used, { workspace: thread.workspace, scopes: thread.tagScopes }) : ''
    runnerFor(thread).send([handoff, edits, prompt].filter(Boolean).join('\n\n'), images)
  }, [record, runnerFor])

  /**
   * A message into the turn Claude is running (core/agent.ts `steer`): it reads it as soon as it
   * can and answers it before the turn ends. It shows in the note where Claude took it in.
   * An agent that can't steer at all, or a recipe (which sets the mode and model as its turn
   * starts), has it sent now: first in line, and the turn stopped, so it goes out as its own turn
   * as soon as the stop lands. Otherwise (the turn not yet with the agent, or just over) it goes
   * to the front of the queue, so it's the next turn, or now if the turn has already ended here.
   */
  const sendNow = useCallback((threadId: string, item: QueuedMessage) => {
    setQueues((all) => ({ ...all, [threadId]: [item, ...(all[threadId] ?? []).filter((q) => q !== item)] }))
    runners.current.get(threadId)?.interrupt()
  }, [])
  const steerIn = useCallback(async (thread: Thread, item: QueuedMessage) => {
    const tags = item.tags ?? []
    const images = item.images ?? []
    const runner = runners.current.get(thread.id)
    const prompt = item.text ? promptFor(item.text, tags, { workspace: thread.workspace, scopes: thread.tagScopes }) : ''
    const outcome = runner && !item.text.startsWith('$') ? await runner.steer(prompt, images) : 'unavailable'
    if (outcome === 'injected') {
      record(thread.id, { type: 'vellum/user', text: item.text, tags, at: new Date().toISOString(), ...(images.length ? { images } : {}) })
      if (item.captureId) updateCapture(thread.id, item.captureId, { status: 'acknowledged', delivery: 'sent' })
      return
    }
    const now = threadsRef.current.find((t) => t.id === thread.id) ?? thread
    if (!now.running) deliver(now, item.text, tags, images, item.captureId)
    else if (!runner?.steers || item.text.startsWith('$')) sendNow(thread.id, item)
    else setQueues((all) => ({ ...all, [thread.id]: [item, ...(all[thread.id] ?? [])] }))
  }, [deliver, record, sendNow])

  /**
   * ⌘↵: send what was written at the end, plus any edits made to earlier text. While Claude
   * is thinking, the message parks in the note's queue instead, and it goes out, in order,
   * after the turn ends.
   */
  const send = useCallback((steer = false) => {
    const thread = threadsRef.current.find((t) => t.id === activeRef.current)
    if (!thread) return
    const d = draftsRef.current[thread.id] ?? { text: '', tags: [] }
    const text = d.text.trim()
    // `!` runs a shell command, decided only from what you typed: a recipe's prompt is never one.
    if (text.startsWith('!')) {
      const command = text.slice(1).trim()
      if (command) runShell(thread, command)
      setDraft(thread.id, '', [])
      return
    }
    if (!text && !describeEdits(thread) && !(d.images ?? []).length) return
    if (termsRef.current.some((t) => t.kind === 'claude' && t.threadId === thread.id)) return
    // Until you trust the folder, what you wrote stays put under the notice that says why.
    const untrusted = untrustedRef.current(thread)
    if (untrusted === undefined) { void loadFolderConfig(thread).then(() => sendRef.current(steer)); return }
    if (untrusted.length) return
    if (thread.running) {
      const item: QueuedMessage = { text, tags: tagsIn(text, d.tags), ...(d.images?.length ? { images: d.images } : {}) }
      setDraft(thread.id, '', [], [])
      // ⌥⌘↵ tells Claude now; ⌘↵ waits for the turn to end.
      if (steer) void steerIn(thread, item)
      else setQueues((all) => ({ ...all, [thread.id]: [...(all[thread.id] ?? []), item] }))
      return
    }
    deliver(thread, text, tagsIn(text, d.tags), d.images ?? [])
    setDraft(thread.id, '', [], [])
  }, [deliver, loadFolderConfig, runShell, setDraft, steerIn])
  const sendRef = useRef(send)
  sendRef.current = send

  /** Lets the folder's config run from now on, and sends what you'd written. */
  const trustFolder = useCallback((folder: string) => {
    trustedRef.current = [...new Set([...trustedRef.current, folder])]
    setTrustedFolders(trustedRef.current)
    updateSettings({ trustedFolders: trustedRef.current })
    sendRef.current()
    focusComposer()
  }, [focusComposer])
  useEffect(() => {
    if (active) void loadFolderConfig(active)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.workspace, active?.profileId, loadFolderConfig])

  // The queues drain one message per turn: running going false schedules the next, a beat
  // later, so the turn's git record has landed before the next prompt starts.
  const queueTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  useEffect(() => {
    for (const thread of threads) {
      if (!thread.running && drivingBrowserNoteId !== thread.id && queues[thread.id]?.length && tabs.includes(thread.id) && !terms.some((term) => term.kind === 'claude' && term.threadId === thread.id) && !queueTimers.current.has(thread.id)) {
        queueTimers.current.set(thread.id, setTimeout(() => {
          queueTimers.current.delete(thread.id)
          const item = queuesRef.current[thread.id]?.[0]
          if (!item) return
          const next = threadsRef.current.find((t) => t.id === thread.id)
          if (!next || next.running || drivingBrowserRef.current === thread.id || !tabsRef.current.includes(thread.id) || termsRef.current.some((term) => term.kind === 'claude' && term.threadId === thread.id)) return
          setQueues((all) => ({ ...all, [thread.id]: (all[thread.id] ?? []).slice(1) }))
          if (item.captureId) {
            const saved = readCapture(next.id, item.captureId)
            if (!saved || saved.delivery !== 'send' || saved.status === 'dismissed' || saved.status === 'resolved') {
              return
            }
          }
          deliver(next, item.text, item.tags ?? [], item.images ?? [], item.captureId)
        }, 300))
      }
    }
  }, [threads, queues, tabs, terms, deliver, drivingBrowserNoteId])
  useEffect(() => () => { for (const timer of queueTimers.current.values()) clearTimeout(timer) }, [])

  /** Opens a note in a tab. Past nine, the oldest tab Claude isn't working in makes room. */
  const openNote = useCallback((id: string) => {
    setTabs((t) => {
      if (t.includes(id)) return t
      // The Help note doesn't count toward the nine, and never makes room.
      const folder = threadsRef.current.find((thread) => thread.id === id)?.workspace
      const notes = t.filter((x) => x !== HELP_ID && threadsRef.current.find((thread) => thread.id === x)?.workspace === folder)
      if (notes.length < MAX_TABS) return [...t, id]
      const drop = notes.find((x) => !threadsRef.current.find((th) => th.id === x)?.running) ?? notes[0]!
      const title = threadsRef.current.find((th) => th.id === drop)?.title ?? 'a note'
      setTimeout(() => showToast(keys(`Closed “${title}” to keep nine tabs · ⌘Y has it`)), 0)
      return [...t.filter((x) => x !== drop), id]
    })
    setActiveId(id)
  }, [])

  useEffect(() => notificationInbox.configure(renderer, {
    visible: (id) => notificationView.current.visible && notificationView.current.noteId === id,
    open: (id) => {
      if (!threadsRef.current.some((thread) => thread.id === id)) { showToastRef.current('This note is no longer available.'); return }
      setView('notes')
      setOverlay(null)
      openNote(id)
    },
  }), [renderer, openNote])
  useEffect(() => { if (activeId && notificationView.current.visible) notificationInbox.seen(activeId) }, [activeId, overlay, view])

  const openAnnotation = (saved: SavedCapture) => {
    setView('notes')
    openNote(saved.noteId)
    setOverlay(null)
    setCaptureJump({ noteId: saved.noteId, id: saved.capture.id, nonce: performance.now() })
  }
  const queueAnnotation = (saved: SavedCapture) => {
    if (!updateCapture(saved.noteId, saved.capture.id, { status: 'queued', delivery: 'send' })) throw new Error('The capture bridge is unavailable')
    setQueues((all) => (all[saved.noteId] ?? []).some((item) => item.captureId === saved.capture.id) ? all : {
      ...all,
      [saved.noteId]: [...(all[saved.noteId] ?? []), { id: saved.capture.id, text: capturePrompt(saved.capture, path.join(captureDir(saved.noteId, saved.capture.id), 'capture.json')), tags: [], images: captureImages(saved), captureId: saved.capture.id }],
    })
    openAnnotation(saved)
  }
  const changeAnnotationStatus = (saved: SavedCapture, status: CaptureStatus) => {
    try {
      const closed = status === 'resolved' || status === 'dismissed'
      if (!updateCapture(saved.noteId, saved.capture.id, { status, delivery: undefined, ...(closed ? { summary: saved.summary || (status === 'resolved' ? 'Resolved manually.' : 'Dismissed manually.') } : { summary: undefined, reply: undefined }) })) throw new Error('The capture bridge is unavailable')
      setQueues((all) => ({ ...all, [saved.noteId]: (all[saved.noteId] ?? []).filter((item) => item.captureId !== saved.capture.id) }))
    } catch (error) { showToast(String((error as Error).message)) }
  }
  const sendAnnotationToNote = async (saved: SavedCapture, noteId: string) => {
    const destination = threadsRef.current.find((thread) => thread.id === noteId)
    if (!destination) throw new Error('The destination note is no longer available')
    const copied = await copyCapture(saved, noteId)
    record(noteId, { type: 'vellum/capture', ...copied, at: new Date().toISOString() })
    if (!updateCapture(saved.noteId, saved.capture.id, { status: 'dismissed', delivery: undefined, summary: `Sent to “${destination.title}”.` })) throw new Error('The capture bridge is unavailable')
    setQueues((all) => ({ ...all, [saved.noteId]: (all[saved.noteId] ?? []).filter((item) => item.captureId !== saved.capture.id) }))
    queueAnnotation(copied)
  }

  const closeTabNow = useCallback(
    (id: string) => {
      void closeBrowser(id).catch(error => showToastRef.current(String(error.message)))
      const i = tabs.indexOf(id)
      const next = tabs.filter((x) => x !== id)
      // Its agent ends with the tab (and lets go of the session); the next message starts it again.
      void runners.current.get(id)?.dispose()
      runners.current.delete(id)
      setTabs(next)
      if (id === activeId) {
        const local = next.filter((tab) => tab === HELP_ID || threadsRef.current.find((thread) => thread.id === tab)?.workspace === project)
        setActiveId(local[Math.min(Math.max(i, 0), local.length - 1)])
      }
    },
    [tabs, activeId, project],
  )

  /** A note to the trash (Settings › Trash keeps it 30 days): its tab closes and its agent ends. */
  const deleteNote = useCallback(
    (id: string) => {
      const thread = threadsRef.current.find((t) => t.id === id)
      if (!thread) return
      if (tabs.includes(id)) closeTabNow(id)
      void runners.current.get(id)?.dispose()
      runners.current.delete(id)
      if (!trashNote(thread)) return showToast(`Couldn’t move “${thread.title}” to Trash`, 'danger')
      setThreads((prev) => prev.filter((t) => t.id !== id))
      showToast(`Moved “${thread.title}” to Trash`)
    },
    [tabs, closeTabNow, setThreads, showToast],
  )

  /** Closing a tab ends its agent; mid-turn, it asks first. */
  const closeTab = useCallback(
    (id: string) => {
      if (threadsRef.current.find((t) => t.id === id)?.running) setConfirmClose(id)
      else closeTabNow(id)
    },
    [closeTabNow],
  )

  const interrupt = useCallback(() => {
    if (active) runners.current.get(active.id)?.interrupt()
  }, [active])

  /** What you started writing in the Help note, on its way to the note it starts… */
  const fromHelp = useRef('')
  /** The note started from Help, for keys that still land there before focus moves. */
  const helpNote = useRef<string | undefined>(undefined)
  const createThread = useCallback(
    (profileId: string, folder: string, text?: string, tags: Tag[] = []) => {
      const meta = { id: newThreadId(), title: 'Untitled', profileId, workspace: folder, createdAt: new Date().toISOString() }
      appendRecord(meta.id, { type: 'vellum/meta', meta })
      // Settings › New notes: the mode and effort a note starts with.
      const thread = newThread(meta)
      const { newNoteMode, newNoteThink } = readSettings()
      if (newNoteMode) appendRecord(meta.id, { type: 'vellum/mode', mode: (thread.mode = newNoteMode) })
      if (newNoteThink) appendRecord(meta.id, { type: 'vellum/think', think: (thread.think = newNoteThink) })
      setThreads((prev) => [thread, ...prev])
      setProfiles(rememberWorkspace(profileId, folder))
      openNote(meta.id)
      const initialText = text ?? fromHelp.current
      if (initialText) setDraft(meta.id, initialText, tags)
      fromHelp.current = ''
      setOverlay(null)
      setTimeout(focusComposer, 50)
      return meta.id
    },
    [focusComposer, openNote, setDraft, setThreads],
  )

  const startNewNote = useCallback((folder = project) => {
    const current = threadsRef.current.find((thread) => thread.id === activeRef.current)
    const list = profilesRef.current
    const profileId = list.find((profile) => profile.id === readSettings().newNoteProfile)?.id
      ?? (current?.workspace === folder ? current.profileId : profileForWorkspace(list, folder)?.id) ?? list[0]?.id
    if (!profileId) { openSettings('Accounts'); return }
    setView('notes')
    createThread(profileId, folder)
  }, [createThread, openSettings, project])

  const selectProject = (folder: string) => {
    setProjectMenu(false)
    setNoteMenu(false)
    setSelectedProject(folder)
    setOverlay(null)
    setView('notes')
    const last = lastProjectNotes.current[folder]
    const note = threadsRef.current.find((thread) => thread.id === last && thread.workspace === folder)
      ?? threadsRef.current.find((thread) => thread.workspace === folder)
    if (note) { openNote(note.id); setTimeout(focusComposer, 32) }
    else startNewNote(folder)
  }
  const browseProject = async () => {
    setProjectMenu(false)
    try {
      const folders = await renderer.promptForPaths?.({ directories: true, files: false, multiple: false, prompt: 'Open project' })
      if (folders?.[0]) selectProject(folders[0])
    } catch (error) { showToast(`Couldn’t open folder: ${String((error as Error).message)}`) }
  }
  // Existing entry points (Help, onboarding and At launch) also land on a fresh page.
  useEffect(() => {
    if (overlay === 'new' && !onboarding) startNewNote()
  }, [overlay, onboarding, startNewNote])

  // ---- terminals: their own view, one tab each

  const termSeq = useRef(0)
  /** A terminal gets its tab; `show` switches to it (a terminal kept from last time doesn't). */
  const addTerm = useCallback((t: Omit<Term, 'id'>, show = true) => {
    const id = `term-${++termSeq.current}`
    setTerms((all) => [...all, { ...t, id }])
    if (show) {
      setTermId(id)
      setView('terminal')
    } else setTermId((cur) => cur ?? id)
    return id
  }, [])
  /** A terminal is gone (it exited or was closed): show another, or go back to the notes. */
  const dropTerm = useCallback(
    (id: string) => {
      const rest = termsRef.current.filter((t) => t.id !== id)
      setTerms(rest)
      setTermId((cur) => {
        if (cur !== id) return cur
        const next = rest[rest.length - 1]
        if (!next) {
          setView('notes')
          setTimeout(focusComposer, 50)
        }
        return next?.id ?? null
      })
    },
    [focusComposer],
  )
  // openLogin is declared before these; it reaches them through refs.
  const addTermRef = useRef(addTerm)
  addTermRef.current = addTerm
  const dropTermRef = useRef(dropTerm)
  dropTermRef.current = dropTerm
  const closeTerm = useCallback(
    (id: string) => {
      termsRef.current.find((t) => t.id === id)?.session.kill()
      dropTerm(id)
    },
    [dropTerm],
  )
  /**
   * A shell or Claude Code: the terminal holder keeps it, so it outlives a quit or a
   * reload. A shell gets further — its tmux session — so the ✕ on its tab is the only
   * thing that ends it, and it comes back with its output at the next launch.
   */
  const keepTerm = useCallback(
    async (t: Omit<Term, 'id' | 'session'>, run: { argv: string[]; cwd: string; env: Record<string, string | undefined> }) => {
      const metadata = { ...t, workspace: run.cwd }
      if (t.kind === 'shell') {
        const { session } = await tmuxShell({ ...run, cols: 100, rows: 30 }, metadata)
        const id = addTerm({ ...metadata, session })
        session.exited.then(() => dropTerm(id))
        return
      }
      const session = await holdTerm({ ...run, cols: 100, rows: 30 }, metadata)
      const id = addTerm({ ...metadata, session })
      session.exited.then(() => dropTerm(id))
    },
    [addTerm, dropTerm],
  )
  // A shell starts at home: the tree it works in is the one you end up in.
  const newShell = useCallback(() => {
    const shell = process.env.SHELL || '/bin/zsh'
    void keepTerm({ kind: 'shell', title: `${path.basename(shell)} · ~`, label: `${path.basename(shell)} · ~` }, { argv: [shell, '-l'], cwd: homedir(), env: process.env })
  }, [keepTerm])
  // The terminals kept from last time come back as tabs, without taking you away from your note.
  const restoredTerms = useRef(false)
  useEffect(() => {
    if (restoredTerms.current) return
    restoredTerms.current = true
    void heldTerms().then((held) => {
      // Their tmux names are here (an attach the holder kept), so the file-restore
      // below doesn't open them twice.
      const skip = new Set<string>()
      for (const { meta, session, cwd } of held) {
        const t = meta as Omit<Term, 'id' | 'session'>
        if (!t || !['shell', 'claude'].includes(t.kind)) continue
        if (t.tmux) skip.add(t.tmux)
        const id = addTerm({ ...t, workspace: cwd, session }, false)
        session.exited.then(() => dropTerm(id))
      }
      void restoreTmuxTerms(skip).then((restored) => {
        for (const { meta, session } of restored) {
          const t = meta as Omit<Term, 'id' | 'session'>
          if (!t || !['shell'].includes(t.kind)) continue
          const id = addTerm({ ...t, session }, false)
          session.exited.then(() => dropTerm(id))
        }
      })
    })
  }, [addTerm, dropTerm])
  const showNotes = useCallback(() => {
    setView('notes')
    setTimeout(focusComposer, 50)
  }, [focusComposer])
  const showTerminal = useCallback(() => {
    if (!termsRef.current.length) return hasPty ? newShell() : undefined
    setView('terminal')
    setTermId((cur) => cur ?? termsRef.current[termsRef.current.length - 1]!.id)
  }, [newShell])

  const [authRefreshing, setAuthRefreshing] = useState<Set<string>>(new Set())
  const authChecks = useRef(new Map<string, Promise<AccountStatus | undefined>>())
  const authCheckedAt = useRef(new Map<string, number>())
  /** Ask who an account is (no model turn), sharing overlapping checks. */
  const refreshAccount = useCallback((profileId: string, given?: Profile): Promise<AccountStatus | undefined> => {
    const pending = authChecks.current.get(profileId)
    if (pending) return pending
    const profile = given ?? profilesRef.current.find((p) => p.id === profileId)
    if (!profile) return Promise.resolve(undefined)
    setAuthRefreshing((all) => new Set(all).add(profileId))
    const task = (async () => {
      const s = await accountStatus(profile)
      if (!s) return
      const p = profilesRef.current.find((x) => x.id === profileId) ?? given
      // A logged-out account keeps its identity for the next login; unknown clears stale labels.
      const email = s.loggedIn === undefined ? undefined : s.loggedIn ? s.email : (s.email ?? p?.email)
      const plan = s.loggedIn === undefined ? undefined : s.loggedIn ? s.plan : p?.plan
      if (p && (p.loggedIn !== s.loggedIn || p.email !== email || p.plan !== plan)) setProfiles(updateProfile(profileId, { loggedIn: s.loggedIn, email, plan }))
      return s
    })().finally(() => {
      authChecks.current.delete(profileId)
      authCheckedAt.current.set(profileId, Date.now())
      setAuthRefreshing((all) => { const next = new Set(all); next.delete(profileId); return next })
    })
    authChecks.current.set(profileId, task)
    return task
  }, [])

  const [authBusy, setAuthBusy] = useState<Set<string>>(new Set())
  const authBusyRef = useRef(authBusy)
  authBusyRef.current = authBusy
  const busy = (id: string, on: boolean) =>
    setAuthBusy((b) => {
      const next = new Set(b)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  /** Log an account in with the agent's own login method, in a terminal you can see. */
  const openLogin = useCallback(
    async (profileId: string) => {
      const profile = profilesRef.current.find((p) => p.id === profileId)
      if (!profile) return
      busy(profileId, true)
      const methods = await loginMethods(profile)
      const { argv, env, label } = loginCommand(profile, methods[0]!)
      setOverlay(null)
      const done = async () => {
        const s = await refreshAccount(profileId)
        busy(profileId, false)
        const twin = s?.loggedIn && s.email ? sameLogin(profilesRef.current, profileId, s.email) : undefined
        if (twin) showToastRef.current(`${profile.name} logged in as the same account as ${twin.name}. Sign out of ${agentFor(profile).id === 'claude' ? 'claude.ai' : 'that account'} in your browser, then log in again.`)
        else if (s?.loggedIn) showToastRef.current(`${profile.name} is logged in${s.email ? ` as ${s.email}` : ''}`, 'success')
        // An agent that can't be asked who's in (OpenCode): the sign-in ran; that's all there is to say.
        else if (s?.loggedIn === undefined) showToastRef.current(`${profile.name}: sign-in finished`)
        else showToastRef.current(`${profile.name} is still not logged in`)
        return s?.loggedIn
      }
      if (!hasPty) {
        // No PTY on Windows: the login runs in a console window of its own; watch for it to land.
        openConsole(argv, homedir(), env)
        showToastRef.current(`Finish logging in to ${profile.name} in the new window`)
        const started = Date.now()
        const poll = async () => {
          const s = await accountStatus(profile)
          if (s?.loggedIn) return done()
          if (Date.now() - started < 10 * 60_000) setTimeout(poll, 3000)
          else busy(profileId, false)
        }
        setTimeout(poll, 3000)
        return
      }
      const session = startTerm({ argv, cwd: homedir(), env, cols: 100, rows: 30 })
      const id = addTermRef.current({ kind: 'login', title: `Log in · ${profile.name}`, label, hint: 'Finish in your browser · this closes by itself', session })
      session.exited.then(async () => {
        dropTermRef.current(id)
        await done()
      })
    },
    [refreshAccount],
  )

  const logOut = useCallback(
    async (profileId: string) => {
      const profile = profilesRef.current.find((p) => p.id === profileId)
      if (!profile) return
      busy(profileId, true)
      // Notes on this account stop their agents first; the next message would fail anyway.
      for (const t of threadsRef.current) if (t.profileId === profileId) {
        await runners.current.get(t.id)?.dispose()
        runners.current.delete(t.id)
      }
      const ok = await logout(profile)
      await refreshAccount(profileId)
      busy(profileId, false)
      showToastRef.current(ok ? `${profile.name} is logged out` : `Couldn't log ${profile.name} out`)
    },
    [refreshAccount],
  )

  /** A new account: made, then asked who it is (nobody yet, unless its folder already had a login). */
  const addAccount = useCallback(
    (name: string, agent: AgentId = 'claude') => {
      const list = createProfile(name, agent)
      setProfiles(list)
      const added = list[list.length - 1]!
      void refreshAccount(added.id, added)
    },
    [refreshAccount],
  )

  // Once at launch: every account's links to ~/.claude, then who each one is (about 200 ms each,
  // no model turn).
  useEffect(() => {
    const merged: string[] = []
    for (const p of profilesRef.current) {
      if (!p.configDir) continue
      try {
        const fixed = linkAccount(p.id, p.configDir).filter((a) => a.did !== 'linked')
        if (fixed.length) merged.push(`${p.name} (${fixed.map((a) => a.name).join(', ')})`)
      } catch (e) {
        showToastRef.current(`Couldn't link ${p.name} to ~/.claude: ${String((e as Error)?.message ?? e)}`)
      }
    }
    if (merged.length) showToastRef.current(`Linked to ~/.claude: ${merged.join('; ')}. Old copies are in ~/.vellum/backups.`)
    void (async () => {
      for (const p of profilesRef.current) await refreshAccount(p.id)
    })()
  }, [refreshAccount])

  // One quiet sweep per minute, checking each agent only when its own cadence is due.
  // A sleep/wake simply makes the next sweep due; no timers try to keep tokens alive.
  useEffect(() => {
    const timer = setInterval(() => {
      void (async () => {
        for (const profile of profilesRef.current) {
          if (authBusyRef.current.has(profile.id)) continue
          if (Date.now() - (authCheckedAt.current.get(profile.id) ?? 0) >= accountRefreshInterval(profile)) await refreshAccount(profile.id)
        }
      })()
    }, 60_000)
    return () => clearInterval(timer)
  }, [refreshAccount])

  const openClaude = useCallback(() => {
    if (!active?.claudeSessionId) return
    const profile = profilesRef.current.find((p) => p.id === active.profileId)
    if (!profile) return
    // One writer per session: the note's agent ends (and lets go of the session) before claude opens it.
    void runners.current.get(active.id)?.dispose()
    runners.current.delete(active.id)
    if (!hasPty) {
      openConsole([claudeBin(), '--resume', active.claudeSessionId], active.workspace, profileEnv(profile))
      showToastRef.current('Opened in a Claude Code window')
      return
    }
    void keepTerm(
      { kind: 'claude', threadId: active.id, title: `Claude Code · ${active.title}`, label: `claude --resume ${active.claudeSessionId.slice(0, 8)}…`, hint: 'Quit claude to come back' },
      { argv: [claudeBin(), '--resume', active.claudeSessionId], cwd: active.workspace, env: profileEnv(profile) },
    )
  }, [active, keepTerm])

  const toggleMaterial = useCallback(() => {
    setMaterialName((n) => {
      const next = materialNames[(materialNames.indexOf(n) + 1) % materialNames.length]!
      updateSettings({ material: next })
      return next
    })
  }, [])

  // ---- approvals, mode, thinking

  const pendingAsks = (active && asks[active.id]) || []
  /** When each ask's card first showed, so a reflexive ↵ can't approve what you haven't read. */
  const askSeenAt = useRef(new Map<string, number>())
  if (!term && pendingAsks[0] && !askSeenAt.current.has(pendingAsks[0].requestId)) askSeenAt.current.set(pendingAsks[0].requestId, Date.now())
  const answer = useCallback(
    (key: 'allow' | 'always' | 'deny', message?: string) => {
      const thread = threadsRef.current.find((t) => t.id === activeRef.current)
      const a = thread && asks[thread.id]?.[0]
      if (!thread || !a || a.questions) return
      if (key === 'deny' && message === undefined) return setDenying(true)
      const always = key === 'always' && Boolean(a.suggestions)
      runners.current.get(thread.id)?.answer(a.requestId, key === 'deny' ? { allow: false, message } : { allow: true, always })
      notificationInbox.settle(askNoticeId(thread.id, a.requestId))
      const decision = key === 'deny' ? 'denied' : always ? 'always' : 'allowed'
      record(thread.id, { type: 'vellum/answer', tool: a.tool, title: a.title, detail: a.detail, decision, message: message?.trim() || undefined, at: new Date().toISOString() })
      setAsks((all) => ({ ...all, [thread.id]: (all[thread.id] ?? []).filter((x) => x.requestId !== a.requestId) }))
      setDenying(false)
      setTimeout(focusComposer, 30)
    },
    [asks, focusComposer, record],
  )
  useEffect(() => setDenying(false), [activeId])
  const answerQuestions = (content: QuestionContent | null) => {
    const thread = threadsRef.current.find((item) => item.id === activeRef.current)
    const ask = thread && asks[thread.id]?.[0]
    if (!thread || !ask?.questions) return
    runners.current.get(thread.id)?.answerQuestions(ask.requestId, content)
    notificationInbox.settle(askNoticeId(thread.id, ask.requestId))
    record(thread.id, { type: 'vellum/answer', tool: ask.tool, title: ask.title, detail: content ? JSON.stringify(content, null, 2) : 'Cancelled', decision: content ? 'allowed' : 'denied', at: new Date().toISOString() })
    setAsks((all) => ({ ...all, [thread.id]: (all[thread.id] ?? []).filter((item) => item.requestId !== ask.requestId) }))
    setTimeout(focusComposer, 30)
  }

  const setMode = useCallback(
    (mode: PermissionMode) => {
      if (!active) return
      record(active.id, { type: 'vellum/mode', mode })
      runners.current.get(active.id)?.setMode(mode)
      if (mode === 'bypassPermissions') showToast('Full access: nothing will ask before it runs')
    },
    [active, record, showToast],
  )
  const setThink = useCallback(
    (think: Think) => {
      if (!active) return
      record(active.id, { type: 'vellum/think', think })
      runners.current.get(active.id)?.setThink(think)
    },
    [active, record],
  )
  const setModel = useCallback(
    (model: string | undefined) => {
      if (!active) return
      record(active.id, { type: 'vellum/model', model })
      runners.current.get(active.id)?.setModel(model)
    },
    [active, record],
  )
  /** /compact as a turn of its own: no paragraph of yours, just the fold line when it lands. */
  const compact = useCallback(() => {
    const thread = threadsRef.current.find((t) => t.id === activeRef.current)
    if (!thread || thread.running || !thread.claudeSessionId) return
    record(thread.id, { type: 'vellum/compact', at: new Date().toISOString() })
    runnerFor(thread).send('/compact')
  }, [record, runnerFor])

  const tokenCtx = useMemo(
    () => ({
      workspace: active?.workspace ?? homedir(),
      onOpen: (file: string, line?: number, endLine?: number) => active && togglePreview(active.id, { path: file, line, endLine }),
    }),
    [active?.id, active?.workspace, togglePreview],
  )

  const me = useMemo(() => identityFor(activeProfile, machine), [activeProfile?.avatarImage, machine])
  const actions: BlockActions = useMemo(
    () => ({
      showThoughts,
      onViewCapture: setCaptureViewing,
      onViewBrowser: setBrowserViewing,
      tokens: tokenCtx,
      me,
      onEdit: (blockId, text) => active && record(active.id, { type: 'vellum/edit', blockId, text }),
      onSend: () => sendRef.current(),
      onLogin: () => active && openLogin(active.profileId),
      onSendOutput: (command, output) => {
        if (!active) return
        const d = draftsRef.current[active.id]
        setDraft(active.id, `${d?.text ? d.text + '\n\n' : ''}Output of \`${command}\`:\n\n\`\`\`\n${output}\n\`\`\`\n\n`, d?.tags ?? [])
        setTimeout(focusComposer, 30)
      },
      onReturnFocus: focusComposer,
      onViewImage: (images, index) => setViewing({ images, index }),
    }),
    [active?.id, active?.profileId, focusComposer, me, openLogin, record, setDraft, tokenCtx, showThoughts],
  )

  // ---- shortcuts

  const cycleTab = (step: number) => {
    const i = activeId ? projectTabs.indexOf(activeId) : -1
    if (projectTabs.length) setActiveId(projectTabs[(i + step + projectTabs.length) % projectTabs.length])
  }

  shortcuts.current = (e: KeyEvent) => {
    const mods = e.modifiers
    const key = (e.key ?? '').toLowerCase()
    // A list or field that handled the key already (⌃N in a picker is also Ctrl+N, new note, off macOS).
    if (e.defaultPrevented) return
    if (onboarding && view !== 'terminal') return
    // ⌃⇥ ⌃⇧⇥ step through the tabs, as in a browser (and Ctrl+PgUp/PgDn off macOS).
    const step = tabStep(key, mods)
    if (step) {
      e.preventDefault()
      cycleTab(step)
      return
    }
    if (!mods || !primary(mods)) return
    if ((key === 'n' || key === 't') && !mods.shift) {
      e.preventDefault()
      startNewNote()
    } else if (key === 'o') {
      e.preventDefault()
      void browseProject()
    } else if (key === 'w' && mods.shift) {
      // Plain ⌘W is GPUIX's native Close Window (it quits a one-window app) and never reaches us.
      e.preventDefault()
      if (view === 'terminal' && termId) closeTerm(termId)
      else if (activeId) closeTab(activeId)
    } else if (/^[1-9]$/.test(key)) {
      e.preventDefault()
      const id = key === '9' ? projectTabs[projectTabs.length - 1] : projectTabs[Number(key) - 1]
      if (id) setActiveId(id)
    } else if (mods.shift && (key === '[' || key === ']' || key === '{' || key === '}' || key === 'bracketleft' || key === 'bracketright')) {
      e.preventDefault()
      cycleTab(key === '[' || key === '{' || key === 'bracketleft' ? -1 : 1)
    } else if (key === 'k') {
      e.preventDefault()
      setOverlay((o) => (o === 'history' && shelf === 'history' ? null : 'history'))
      setShelf('history')
    } else if (key === 'y') {
      // ⌘Y past notes, ⇧⌘Y recipes; the same keys close the panel on that side.
      e.preventDefault()
      const side = mods.shift ? 'recipes' : 'history'
      setOverlay((o) => (o === 'history' && shelf === side ? null : 'history'))
      setShelf(side)
    } else if (key === 'd' && mods.shift) {
      e.preventDefault()
      setOverlay((o) => (o === 'changes' ? null : 'changes'))
    } else if (key === 'e' && mods.shift) {
      e.preventDefault()
      toggleFiles()
    } else if (key === 'm' && mods.shift && mobileSupported) {
      e.preventDefault()
      toggleMobile()
    } else if (key === '.') {
      e.preventDefault()
      interrupt()
    } else if (key === ',' || key === 'comma') {
      e.preventDefault()
      setSettingsPage('Vellum')
      setOverlay((o) => (o === 'settings' ? null : 'settings'))
    } else if (key === 't' && mods.shift) {
      e.preventDefault()
      setStripToggled((v) => !v)
      setStripHover(false)
    } else if (key === 'l' && mods.shift) {
      e.preventDefault()
      toggleMaterial()
    } else if (key === 'escape') {
      e.preventDefault()
      focusComposer()
    }
  }

  // ---- quit: no orphaned claude or shell processes

  useEffect(() => {
    const cleanup = () => {
      killAllAgents()
      mcp.close()
      killAllTerms()
    }
    process.on('exit', cleanup)
    return () => {
      process.off('exit', cleanup)
    }
  }, [])

  const recentFolders = useMemo(() => {
    const seen = new Set<string>()
    for (const t of threads) seen.add(t.workspace)
    for (const p of profiles) for (const w of p.workspaces) seen.add(w)
    return [...seen]
  }, [threads, profiles])

  // ---- the Help note (core/help.ts): a tab of its own, from the strip's Help button

  const openHelp = useCallback(() => {
    setTabs((t) => (t.includes(HELP_ID) ? t : [...t, HELP_ID]))
    setActiveId(HELP_ID)
    setView('notes')
    setOverlay(null)
  }, [])
  // It opens by itself once: the first launch, before there are notes.
  useEffect(() => {
    if (!onboarding && activeId === HELP_ID && !readSettings().helpShown) updateSettings({ helpShown: true })
  }, [activeId, onboarding])
  /** Nothing in Help can be changed: writing in it starts a note, in the latest folder, with what you wrote. */
  const writeFromHelp = useCallback(
    (text: string, first: boolean) => {
      if (!first) {
        if (helpNote.current) setDraft(helpNote.current, text, [])
        else fromHelp.current = text
        return
      }
      helpNote.current = undefined
      fromHelp.current = text
      const folder = project
      const profileId = folder ? (profileForWorkspace(profiles, folder)?.id ?? profiles.find((p) => p.id === readSettings().newNoteProfile)?.id ?? profiles[0]?.id) : undefined
      if (folder && profileId) helpNote.current = createThread(profileId, folder)
      else setOverlay('new')
    },
    [createThread, profiles, project, setDraft],
  )

  const typing = writing && Boolean(draft.text.trim())
  const stripVisible = confirmClose !== null || (tabMode === 'pinned' ? !stripToggled : tabMode === 'auto' ? stripToggled || stripHover || !typing : stripToggled)
  const m = material
  const paneRadius = concentric(windowRadius, shellInset)
  const tabThreads = projectTabs.map((id) => threads.find((t) => t.id === id)).filter((t): t is Thread => Boolean(t))
  const editsWaiting = active ? pendingEdits(active).length > 0 : false
  const currentCapture = captureViewing ? threads.flatMap((thread) => thread.blocks).find((block): block is Extract<Block, { kind: 'capture' }> => block.kind === 'capture' && block.saved.capture.id === captureViewing.capture.id && block.saved.noteId === captureViewing.noteId)?.saved ?? captureViewing : undefined
  const activeBrowserSession = activeId && liveBrowser ? getBrowserSession(activeId) : undefined
  const activeBrowser = activeBrowserSession?.generation && validateBrowser(activeBrowserSession as import('./core/browser-types').BrowserKey) ? activeBrowserSession : undefined
  const currentBrowser = browserViewing ? threads.flatMap((thread) => thread.blocks).find((block): block is Extract<Block, { kind: 'browser' }> => block.kind === 'browser' && block.browser.noteId === browserViewing.noteId && block.browser.session === browserViewing.session && block.browser.generation === browserViewing.generation)?.browser ?? browserViewing : undefined
  const placeholder = !active?.blocks.length
    ? 'What would you like to work on?'
    : editsWaiting
      ? keys(`⌘↵ tells ${activeAgent.title} about your edits`)
      : 'Keep writing…'

  return (
    <MaterialContext.Provider value={material}>
    <AgentContext.Provider value={activeAgent}>
      <div
        onMouseDown={() => activity.touch()}
        onMouseMove={() => activity.touch()}
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          padding: shellInset,
          backgroundColor: m.rootTint,
          fontFamily: font.sans,
          color: m.text,
          selectionColor: m.selection,
        }}
      >
        <div style={{ flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
          {/* The tab strip sits on the window frame, above the page. It folds to 0 when away, and the
              page keeps its rounded top, inset from the frame, as in Arc. */}
          <motion.div
            initial={false}
            animate={{ height: stripVisible ? stripHeight : 0 }}
            transition={tween({ duration: duration.fast, ease: ease.enter })}
            onMouseLeave={() => setStripHover(false)}
            style={{ minHeight: 0, flexShrink: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
          >
            <TabStrip
              tabs={projectTabs.flatMap((id): StripTab[] =>
                id === HELP_ID
                  ? [{ id, title: 'Help', time: '', running: false, unread: false, needsYou: false, dot: m.textFaint, plain: true }]
                  : tabThreads.filter((t) => t.id === id).map((t) => ({
                    id: t.id,
                    title: t.title,
                    time: clock(t.updatedAt),
                    running: t.running,
                    unread: (unread[t.id] ?? 0) > 0,
                    needsYou: (asks[t.id]?.length ?? 0) > 0,
                    attention: asks[t.id]?.[0]?.title,
                    dot: accentFor(m, profiles, t.profileId),
                  })),
              )}
              activeId={activeId}
              confirmation={confirmClose ? {
                tabId: confirmClose,
                onDismiss: () => { setConfirmClose(null); setTimeout(focusComposer, 32) },
                content: <ConfirmMorph key={confirmClose} label="Close tab" prompt="Stop Claude and close?" confirmLabel="Stop and close" defaultState="confirming" autoFocus testId="confirm-close"
                  onCancel={() => { setConfirmClose(null); setTimeout(focusComposer, 32) }}
                  onConfirm={() => {
                    const id = confirmClose
                    setConfirmClose(null)
                    runners.current.get(id)?.interrupt()
                    closeTabNow(id)
                    setTimeout(focusComposer, 32)
                  }}
                />,
              } : undefined}
              leading={
                <>
                  <ProjectPicker workspace={project} recent={recentFolders} open={projectMenu} onOpenChange={setProjectMenu} onPick={selectProject} onBrowse={() => { void browseProject() }} />
                  <Button onPress={() => setOverlay((current) => current === 'history' ? null : 'history')} selected={overlay === 'history'} testId="open-history" title={keys('Library · search notes (⌘K) · recipes (⇧⌘Y)')}>
                    <Icon name="library" size={15} />
                  </Button>
                  <Button onPress={openHelp} testId="open-help" title="Help: how Vellum works, and its keys">
                    <Icon name="info" size={15} />
                  </Button>
                  <NotificationInboxButton />

                </>
              }
              menuOpen={noteMenu}
              activeAnchor={
                active ? (
                  <NoteMenu
                    thread={active}
                    profile={activeProfile}
                    open={noteMenu}
                    onOpenChange={setNoteMenu}
                    canOpenClaude={Boolean(active.claudeSessionId) && activeAgent.claudeCode}
                    onRename={(title) => record(active.id, { type: 'vellum/title', title })}
                    onOpenClaude={openClaude}
                    onClose={() => closeTab(active.id)}
                  />
                ) : null
              }
              onPick={(id) => {
                // A tab is a way out of Settings, back to that note.
                if (overlay === 'settings') setOverlay(null)
                // The current pill is the note's title: pressing it opens its menu.
                // Help's has no menu.
                if (id === activeId && view === 'notes') return id === HELP_ID ? undefined : setNoteMenu((v) => !v && !closedByOutsidePress())
                setView('notes')
                setActiveId(id)
                setTimeout(focusComposer, 50)
              }}
              onClose={closeTab}
              view={view}
              terms={terms.map((t) => ({ id: t.id, title: t.title, running: t.session.exitCode === undefined }))}
              activeTermId={termId ?? undefined}
              onNotes={showNotes}
              onTerminal={showTerminal}
              onPickTerm={(id) => {
                setTermId(id)
                setView('terminal')
              }}
              onCloseTerm={closeTerm}
              onNewTerm={hasPty ? newShell : undefined}
              onNew={() => startNewNote()}
              changes={stripChanges ? { summary: stripChanges, onPress: () => setOverlay('changes') } : undefined}
              trailing={
                <>
                  {/* At the right end, over the pane it opens. */}
                  {activeBrowser ? <BrowserLauncher browser={activeBrowser} /> : null}
                  <Button onPress={() => setOverlay((current) => current === 'annotations' ? null : 'annotations')} selected={overlay === 'annotations'} testId="open-annotations" title="Annotations across all notes"><Icon name="pencil" size={14} />{annotationOpenCount ? <Meta color={m.textMuted}>{String(annotationOpenCount)}</Meta> : null}</Button>
                  {mobileSupported ? <Button onPress={toggleMobile} selected={mobileOpen} testId="open-mobile" title="Mobile view (⇧⌘M)"><Icon name="phone" size={14} /></Button> : null}
                  {active && !term ? <Button onPress={toggleFiles} selected={Boolean(previewing) && fileTree} testId="open-files" title={keys('Files in this folder (⇧⌘E)')}><Icon name={previewing && fileTree ? 'folderOpen' : 'folderClosed'} size={14} /></Button> : null}
                </>
              }
            />
          </motion.div>
          {/* The page: the note (or a terminal, or Settings) on a card of its own, rounded all round. */}
          <div style={{ flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'row', position: 'relative' }}>
          <div style={{ flexGrow: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'row', position: 'relative' }}>
          <div
            style={{
              flexGrow: 1,
              minHeight: 0,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: m.pane,
              borderRadius: paneRadius,
              borderWidth: 1,
              borderColor: m.border,
              boxShadow: { offsetX: 0, offsetY: 1, blurRadius: 0, spreadRadius: 0, color: m.paneHighlight, inset: true },
              overflow: 'hidden',
              position: 'relative',
            }}
          >
          {term ? (
            <TerminalView term={term} onClose={() => closeTerm(term.id)} onLeave={showNotes} />
          ) : activeId === HELP_ID ? (
            <HelpNote onWrite={writeFromHelp} />
          ) : active ? (
            <>
              {/* Text scrolls under the strip through a short fade instead of a hard edge. */}
              <div ref={browserPage} testId="page" onMouseMove={hoverPane('page')} style={{ position: 'relative', flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column', ...(activePane === 'page' ? {} : { userSelect: 'none' }) }}>
              <Document
                thread={active}
                actions={actions}
                onStop={interrupt}
                waiting={pendingAsks.length > 0}
                onTailClick={focusComposer}
                listRef={noteList}
                onVisibleRange={visibleRows.set}
                captureTarget={captureJump?.noteId === active.id ? captureJump : undefined}
                notice={trustFiles?.length ? <TrustNotice files={trustFiles} agent={activeAgent.title} onTrust={() => trustFolder(active.workspace)} /> : undefined}
                composer={
                  <Composer
                    key={active.id}
                    submitOnEnter
                    value={draft.text}
                    tags={draft.tags}
                    images={draft.images}
                    onPaste={(inserted) => {
                      const id = active.id
                      void (async () => {
                        // Text that went in at once was a paste only if it's what the clipboard holds.
                        if (inserted !== undefined && (await clipboardText()).trimEnd() !== inserted.trimEnd()) return
                        const file = await pasteImage(paths.images)
                        if (!file) return
                        setDraftImages(id, (all) => [...all, file])
                        // A file copied in Finder pastes its name too: the image stands for it.
                        if (inserted && isImageName(inserted)) {
                          setDrafts((all) => {
                            const d = all[id]
                            return d?.text.includes(inserted) ? { ...all, [id]: { ...d, text: d.text.replace(inserted, '') } } : all
                          })
                        }
                      })()
                    }}
                    onRemoveImage={(i) => setDraftImages(active.id, (all) => all.filter((_, j) => j !== i))}
                    onChange={(text, tags) => {
                      setDraft(active.id, text, tags)
                      // An autofocused textarea never reports focus, so typing counts as writing too.
                      setWriting(true)
                      revealComposer()
                    }}
                    onSend={(steer) => {
                      revealComposer()
                      send(steer)
                    }}
                    running={active.running}
                    canSteer={runners.current.get(active.id)?.canSteer}
                    queue={queues[active.id] ?? []}
                    onSteerQueued={(i) => {
                      const item = queues[active.id]?.[i]
                      if (!item) return
                      setQueues((all) => ({ ...all, [active.id]: (all[active.id] ?? []).filter((_, j) => j !== i) }))
                      void steerIn(active, item)
                    }}
                    onForceQueued={(i) => {
                      const item = queues[active.id]?.[i]
                      if (!item) return
                      sendNow(active.id, item)
                    }}
                    onUnqueue={(i) => { const item = queues[active.id]?.[i]; if (item?.captureId) updateCapture(active.id, item.captureId, { status: 'queued', delivery: undefined }); setQueues((all) => ({ ...all, [active.id]: (all[active.id] ?? []).filter((_, j) => j !== i) })) }}
                    profile={activeProfile}
                    workspace={active.workspace}
                    recipes={recipes}
                    placeholder={placeholder}
                    composerRef={composerRef}
                    onFocusChange={setWriting}
                    tokenCtx={tokenCtx}
                    mode={modeFor(activeAgent, active.mode)}
                    modes={agentModeList}
                    onMode={setMode}
                    // Keys answer only the card that is on screen, and not in its first moments.
                    asking={!term && pendingAsks.length > 0 && !pendingAsks[0]?.questions}
                    onAskKey={(k) => {
                      const shown = pendingAsks[0] && Date.now() - askSeenAt.current.get(pendingAsks[0].requestId)! >= ASK_KEY_DELAY_MS
                      if (shown || k === 'deny') answer(k)
                    }}
                  />
                }
              />
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  // Clear of the card's rounded corners: GPUI doesn't clip a child to its parent's
                  // radius, so a fade reaching the edges paints square corners over the curve.
                  left: paneRadius,
                  right: Math.max(12, paneRadius),
                  height: 24,
                  pointerEvents: 'none',
                  background: { type: 'linear-gradient', angle: 180, stops: [{ color: m.pane, position: 0 }, { color: `${m.pane.slice(0, 7)}00`, position: 1 }] },
                }}
              />
              <Timeline thread={active} list={noteList} rows={visibleRows} />
              {activeBrowser ? <AgentScreenHost key={activeBrowser.generation} browser={activeBrowser} thread={active} rows={visibleRows} page={browserPage} onTakeControl={() => runners.current.get(active.id)?.interrupt()} onDrivingChange={driving => setDrivingBrowserNoteId(driving ? active.id : undefined)} /> : null}
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: 10, display: 'flex', flexDirection: 'row', justifyContent: 'center', pointerEvents: 'none' }}>
                <div style={{ pointerEvents: 'auto' }}>
                <StatusBar
                  key={active.id}
                  accountLabel={activeProfile?.name ?? activeAgent.title}
                  accountColor={activeProfile?.color}
                  accounts={[
                    { kind: 'label', label: active.running ? `Available when ${activeAgent.title} finishes` : 'Agent for this note' },
                    ...profiles.map((profile) => ({ label: `${agentFor(profile).title} · ${profile.name}`, icon: agentFor(profile).id, checked: profile.id === active.profileId, disabled: profile.id !== active.profileId && active.running, testId: `move-${profile.id}`, onSelect: () => moveNote(active, profile.id) })),
                    ...agentChoices(profiles).filter((choice) => !profiles.some((profile) => agentFor(profile).id === choice.agent.id)).map((choice) => ({ label: choice.agent.title, icon: choice.agent.id, disabled: active.running || Boolean(choice.why), hint: choice.why, testId: `agent-${choice.agent.id}`, onSelect: () => {
                      const profile = existingAgentProfile(choice.agent.id)
                      profilesRef.current = loadProfiles()
                      setProfiles(profilesRef.current)
                      moveNote(active, profile.id)
                    } })),
                    { kind: 'separator' },
                    { label: 'Accounts and settings…', icon: 'settings', testId: 'account-settings', onSelect: () => openSettings('Accounts') },
                  ]}
                  mode={modeFor(activeAgent, active.mode)}
                    modes={agentModeList}
                  onMode={setMode}
                  think={active.think ?? 'on'}
                  onThink={setThink}
                  models={models[active.profileId]}
                  efforts={efforts[active.profileId]}
                  model={active.modelPick}
                  resolvedModel={active.model}
                  onModel={setModel}
                  context={active.context}
                  running={active.running}
                  onCompact={compact}
                />
                </div>
              </div>
              </div>
            </>
          ) : (
            <EmptyState onNew={() => startNewNote()} />
          )}
          {/* Settings is a page over the note, under the strip (ui/Settings.tsx). */}
          <AnimatePresence>
          {overlay === 'settings' ? (
            <SettingsPage
              noteId={activeId}
              key="settings"
              page={settingsPage}
              top={0}
              onClose={() => setOverlay(null)}
              onOnboarding={() => { setOverlay(null); setView('notes'); setOnboardingStep(0); setOnboardingProfile(profiles.find((p) => p.id === readSettings().newNoteProfile)?.id ?? profiles[0]?.id); setOnboardingError(''); setOnboarding(true) }}
              material={materialName}
              onMaterial={(next) => {
                setMaterialName(next)
                updateSettings({ material: next })
              }}
              tabs={tabMode}
              onTabs={(next) => {
                setTabMode(next)
                setStripToggled(false)
                updateSettings({ tabs: next })
              }}
              motion={motionSetting}
              onMotion={(next) => {
                motionPref(next)
                setMotionSetting(next)
                updateSettings({ motion: next })
              }}
              showThoughts={showThoughts}
              onShowThoughts={(next) => { setShowThoughts(next); updateSettings({ showThoughts: next }) }}
              profiles={profiles}
              busy={authBusy}
              refreshing={authRefreshing}
              onRefresh={(id) => { void refreshAccount(id) }}
              onLogin={openLogin}
              onLogout={logOut}
              onAddProfile={addAccount}
              onRestore={(thread) => setThreads((prev) => [thread, ...prev.filter((t) => t.id !== thread.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))}
            />
          ) : null}
          </AnimatePresence>
          {/* Auto mode: touching the top edge brings the strip back, no click needed. */}
          {!stripVisible && tabMode === 'auto' ? (
            <div testId="strip-hot-zone" onMouseEnter={() => setStripHover(true)} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 12 }} />
          ) : null}
          {toast}
          <NotificationBanner />
          <ApprovalCard
            ask={term || pendingAsks[0]?.questions ? undefined : pendingAsks[0]}
            more={pendingAsks.length - 1}
            workspace={active?.workspace}
            model={active?.model ? shortModel(undefined, active.model) : undefined}
            denying={denying}
            onDenying={(open) => {
              setDenying(open)
              if (!open) setTimeout(focusComposer, 30)
            }}
            onAllow={() => answer('allow')}
            onAlways={() => answer('always')}
            onDeny={(message) => answer('deny', message)}
            preview={pendingAsks[0]?.patch ? <DiffCard patch={pendingAsks[0].patch} /> : undefined}
          />
          <AskUserQuestions ask={term ? undefined : pendingAsks[0]} onAnswer={answerQuestions} />
          </div>
          {/* A file open beside the note: a card of its own, or over the note's right side when the window is narrow. */}
          <DockPanel open={Boolean(active && previewing && !term && overlay !== 'settings' && !(mobileOpen && mobileOverlay))} width={previewSize.width} overlay={!previewSize.split} gap={shellInset} testId="file-dock" selectable={activePane === 'file'}>
          {active && previewing ? (
            <FilePreview
              onMouseMove={hoverPane('file')}
              workspace={active.workspace}
              file={previewing}
              version={active.updatedAt}
              width={previewSize.width}
              treeWidth={paneSize.tree}
              split={previewSize.split}
              radius={paneRadius}
              tree={fileTree}
              changes={fileChanges}
              onTree={showTree}
              onOpenFile={(file) => setPreviews((all) => ({ ...all, [active.id]: { path: file } }))}
              onMention={(file, line, endLine) => mentionTag(active.id, { type: 'file', value: file, line, ...(endLine ? { endLine } : {}) })}
              onMentionPath={(rel, dir) => mentionTag(active.id, dir ? { type: 'folder', value: `${rel}/` } : { type: 'file', value: rel })}
              onViewImage={(src) => setViewing({ images: [src], index: 0 })}
              onResize={startResize}
              onClose={() => {
                setPreviews(({ [active.id]: _, ...rest }) => rest)
                setTimeout(focusComposer, 30)
              }}
            />
          ) : null}
          </DockPanel>
          </div>
          <DockPanel open={mobileOpen} width={mobileWidth} overlay={mobileOverlay} gap={shellInset} testId="mobile-dock" selectable={activePane === 'mobile'}>
            <MobileView onMouseMove={hoverPane('mobile')} radius={paneRadius} onClose={() => { setMobileOpen(false); updateSettings({ mobileView: false }); setTimeout(focusComposer, 30) }} onLeave={focusComposer} onResize={(x, reset) => startResize('mobile', x, reset)} onCapture={setPhoneCapture} />
          </DockPanel>
          </div>
        </div>

        <Changes
          open={overlay === 'changes'}
          onClose={() => setOverlay(null)}
          thread={active}
          onAdd={(hunks, notes, commented) => {
            if (!active) return
            const d = draftsRef.current[active.id] ?? { text: '', tags: [] }
            // ± pills at the end of the draft; you write what to do with them around them.
            const picked = hunkTags(hunks, notes, d.tags)
            const added = [...picked, ...commentTags(commented, notes, [...d.tags, ...picked])]
            const pills = added.map(tagText).join(' ')
            setDraft(active.id, d.text.trim() ? `${d.text.trimEnd()} ${pills} ` : `${pills} `, [...d.tags, ...added])
            setOverlay(null)
            setTimeout(focusComposer, 50)
          }}
        />
        <History
          open={overlay === 'history'}
          onClose={() => setOverlay(null)}
          threads={threads}
          profiles={profiles}
          activeId={activeId}
          openIds={tabs}
          onPick={(id) => {
            openNote(id)
            setOverlay(null)
            setTimeout(focusComposer, 50)
          }}
          view={shelf}
          onView={setShelf}
          recipes={recipes}
          folder={active?.workspace}
          onUseRecipe={(name) => {
            if (!active) return
            // The recipe goes at the start of the draft; anything already written follows it as its input.
            const d = draftsRef.current[active.id]
            const rest = d?.text.trim().replace(/^\$[a-z0-9-]+\s*/, '') ?? ''
            setDraft(active.id, `$${name} ${rest}`, d?.tags ?? [])
            setOverlay(null)
            setTimeout(focusComposer, 50)
          }}
          onDelete={deleteNote}
          onRecipesChanged={() => setRecipesSaved((n) => n + 1)}
        />
        <Annotations open={overlay === 'annotations'} onClose={() => setOverlay(null)} captures={annotationCaptures} notes={threads} onOpen={openAnnotation} onInspect={(saved) => { setOverlay(null); setCaptureViewing(saved) }} onStatus={changeAnnotationStatus} onSend={sendAnnotationToNote} onSendToAgent={(saved) => { try { queueAnnotation(saved) } catch (error) { showToast(String((error as Error).message)) } }} />
        {currentCapture ? <CaptureViewer saved={currentCapture} onClose={() => setCaptureViewing(undefined)} onImage={(images, index) => setViewing({ images, index })} /> : null}
        {currentBrowser ? <BrowserViewer browser={currentBrowser} onClose={() => { setDrivingBrowserNoteId(undefined); setBrowserViewing(undefined) }} onTakeControl={() => runners.current.get(currentBrowser.noteId)?.interrupt()} onDrivingChange={(driving) => setDrivingBrowserNoteId(driving ? currentBrowser.noteId : undefined)} /> : null}
        {viewing ? (
          <ImageViewer
            viewing={viewing}
            onIndex={(index) => setViewing({ ...viewing, index })}
            onClose={() => {
              setViewing(undefined)
              setTimeout(focusComposer, 30)
            }}
          />
        ) : null}
        {/* While an edge is dragged, moves go to whatever is under the pointer: this covers it all. */}
        {phoneCapture ? <div testId="mobile-cover" onMouseMove={phoneCapture.move} onMouseUp={phoneCapture.up} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, cursor: 'pointer', pointerEvents: 'auto', userSelect: 'none' }} /> : null}
        {resizing ? <div testId="resize-cover" onMouseMove={followResize} onMouseUp={endResize} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, cursor: 'col-resize', pointerEvents: 'auto', userSelect: 'none' }} /> : null}
        {onboarding ? <Onboarding
          step={onboardingStep}
          onStep={setOnboardingStep}
          profiles={profiles}
          profileId={onboardingProfile}
          onAgent={(agent) => {
            const profile = existingAgentProfile(agent)
            setProfiles(loadProfiles())
            setOnboardingProfile(profile.id)
            setOnboardingError('')
            void refreshAccount(profile.id, profile)
          }}
          busy={authBusy}
          refreshing={authRefreshing}
          onRefresh={(id) => { void refreshAccount(id) }}
          onLogin={(id) => { setOnboardingError(''); void openLogin(id).catch((error) => { busy(id, false); setOnboardingError(`Couldn’t start sign-in: ${String((error as Error).message ?? error)}`) }) }}
          material={materialName}
          onMaterial={(next) => { setMaterialName(next); updateSettings({ material: next }) }}
          tabs={tabMode}
          onTabs={(next) => { setTabMode(next); setStripToggled(false); updateSettings({ tabs: next }) }}
          loginActive={view === 'terminal'}
          error={onboardingError}
          onFinish={(prompt) => {
            updateSettings({ onboardingComplete: true, newNoteProfile: onboardingProfile })
            setOnboarding(false)
            if (prompt !== undefined) {
              fromHelp.current = prompt
              setOverlay('new')
            } else {
              setOverlay(null)
              setTimeout(focusComposer, 50)
            }
          }}
        /> : null}
      </div>
    </AgentContext.Provider>
    </MaterialContext.Provider>
  )
}

function windowSize(spec: string | undefined) {
  const [w, h] = (spec ?? '').split('x').map(Number)
  return { width: w || 1080, height: h || 780 }
}

render(<Startup />, {
  title: 'Vellum',
  appName: 'Vellum',
  appId: 'dev.vellum.app',
  // VELLUM_WINDOW=1600x1000 opens it at another size, for checks of a wide or narrow window.
  ...windowSize(process.env.VELLUM_WINDOW),
  // macOS: no titlebar and no traffic lights, since Vellum is driven from the keyboard (⌘Q, ⇧⌘W, ⌘M).
  // GPUIX has no option to hide them, so they sit off the window (see NOTES). Windows and Linux keep
  // the system title bar: GPUIX can't draw window controls or a drag area there.
  ...(isMac ? { titlebarTransparent: true, trafficLightX: -200, trafficLightY: -200 } : {}),
  windowBackground: 'opaque',
  keyboardFocusDim: false,
  focus: process.env.GPUIX_BACKGROUND !== '1',
  onKeyDown(event) {
    activity.touch()
    shortcuts.current?.(event)
  },
})

// Run from `bun app.tsx`, the Dock would show Bun's icon: only a .app bundle names one (core/dock.ts).
// Vellum.app names its own (scripts/build-app.ts).
if (!compiled) setTimeout(() => setDockIcon(path.join(import.meta.dir, 'assets', 'icon.png')), 0)
