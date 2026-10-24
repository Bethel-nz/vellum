// Vellum: a markdown note you can talk to. Drives the official `claude` CLI.
//
// Layout: a tab bar of open notes on the glass, then the page: its title (with
// a menu) and the note itself. The note is one editable document; new writing
// goes at its end, and ⌘↵ asks Claude. Cmd+K finds any note; Cmd+N starts one.

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, render, useGpuixRequired, useWindowSize, type KeyEvent, type PublicInstance } from '@gpuix/react'
import { ApprovalCard, Button, closedByOutsidePress, Field, Label, Menu, Sheet, SheetHeader, SheetSection, stripHeight, TabStrip, useToast, type MenuItem as MenuEntry } from './components'
import { FloatingLayer } from '@gpuix/react/floating'
import { ease, setReducedMotion, tween } from './components/motion'
import { AgentRunner, killAllAgents } from './core/agent'
import { accountStatus, loginCommand, loginMethods, logout, sameLogin } from './core/auth'
import { linkAccount } from './core/accounts'
import { identityFor, machineAvatar, realName } from './core/avatar'
import { cacheModels, cachedModels, type ModelOption } from './core/models'
import { StatusBar } from './ui/StatusBar'
import { defaultMode, type Ask, type PermissionMode, type Think } from './core/asks'
import { createProfile, loadProfiles, profileEnv, profileForWorkspace, rememberWorkspace, updateProfile, type Profile } from './core/profiles'
import { paths, readJson, readSettings, updateSettings, writeJson } from './core/store'
import { promptFor, tagsIn, tagText } from './core/tags'
import { killAllTerms, startTerm, type TermSession } from './core/term'
import { claudeBin, hasPty, isMac, keys, openConsole, pasteImage, primary, revealFolder, revealLabel, shellArgv, tabStep } from './core/platform'
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
import { BlockView, DiffCard, type BlockActions } from './ui/blocks'
import { Composer } from './ui/Composer'
import { NewThreadDialog, ThreadSwitcher } from './ui/dialogs'
import { History } from './ui/History'
import { Changes } from './ui/Changes'
import { revealEnd } from './ui/glide'
import { Timeline, watchRows } from './ui/Timeline'
import { changeCount, hunkTags } from './core/changes'
import { Dot, Icon, Kbd, MaterialContext, Meta, Quiet, useM } from './ui/kit'
import { SettingsPage, type MotionPref, type TabMode } from './ui/Settings'
import { CELL_W, TerminalBlock } from './ui/TerminalBlock'
import {
  accentFor,
  concentric,
  radiusBase,
  contentInset,
  font,
  readingWidth,
  shellInset,
  materialNames,
  materials,
  translucent,
  wantsBlur,
  solid,
  windowRadius,
  type MaterialName,
} from './ui/theme'

const SOLID = process.env.VELLUM_SOLID === '1'
// Window material is fixed when the window opens: translucency and blur apply on next launch.
const TRANSLUCENT = !SOLID && readSettings().translucent === true
const START_BLUR = !SOLID && (TRANSLUCENT || wantsBlur(materials[readSettings().material ?? 'groknight']))
/** Your Mac account picture and name, read once at launch (core/avatar.ts). */
const MACHINE_ME = { src: machineAvatar(), name: realName() }
/** Most tabs open at once: one per ⌘1–⌘9. The rest live in History (⌘Y). */
const MAX_TABS = 9
/** ↵ / ⌘↵ in the composer don't answer a card younger than this. */
const ASK_KEY_DELAY_MS = 400
const motionPref = (p: MotionPref) => setReducedMotion(p === 'system' ? undefined : p === 'reduce')
motionPref(readSettings().motion ?? 'system')
const FONT_DIR = path.join(import.meta.dir, 'assets', 'fonts')
// Geist for UI and prose, Geist Mono for code; Inter stays registered as the sans fallback.
const FONTS = [
  'Geist-Regular.ttf', 'Geist-Medium.ttf', 'Geist-SemiBold.ttf', 'Geist-Italic.ttf',
  'GeistMono-Regular.ttf', 'GeistMono-Medium.ttf',
  'Inter-Regular.ttf', 'Inter-Medium.ttf', 'Inter-SemiBold.ttf',
]

type Pane =
  /** `label` is what runs, as you'd type it (the agent hands `--cli auth login` to claude). */
  | { kind: 'login'; profileId: string; session: TermSession; label: string }
  | { kind: 'claude'; threadId: string; session: TermSession }

type Draft = { text: string; tags: Tag[]; images?: string[] }

// Window-level shortcuts are registered once in render(); App swaps the handler in.
const shortcuts: { current?: (e: KeyEvent) => void } = {}

// ---------------------------------------------------------------- document

function Paragraph({ children, kind }: { children: React.ReactNode; kind?: Block['kind'] | 'title' | 'status' | 'composer' }) {
  const top = kind === 'user' || kind === 'composer' ? 18 : kind === 'title' ? 28 : 6
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', paddingTop: top, paddingBottom: 6 }}>
      <div style={{ width: '100%', maxWidth: readingWidth, paddingLeft: 28, paddingRight: 28 }}>{children}</div>
    </div>
  )
}

// The whole page is the note: your paragraphs, Claude's replies and tool work,
// then the paragraph being written. There is no separate input box.
const Document = memo(function Document({
  thread,
  actions,
  composer,
  onStop,
  onTailClick,
  listRef,
  onVisibleRange,
}: {
  thread: Thread
  actions: BlockActions
  composer: React.ReactNode
  onStop: () => void
  onTailClick: () => void
  listRef?: React.Ref<PublicInstance>
  onVisibleRange?: (range: [number, number]) => void
}) {
  const m = useM()
  return (
    <virtual-list
      ref={listRef}
      onVisibleRange={(e) => onVisibleRange?.([e.startIndex ?? 0, e.endIndex ?? 0])}
      alignment="top"
      followTail
      estimatedItemHeight={90}
      overdraw={600}
      style={{ flexGrow: 1, minHeight: 0, width: '100%', scrollbarColor: m.scrollbar, scrollbarWidth: 10 }}
    >
      <div key="head" style={{ height: 28 }} />
      {thread.blocks.map((b) => (
        <Paragraph key={b.id} kind={b.kind}>
          <BlockView block={b} actions={actions} />
        </Paragraph>
      ))}
      {thread.running ? (
        <Paragraph key="working" kind="status">
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Meta color={m.textMuted}>Working…</Meta>
            <Quiet onPress={onStop} testId="stop" title="Stop">
              <Meta color={m.textFaint}>{keys('Stop ⌘.')}</Meta>
            </Quiet>
          </div>
        </Paragraph>
      ) : null}
      <Paragraph key="composer" kind="composer">
        {composer}
      </Paragraph>
      {/* Room past the end, like an editor; clicking it puts the caret back at the end. */}
      <div key="tail" onClick={onTailClick} style={{ height: 240, cursor: 'text' }} />
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
function AccountSwitcher({
  thread,
  profiles,
  colorOf,
  onMove,
  onSettings,
}: {
  thread?: Thread
  profiles: Profile[]
  colorOf: (id: string) => string
  onMove: (profileId: string) => void
  onSettings: () => void
}) {
  const [open, setOpen] = useState(false)
  const profile = profiles.find((p) => p.id === thread?.profileId)
  if (!thread || !profile) return null
  const items: MenuEntry[] = [
    { kind: 'label', label: thread.running ? 'Move this note once Claude is done' : 'Move this note to' },
    ...profiles.map((p) => ({
      label: p.name,
      dot: colorOf(p.id),
      // No email here: the name is enough to pick by, and Settings has the details.
      hint: p.id === profile.id ? 'This note' : p.loggedIn === false ? 'Not logged in' : undefined,
      checked: p.id === profile.id,
      disabled: p.id !== profile.id && (thread.running || p.loggedIn === false),
      testId: `move-${p.id}`,
      onSelect: () => p.id !== profile.id && onMove(p.id),
    })),
    { kind: 'separator' },
    { label: 'Accounts…', icon: 'settings', testId: 'account-settings', onSelect: onSettings },
  ]
  return (
    <div style={{ position: 'relative' }}>
      <Button onPress={() => setOpen((v) => !v && !closedByOutsidePress('account'))} selected={open} testId="account-pill" title="This note's account">
        <Dot color={colorOf(profile.id)} size={7} />
        <Label muted>{profile.name}</Label>
        <Icon name="chevronDown" size={11} />
      </Button>
      <Menu open={open} onClose={() => setOpen(false)} side="bottom" align="end" width={280} testId="account-menu" closeKey="account" items={items} />
    </div>
  )
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
          <div onMouseDownOutside={finishRename} style={{ display: 'flex', padding: 5, backgroundColor: m.popup, borderRadius: concentric(radiusBase + 5, 0), borderWidth: 1, borderColor: m.border, boxShadow: { offsetX: 0, offsetY: 12, blurRadius: 32, spreadRadius: 0, color: m.shadow } }}>
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

function TerminalPane({ pane, title, hint, onClose }: { pane: Pane; title: string; hint: string; onClose: () => void }) {
  const m = useM()
  return (
    <div style={{ flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 10, paddingLeft: 16, paddingRight: 16, paddingBottom: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <text style={{ fontSize: 13, lineHeight: 18, color: m.text, fontWeight: 500 }}>{title}</text>
        <Meta>{hint}</Meta>
        <div style={{ flexGrow: 1 }} />
        <Quiet onPress={onClose} testId="close-pane">
          <Icon name="x" size={12} />
          <Meta color={m.textMuted}>Close</Meta>
        </Quiet>
      </div>
      <TerminalBlock session={pane.session} title={pane.kind === 'login' ? pane.label : pane.session.argv.join(' ')} mode="full" autoFocus testId="pane-term" />
    </div>
  )
}

// ---------------------------------------------------------------- app

function initialMaterial(): MaterialName {
  return readSettings().material ?? 'groknight'
}

function App() {
  const renderer = useGpuixRequired()
  const windowSize = useWindowSize()
  const [materialName, setMaterialName] = useState<MaterialName>(initialMaterial)
  const material = useMemo(() => {
    const base = materials[materialName]
    return SOLID ? solid(base) : TRANSLUCENT ? translucent(base) : base
  }, [materialName])

  const [profiles, setProfiles] = useState<Profile[]>(loadProfiles)
  const [threads, setThreadsState] = useState<Thread[]>(loadThreads)
  const [activeId, setActiveId] = useState<string | undefined>(() => {
    const last = readSettings().lastThreadId
    return threads.some((t) => t.id === last) ? last : threads[0]?.id
  })
  // Open notes, in tab order. The active note is always one of them.
  const [tabs, setTabs] = useState<string[]>(() => {
    const open = (readSettings().openTabs ?? []).filter((id) => threads.some((t) => t.id === id))
    return activeId && !open.includes(activeId) ? [...open, activeId] : open
  })
  // Replies that finished while their tab was in the background.
  const [unread, setUnread] = useState<Record<string, number>>({})
  /** Permission asks waiting on you, per note, oldest first. They live as long as their process. */
  const [asks, setAsks] = useState<Record<string, Ask[]>>({})
  const [models, setModels] = useState<Record<string, ModelOption[]>>(cachedModels)
  const [denying, setDenying] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => readJson(paths.drafts, {}))
  const [overlay, setOverlay] = useState<null | 'new' | 'switcher' | 'settings' | 'history' | 'changes'>(null)
  const [noteMenu, setNoteMenu] = useState(false)
  const [pane, setPane] = useState<Pane | null>(null)
  // Tab strip: the mode from settings, ⌘⇧T flipping it, and the top-edge hover in auto mode.
  const [tabMode, setTabMode] = useState<TabMode>(() => readSettings().tabs ?? 'pinned')
  const [stripToggled, setStripToggled] = useState(false)
  const [stripHover, setStripHover] = useState(false)
  const [writing, setWriting] = useState(false)
  const [motionSetting, setMotionSetting] = useState<MotionPref>(() => readSettings().motion ?? 'system')
  const [translucentSetting, setTranslucentSetting] = useState(() => readSettings().translucent === true)
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

  const active = threads.find((t) => t.id === activeId)
  const activeProfile = profiles.find((p) => p.id === active?.profileId)
  const draft = (active && drafts[active.id]) || { text: '', tags: [] }

  // Fonts: Inter for UI and prose. Text repaints once a family registers.
  useEffect(() => {
    for (const f of FONTS) {
      const file = path.join(FONT_DIR, f)
      if (!existsSync(file)) continue
      try {
        renderer.registerFont?.(readFileSync(file))
      } catch (err) {
        console.error(`[vellum] font ${f}:`, err)
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
  // note down to it, smoothly (ui/glide.ts). The slack is the 240px of room under the composer
  // less 80: up to there its last line is still clear of the bottom edge.
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

  useEffect(() => {
    const timer = setTimeout(() => {
      const kept = Object.fromEntries(Object.entries(drafts).filter(([, d]) => d.text || d.images?.length))
      writeJson(paths.drafts, kept)
    }, 300)
    return () => clearTimeout(timer)
  }, [drafts])

  // The .md copy is rewritten shortly after a thread changes.
  const saved = useRef(new Map<string, Thread>())
  useEffect(() => {
    const timer = setTimeout(() => {
      for (const t of threads) {
        if (saved.current.get(t.id) === t) continue
        saved.current.set(t.id, t)
        try {
          writeMarkdown(t)
        } catch (err) {
          console.error('[vellum] markdown', err)
        }
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
            if (activeRef.current !== thread.id) {
              const title = threadsRef.current.find((t) => t.id === thread.id)?.title ?? 'A note'
              showToastRef.current(`${title} · Claude needs your OK`)
            }
          },
          askGone(requestId) {
            setAsks((all) => ({ ...all, [thread.id]: (all[thread.id] ?? []).filter((a) => a.requestId !== requestId) }))
          },
          modeChanged(mode) {
            record(thread.id, { type: 'vellum/mode', mode })
          },
          models(list) {
            setModels((all) => ({ ...all, [profile.id]: list }))
            cacheModels(profile.id, list)
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
            if (ev.type === 'acp/end' && activeRef.current !== thread.id) {
              setUnread((u) => ({ ...u, [thread.id]: (u[thread.id] ?? 0) + 1 }))
              const title = threadsRef.current.find((t) => t.id === thread.id)?.title ?? 'A note'
              showToastRef.current(`${title} · Claude replied`, 'success')
            }
          },
          record(rec) {
            record(thread.id, rec)
            if (rec.type === 'vellum/error' && rec.login) setLoggedIn(profile.id, false)
          },
        },
      )
      runners.current.set(thread.id, runner)
      return runner
    },
    [dispatch, record, setLoggedIn],
  )

  // ---- actions

  const terminalCols = Math.max(40, Math.floor((Math.min(readingWidth, windowSize.width - shellInset * 2) - 56 - 22) / CELL_W))

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
      showToast(`Moved to ${to.name}; Claude picks up from the note`)
    },
    [record, showToast],
  )

  /** ⌘↵: send what was written at the end, plus any edits made to earlier text. */
  const send = useCallback(() => {
    const thread = threadsRef.current.find((t) => t.id === activeRef.current)
    if (!thread) return
    const d = draftsRef.current[thread.id] ?? { text: '', tags: [] }
    const text = d.text.trim()
    if (text.startsWith('!')) {
      const command = text.slice(1).trim()
      if (command) runShell(thread, command)
      setDraft(thread.id, '', [])
      return
    }
    const edits = describeEdits(thread)
    // The first turn after a move to another account starts a session there: give it the note.
    const handoff = thread.handoff ? handoffContext(thread) : ''
    const images = d.images ?? []
    if (!text && !edits && !images.length) return
    if (thread.running) return
    if (pane?.kind === 'claude' && pane.threadId === thread.id) return
    const tags = tagsIn(text, d.tags)
    record(thread.id, { type: 'vellum/user', text, tags, at: new Date().toISOString(), ...(images.length ? { images } : {}) })
    if (edits) record(thread.id, { type: 'vellum/synced' })
    if (text && !thread.blocks.some((b) => b.kind === 'user') && (thread.title === 'Untitled' || thread.title === 'New thread')) {
      const cut = titleFrom(text)
      record(thread.id, { type: 'vellum/title', title: cut })
      provisional.current.set(thread.id, cut)
    }
    const prompt = text ? promptFor(text, tags, { workspace: thread.workspace, scopes: thread.tagScopes }) : ''
    runnerFor(thread).send([handoff, edits, prompt].filter(Boolean).join('\n\n'), images)
    setDraft(thread.id, '', [], [])
  }, [pane, record, runShell, runnerFor, setDraft])
  const sendRef = useRef(send)
  sendRef.current = send

  /** Opens a note in a tab. Past nine, the oldest tab Claude isn't working in makes room. */
  const openNote = useCallback((id: string) => {
    setTabs((t) => {
      if (t.includes(id)) return t
      if (t.length < MAX_TABS) return [...t, id]
      const drop = t.find((x) => !threadsRef.current.find((th) => th.id === x)?.running) ?? t[0]!
      const title = threadsRef.current.find((th) => th.id === drop)?.title ?? 'a note'
      setTimeout(() => showToast(keys(`Closed “${title}” to keep nine tabs · ⌘Y has it`)), 0)
      return [...t.filter((x) => x !== drop), id]
    })
    setActiveId(id)
  }, [])

  const closeTabNow = useCallback(
    (id: string) => {
      const i = tabs.indexOf(id)
      const next = tabs.filter((x) => x !== id)
      // Its agent ends with the tab (and lets go of the session); the next message starts it again.
      void runners.current.get(id)?.dispose()
      runners.current.delete(id)
      setTabs(next)
      if (id === activeId) setActiveId(next[Math.min(Math.max(i, 0), next.length - 1)])
    },
    [tabs, activeId],
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

  const createThread = useCallback(
    (profileId: string, folder: string) => {
      const meta = { id: newThreadId(), title: 'Untitled', profileId, workspace: folder, createdAt: new Date().toISOString() }
      appendRecord(meta.id, { type: 'vellum/meta', meta })
      setThreads((prev) => [newThread(meta), ...prev])
      setProfiles(rememberWorkspace(profileId, folder))
      openNote(meta.id)
      setOverlay(null)
      setTimeout(focusComposer, 50)
    },
    [focusComposer, openNote, setThreads],
  )

  /** Ask who an account is (no model turn) and keep it on the profile. */
  const refreshAccount = useCallback(async (profileId: string, given?: Profile) => {
    const profile = given ?? profilesRef.current.find((p) => p.id === profileId)
    if (!profile) return
    const s = await accountStatus(profile)
    if (!s) return
    const p = given ?? profilesRef.current.find((x) => x.id === profileId)
    // A logged-out account keeps the email it last had, so its next login can ask for that one.
    const email = s.loggedIn ? s.email : (s.email ?? p?.email)
    const plan = s.loggedIn ? s.plan : p?.plan
    if (p && (p.loggedIn !== s.loggedIn || p.email !== email || p.plan !== plan)) setProfiles(updateProfile(profileId, { loggedIn: s.loggedIn, email, plan }))
    return s
  }, [])

  const [authBusy, setAuthBusy] = useState<Set<string>>(new Set())
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
        if (twin) showToastRef.current(`${profile.name} logged in as the same account as ${twin.name}. Sign out of claude.ai in your browser, then log in again.`)
        else if (s?.loggedIn) showToastRef.current(`${profile.name} is logged in${s.email ? ` as ${s.email}` : ''}`, 'success')
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
      setPane({ kind: 'login', profileId, session, label })
      session.exited.then(async () => {
        setPane((p) => (p?.session === session ? null : p))
        await done()
        setTimeout(focusComposer, 50)
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
    (name: string) => {
      const list = createProfile(name)
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
    const session = startTerm({
      argv: [claudeBin(), '--resume', active.claudeSessionId],
      cwd: active.workspace,
      env: profileEnv(profile),
      cols: 100,
      rows: 30,
    })
    setPane({ kind: 'claude', threadId: active.id, session })
    session.exited.then(() => setPane((p) => (p?.session === session ? null : p)))
  }, [active])

  const closePane = useCallback(() => {
    pane?.session.kill()
    setPane(null)
    setTimeout(focusComposer, 50)
  }, [pane, focusComposer])

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
  if (!pane && pendingAsks[0] && !askSeenAt.current.has(pendingAsks[0].requestId)) askSeenAt.current.set(pendingAsks[0].requestId, Date.now())
  const answer = useCallback(
    (key: 'allow' | 'always' | 'deny', message?: string) => {
      const thread = threadsRef.current.find((t) => t.id === activeRef.current)
      const a = thread && asks[thread.id]?.[0]
      if (!thread || !a) return
      if (key === 'deny' && message === undefined) return setDenying(true)
      const always = key === 'always' && Boolean(a.suggestions)
      runners.current.get(thread.id)?.answer(a.requestId, key === 'deny' ? { allow: false, message } : { allow: true, always })
      const decision = key === 'deny' ? 'denied' : always ? 'always' : 'allowed'
      record(thread.id, { type: 'vellum/answer', tool: a.tool, title: a.title, detail: a.detail, decision, message: message?.trim() || undefined, at: new Date().toISOString() })
      setAsks((all) => ({ ...all, [thread.id]: (all[thread.id] ?? []).filter((x) => x.requestId !== a.requestId) }))
      setDenying(false)
      setTimeout(focusComposer, 30)
    },
    [asks, focusComposer, record],
  )
  useEffect(() => setDenying(false), [activeId])

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
      scopes: active?.tagScopes ?? {},
      onWiden: (key: string) => active && record(active.id, { type: 'vellum/tag-scope', key, scope: 'file' }),
    }),
    [active?.id, active?.workspace, active?.tagScopes, record],
  )

  const me = useMemo(() => identityFor(activeProfile, MACHINE_ME), [activeProfile?.avatarImage])
  const actions: BlockActions = useMemo(
    () => ({
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
    }),
    [active?.id, active?.profileId, focusComposer, me, openLogin, record, setDraft, tokenCtx],
  )

  // ---- shortcuts

  const cycleTab = (step: number) => {
    const i = activeId ? tabs.indexOf(activeId) : -1
    if (tabs.length) setActiveId(tabs[(i + step + tabs.length) % tabs.length])
  }

  shortcuts.current = (e: KeyEvent) => {
    const mods = e.modifiers
    const key = (e.key ?? '').toLowerCase()
    // A list or field that handled the key already (⌃N in a picker is also Ctrl+N, new note, off macOS).
    if (e.defaultPrevented) return
    // ⌃← ⌃→ step through the tabs (macOS text fields give ⌃-arrows no meaning of their own);
    // Ctrl+PgUp/PgDn elsewhere, where Ctrl+arrows move by word.
    const step = tabStep(key, mods)
    if (step) {
      e.preventDefault()
      cycleTab(step)
      return
    }
    if (!mods || !primary(mods)) return
    if ((key === 'n' || key === 't') && !mods.shift) {
      e.preventDefault()
      setOverlay('new')
    } else if (key === 'w' && mods.shift) {
      // Plain ⌘W is GPUIX's native Close Window (it quits a one-window app) and never reaches us.
      e.preventDefault()
      if (activeId) closeTab(activeId)
    } else if (/^[1-9]$/.test(key)) {
      e.preventDefault()
      const id = key === '9' ? tabs[tabs.length - 1] : tabs[Number(key) - 1]
      if (id) setActiveId(id)
    } else if (mods.shift && (key === '[' || key === ']' || key === '{' || key === '}' || key === 'bracketleft' || key === 'bracketright')) {
      e.preventDefault()
      cycleTab(key === '[' || key === '{' || key === 'bracketleft' ? -1 : 1)
    } else if (key === 'k') {
      e.preventDefault()
      setOverlay((o) => (o === 'switcher' ? null : 'switcher'))
    } else if (key === 'y') {
      e.preventDefault()
      setOverlay((o) => (o === 'history' ? null : 'history'))
    } else if (key === 'd' && mods.shift) {
      e.preventDefault()
      setOverlay((o) => (o === 'changes' ? null : 'changes'))
    } else if (key === '.') {
      e.preventDefault()
      interrupt()
    } else if (key === ',' || key === 'comma') {
      e.preventDefault()
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

  const typing = writing && Boolean(draft.text.trim())
  const stripVisible = tabMode === 'pinned' ? !stripToggled : tabMode === 'auto' ? stripToggled || stripHover || !typing : stripToggled
  const m = material
  const paneRadius = concentric(windowRadius, shellInset)
  const loginProfile = pane?.kind === 'login' ? profiles.find((p) => p.id === pane.profileId) : undefined
  const tabThreads = tabs.map((id) => threads.find((t) => t.id === id)).filter((t): t is Thread => Boolean(t))
  const editsWaiting = active ? pendingEdits(active).length > 0 : false
  const placeholder = !active?.blocks.length
    ? keys('Start writing.  ⌘↵ asks Claude · ! runs a command · @ tags a file')
    : editsWaiting
      ? keys('⌘↵ tells Claude about your edits')
      : 'Keep writing…'

  return (
    <MaterialContext.Provider value={material}>
      <div
        style={{
          width: '100%',
          height: '100%',
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
            transition={tween({ duration: 0.15, ease: ease.enter })}
            onMouseLeave={() => setStripHover(false)}
            style={{ flexShrink: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
          >
            <TabStrip
              tabs={tabThreads.map((t) => ({
                id: t.id,
                title: t.title,
                time: clock(t.updatedAt),
                running: t.running,
                unread: (unread[t.id] ?? 0) > 0,
                needsYou: (asks[t.id]?.length ?? 0) > 0,
                dot: accentFor(m, profiles, t.profileId),
              }))}
              activeId={activeId}
              leading={
                <Button onPress={() => setOverlay('history')} testId="open-history" title="Past notes (⌘Y)">
                  <Icon name="history" size={14} />
                </Button>
              }
              menuOpen={noteMenu}
              activeAnchor={
                active ? (
                  <NoteMenu
                    thread={active}
                    profile={activeProfile}
                    open={noteMenu}
                    onOpenChange={setNoteMenu}
                    canOpenClaude={Boolean(active.claudeSessionId)}
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
                if (id === activeId) return setNoteMenu((v) => !v && !closedByOutsidePress())
                setActiveId(id)
                setTimeout(focusComposer, 50)
              }}
              onClose={closeTab}
              onNew={() => setOverlay('new')}
              trailing={
                <>
                  {active && changeCount(active) ? (
                    <Button onPress={() => setOverlay('changes')} testId="open-changes" title="Changes in this note (⇧⌘D)">
                      <Icon name="diff" size={13} />
                      <Label muted>{`${changeCount(active)} ${changeCount(active) === 1 ? 'file' : 'files'}`}</Label>
                    </Button>
                  ) : null}
                  <Button onPress={() => setOverlay('switcher')} testId="open-switcher" title="Find a note (⌘K)">
                    <Icon name="search" size={13} />
                    <Kbd>⌘K</Kbd>
                  </Button>
                  <AccountSwitcher
                    thread={active}
                    profiles={profiles}
                    colorOf={(id) => accentFor(m, profiles, id)}
                    onMove={(id) => active && moveNote(active, id)}
                    onSettings={() => setOverlay('settings')}
                  />
                </>
              }
            />
          </motion.div>
          {/* The page: the note (or a terminal, or Settings) on a card of its own, rounded all round. */}
          <div
            style={{
              flexGrow: 1,
              minHeight: 0,
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
          {pane ? (
            <TerminalPane
              pane={pane}
              title={pane.kind === 'login' ? `Log in · ${loginProfile?.name ?? ''}` : 'Claude Code'}
              hint={pane.kind === 'login' ? 'Finish in your browser. This closes by itself once you are in.' : 'Interactive session on this note. Quit claude or close to return.'}
              onClose={closePane}
            />
          ) : active ? (
            <>
              {/* Text scrolls under the strip through a short fade instead of a hard edge. */}
              <div testId="page" style={{ position: 'relative', flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <Document
                thread={active}
                actions={actions}
                onStop={interrupt}
                onTailClick={focusComposer}
                listRef={noteList}
                onVisibleRange={visibleRows.set}
                composer={
                  <Composer
                    value={draft.text}
                    tags={draft.tags}
                    images={draft.images}
                    onPaste={() => {
                      const id = active.id
                      pasteImage(paths.images).then((file) => file && setDraftImages(id, (all) => [...all, file]))
                    }}
                    onRemoveImage={(i) => setDraftImages(active.id, (all) => all.filter((_, j) => j !== i))}
                    onChange={(text, tags) => {
                      setDraft(active.id, text, tags)
                      // An autofocused textarea never reports focus, so typing counts as writing too.
                      setWriting(true)
                      revealComposer()
                    }}
                    onSend={() => {
                      revealComposer()
                      send()
                    }}
                    profile={activeProfile}
                    workspace={active.workspace}
                    placeholder={placeholder}
                    composerRef={composerRef}
                    onFocusChange={setWriting}
                    tokenCtx={tokenCtx}
                    mode={active.mode ?? defaultMode}
                    onMode={setMode}
                    // Keys answer only the card that is on screen, and not in its first moments.
                    asking={!pane && pendingAsks.length > 0}
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
              <div style={{ position: 'absolute', right: 14, bottom: 10 }}>
                <StatusBar
                  mode={active.mode ?? defaultMode}
                  onMode={setMode}
                  think={active.think ?? 'on'}
                  onThink={setThink}
                  models={models[active.profileId]}
                  model={active.modelPick}
                  resolvedModel={active.model}
                  onModel={setModel}
                  context={active.context}
                  running={active.running}
                  onCompact={compact}
                />
              </div>
              </div>
            </>
          ) : (
            <EmptyState onNew={() => setOverlay('new')} />
          )}
          {/* Settings is a page over the note, under the strip (ui/Settings.tsx). */}
          {overlay === 'settings' ? (
            <SettingsPage
              top={0}
              onClose={() => setOverlay(null)}
              material={materialName}
              onMaterial={(next) => {
                setMaterialName(next)
                updateSettings({ material: next })
              }}
              translucent={translucentSetting}
              onTranslucent={(next) => {
                setTranslucentSetting(next)
                updateSettings({ translucent: next })
                showToast('Translucency applies after you restart Vellum')
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
              profiles={profiles}
              busy={authBusy}
              onLogin={openLogin}
              onLogout={logOut}
              onAddProfile={addAccount}
            />
          ) : null}
          {/* Auto mode: touching the top edge brings the strip back, no click needed. */}
          {!stripVisible && tabMode === 'auto' ? (
            <div testId="strip-hot-zone" onMouseEnter={() => setStripHover(true)} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 12 }} />
          ) : null}
          {toast}
          <ApprovalCard
            ask={pane ? undefined : pendingAsks[0]}
            more={pendingAsks.length - 1}
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
          </div>
        </div>
        {overlay === 'new' ? (
          <NewThreadDialog
            open
            onClose={() => setOverlay(null)}
            profiles={profiles}
            recentFolders={recentFolders}
            initialProfileId={active?.profileId}
            initialFolder={active?.workspace}
            suggestProfile={(folder) => profileForWorkspace(profiles, folder)?.id}
            onCreate={createThread}
            onAddProfile={addAccount}
            onLogin={openLogin}
          />
        ) : null}
        <Sheet open={confirmClose !== null} onClose={() => setConfirmClose(null)} width={400} testId="confirm-close">
          <SheetHeader title="Claude is still working" onClose={() => setConfirmClose(null)} />
          <SheetSection>
            <text style={{ fontSize: 13, lineHeight: 19, color: m.textUi }}>Stop it and close this tab? The note and its session stay; you can reopen it with {keys('⌘K')}.</text>
          </SheetSection>
          <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-end', gap: 6, paddingLeft: 18, paddingRight: 14, paddingBottom: 14 }}>
            <Button onPress={() => setConfirmClose(null)} testId="confirm-cancel">
              <Label>Cancel</Label>
            </Button>
            <Button
              variant="solid"
              testId="confirm-stop-close"
              onPress={() => {
                const id = confirmClose
                setConfirmClose(null)
                if (!id) return
                runners.current.get(id)?.interrupt()
                closeTabNow(id)
              }}
            >
              <Label variant="solid">Stop and close</Label>
            </Button>
          </div>
        </Sheet>
        <Changes
          open={overlay === 'changes'}
          onClose={() => setOverlay(null)}
          thread={active}
          onAdd={(hunks, notes) => {
            if (!active) return
            const d = draftsRef.current[active.id] ?? { text: '', tags: [] }
            // ± pills at the end of the draft; you write what to do with them around them.
            const added = hunkTags(hunks, notes, d.tags)
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
        />
        {overlay === 'switcher' ? (
          <ThreadSwitcher
            open
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
            onNew={() => setOverlay('new')}
          />
        ) : null}
      </div>
    </MaterialContext.Provider>
  )
}

render(<App />, {
  title: 'Vellum',
  appName: 'Vellum',
  width: 1080,
  height: 780,
  // macOS: no titlebar and no traffic lights, since Vellum is driven from the keyboard (⌘Q, ⇧⌘W, ⌘M).
  // GPUIX has no option to hide them, so they sit off the window (see NOTES). Windows and Linux keep
  // the system title bar: GPUIX can't draw window controls or a drag area there.
  ...(isMac ? { titlebarTransparent: true, trafficLightX: -200, trafficLightY: -200 } : {}),
  windowBackground: START_BLUR ? 'blurred' : 'opaque',
  keyboardFocusDim: false,
  focus: process.env.GPUIX_BACKGROUND !== '1',
  onKeyDown(event) {
    shortcuts.current?.(event)
  },
})
