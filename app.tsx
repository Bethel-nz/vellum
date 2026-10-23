// Vellum: a markdown note you can talk to. Drives the official `claude` CLI.
//
// Layout: a tab bar of open notes on the glass, then the page: its title (with
// a menu) and the note itself. The note is one editable document; new writing
// goes at its end, and Ctrl+Enter asks Claude. Cmd+K finds any note; Cmd+N starts one.

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DismissableLayer, render, useGpuixRequired, useWindowSize, type KeyEvent, type PublicInstance } from '@gpuix/react'
import { FloatingLayer } from '@gpuix/react/floating'
import { ClaudeRunner, killAllRunners } from './core/claude'
import { createProfile, loadProfiles, profileEnv, profileForWorkspace, rememberWorkspace, updateProfile, type Profile } from './core/profiles'
import { paths, readJson, readSettings, systemAppearance, updateSettings, writeJson } from './core/store'
import { promptFor, tagsIn } from './core/tags'
import { killAllTerms, startTerm, type TermSession } from './core/term'
import {
  appendLine,
  appendRecord,
  loadThreads,
  newThread,
  newThreadId,
  describeEdits,
  pendingEdits,
  reduce,
  titleFrom,
  writeMarkdown,
  type Block,
  type Tag,
  type Thread,
  type VellumRecord,
} from './core/threads'
import { BlockView, type BlockActions } from './ui/blocks'
import { Composer } from './ui/Composer'
import { NewThreadDialog, ThreadSwitcher } from './ui/dialogs'
import { Dot, Icon, Kbd, MaterialContext, Meta, Quiet, useM } from './ui/kit'
import { TerminalBlock } from './ui/TerminalBlock'
import {
  concentric,
  font,
  frost,
  headerHeight,
  radiusBase,
  readingWidth,
  shellInset,
  smoke,
  solid,
  windowRadius,
  type MaterialName,
} from './ui/theme'

const SOLID = process.env.VELLUM_SOLID === '1'
const tabHeight = 30
const FONT_DIR = path.join(import.meta.dir, 'assets', 'fonts')
const FONTS = ['Inter-Regular.ttf', 'Inter-Medium.ttf', 'Inter-SemiBold.ttf', 'Inter-Italic.ttf']

type Pane =
  | { kind: 'login'; profileId: string; session: TermSession }
  | { kind: 'claude'; threadId: string; session: TermSession }

type Draft = { text: string; tags: Tag[] }

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
}: {
  thread: Thread
  actions: BlockActions
  composer: React.ReactNode
  onStop: () => void
  onTailClick: () => void
}) {
  const m = useM()
  return (
    <virtual-list
      alignment="top"
      followTail
      estimatedItemHeight={90}
      overdraw={600}
      style={{ flexGrow: 1, minHeight: 0, width: '100%', scrollbarColor: m.scrollbar, scrollbarWidth: 8 }}
    >
      <div key="head" style={{ height: 14 }} />
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
              <Meta color={m.textFaint}>Stop ⌘.</Meta>
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

function Tab({ thread, active, unread, onPick }: { thread: Thread; active: boolean; unread: number; onPick: () => void }) {
  const m = useM()
  return (
    <div
      testId={`tab-${thread.id}`}
      onClick={onPick}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        height: tabHeight,
        flexShrink: 1,
        minWidth: 90,
        maxWidth: 240,
        paddingLeft: 10,
        paddingRight: 10,
        borderTopLeftRadius: concentric(windowRadius, shellInset),
        borderTopRightRadius: concentric(windowRadius, shellInset),
        backgroundColor: active ? m.pane : '#00000000',
        hover: active ? undefined : { backgroundColor: m.hover },
      }}
    >
      {thread.running ? <Dot color={m.accent} size={6} /> : <Icon name="note" size={13} color={active ? m.text : m.textFaint} />}
      <text style={{ flexGrow: 1, flexShrink: 1, minWidth: 0, fontSize: 13, lineHeight: 16, fontWeight: active ? 500 : 400, color: active ? m.text : m.textMuted, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
        {thread.title}
      </text>
      {unread ? (
        <div style={{ height: 15, minWidth: 15, paddingLeft: 4, paddingRight: 4, borderRadius: 8, backgroundColor: m.text, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <text style={{ fontSize: 10, lineHeight: 12, fontWeight: 600, color: m.pane }}>{String(unread)}</text>
        </div>
      ) : null}
      <text style={{ fontSize: 11.5, lineHeight: 14, color: m.textFaint, flexShrink: 0 }}>{clock(thread.updatedAt)}</text>
    </div>
  )
}

function TabBar({
  tabs,
  activeId,
  unread,
  onPick,
  onSwitcher,
  onNew,
  onToggleMaterial,
}: {
  tabs: Thread[]
  activeId?: string
  unread: Record<string, number>
  onPick: (id: string) => void
  onSwitcher: () => void
  onNew: () => void
  onToggleMaterial: () => void
}) {
  const m = useM()
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'end', height: headerHeight, flexShrink: 0, paddingLeft: 78, paddingRight: 4, gap: 2, userSelect: 'none' }}>
      <div style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'row', alignItems: 'end', gap: 2, overflow: 'hidden' }}>
        {tabs.map((t) => (
          <Tab key={t.id} thread={t} active={t.id === activeId} unread={unread[t.id] ?? 0} onPick={() => onPick(t.id)} />
        ))}
        <div style={{ height: tabHeight, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <Quiet onPress={onNew} testId="new-thread" title="New note (⌘N)">
            <Icon name="plus" size={14} />
          </Quiet>
        </div>
      </div>
      <div style={{ height: tabHeight, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 2, flexShrink: 0 }}>
        <Quiet onPress={onSwitcher} testId="open-switcher" title="Find a note (⌘K)">
          <Icon name="search" size={13} />
          <Meta color={m.textFaint}>⌘K</Meta>
        </Quiet>
        <Quiet onPress={onToggleMaterial} testId="toggle-material" title="Toggle smoke and frost (⌘⇧L)">
          <Icon name={m.name === 'smoke' ? 'moon' : 'sun'} size={13} />
        </Quiet>
      </div>
    </div>
  )
}

function MenuItem({ label, hint, onPress, disabled, testId }: { label: string; hint?: string; onPress: () => void; disabled?: boolean; testId?: string }) {
  const m = useM()
  return (
    <div
      testId={testId}
      onClick={disabled ? undefined : onPress}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        height: 28,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: concentric(radiusBase + 4, 4),
        hover: disabled ? undefined : { backgroundColor: m.popupHover },
      }}
    >
      <text style={{ flexGrow: 1, fontSize: 13, lineHeight: 16, color: disabled ? m.textFaint : m.text }}>{label}</text>
      {hint ? <Meta>{hint}</Meta> : null}
    </div>
  )
}

/** The page title with its menu, and the account the note runs on. */
function PageTitle({
  thread,
  profile,
  canOpenClaude,
  onRename,
  onOpenClaude,
  onClose,
}: {
  thread: Thread
  profile?: Profile
  canOpenClaude: boolean
  onRename: (title: string) => void
  onOpenClaude: () => void
  onClose: () => void
}) {
  const m = useM()
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(thread.title)
  useEffect(() => {
    setRenaming(false)
    setMenu(false)
  }, [thread.id])
  const finishRename = () => {
    const next = name.trim()
    if (next && next !== thread.title) onRename(next)
    setRenaming(false)
  }
  const pick = (f: () => void) => () => {
    setMenu(false)
    f()
  }
  const folder = thread.workspace.replace(homedir(), '~')
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: 48, flexShrink: 0, paddingLeft: 12, paddingRight: 16, gap: 8, userSelect: 'none' }}>
      <div style={{ position: 'relative', flexShrink: 1, minWidth: 0 }}>
        {renaming ? (
          <input
            testId="title-input"
            value={name}
            autoFocus
            onChange={(e) => setName(e.value ?? '')}
            onSubmit={finishRename}
            onKeyDown={(e) => {
              if (e.key === 'escape') {
                e.preventDefault()
                setRenaming(false)
              }
            }}
            theme={{ caret: m.text, textFaint: m.textFaint }}
            style={{ width: 360, height: 30, paddingLeft: 8, paddingRight: 8, fontSize: 17, lineHeight: 22, fontWeight: 600, color: m.text, backgroundColor: m.codeBg, borderRadius: concentric(radiusBase, 2), borderWidth: 0 }}
          />
        ) : (
          <Quiet onPress={() => setMenu((v) => !v)} testId="title-menu" title="Note menu" style={{ height: 30, paddingLeft: 8, paddingRight: 6 }}>
            <text style={{ fontSize: 17, lineHeight: 22, fontWeight: 600, color: m.text, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{thread.title}</text>
            <Icon name="chevronDown" size={13} color={m.textMuted} />
          </Quiet>
        )}
        {menu ? (
          <DismissableLayer onEscapeKeyDown={() => setMenu(false)}>
            <FloatingLayer
              side="bottom"
              align="start"
              sideOffset={4}
              style={{ width: 280, padding: 4, backgroundColor: m.popup, borderRadius: concentric(radiusBase + 4, 0), borderWidth: 1, borderColor: m.border, boxShadow: { offsetX: 0, offsetY: 8, blurRadius: 24, spreadRadius: 0, color: m.shadow } }}
            >
              <div onMouseDownOutside={() => setMenu(false)} style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: 8, paddingRight: 8, paddingTop: 6, paddingBottom: 8 }}>
                  <Meta color={m.textMuted}>{folder}</Meta>
                  <Meta>{`${profile?.name ?? thread.profileId}${thread.model ? ` · ${thread.model}` : ''}`}</Meta>
                </div>
                <MenuItem
                  label="Rename"
                  testId="menu-rename"
                  onPress={pick(() => {
                    setName(thread.title)
                    setRenaming(true)
                  })}
                />
                <MenuItem label="Open in Claude Code" testId="menu-open-claude" disabled={!canOpenClaude} onPress={pick(onOpenClaude)} />
                <MenuItem label="Show folder in Finder" onPress={pick(() => Bun.spawn(['open', thread.workspace]))} />
                <MenuItem label="Close tab" hint="⇧⌘W" testId="menu-close" onPress={pick(onClose)} />
              </div>
            </FloatingLayer>
          </DismissableLayer>
        ) : null}
      </div>
      <div style={{ flexGrow: 1 }} />
      {profile ? (
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Dot color={profile.color} />
          <Meta color={m.textMuted}>{profile.name}</Meta>
        </div>
      ) : null}
    </div>
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
      <TerminalBlock session={pane.session} title={pane.session.argv.join(' ')} mode="full" autoFocus testId="pane-term" />
    </div>
  )
}

// ---------------------------------------------------------------- app

function initialMaterial(): MaterialName {
  return readSettings().material ?? (systemAppearance() === 'dark' ? 'smoke' : 'frost')
}

function App() {
  const renderer = useGpuixRequired()
  const windowSize = useWindowSize()
  const [materialName, setMaterialName] = useState<MaterialName>(initialMaterial)
  const material = useMemo(() => {
    const base = materialName === 'smoke' ? smoke : frost
    return SOLID ? solid(base) : base
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
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => readJson(paths.drafts, {}))
  const [overlay, setOverlay] = useState<null | 'new' | 'switcher'>(null)
  const [pane, setPane] = useState<Pane | null>(null)
  const composerRef = useRef<PublicInstance>(null)
  const runners = useRef(new Map<string, ClaudeRunner>())
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

  const focusComposer = useCallback(() => {
    const id = composerRef.current?.id
    if (id != null) renderer.focusElement?.(id)
  }, [renderer])

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
      const kept = Object.fromEntries(Object.entries(drafts).filter(([, d]) => d.text))
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
      runner = new ClaudeRunner(
        { threadId: thread.id, workspace: thread.workspace, profile, sessionId: thread.claudeSessionId },
        {
          line(raw, ev) {
            appendLine(thread.id, raw)
            dispatch(thread.id, ev)
            if (ev.type === 'assistant') setLoggedIn(profile.id, true)
            if (ev.type === 'result' && /not logged in/i.test(String(ev.result ?? ''))) setLoggedIn(profile.id, false)
            if (ev.type === 'result' && activeRef.current !== thread.id) setUnread((u) => ({ ...u, [thread.id]: (u[thread.id] ?? 0) + 1 }))
          },
          record(rec) {
            record(thread.id, rec)
          },
        },
      )
      runners.current.set(thread.id, runner)
      return runner
    },
    [dispatch, record, setLoggedIn],
  )

  // ---- actions

  const terminalCols = Math.max(40, Math.floor((Math.min(readingWidth, windowSize.width - shellInset * 2) - 56 - 22) / 7.2))

  const runShell = useCallback(
    (thread: Thread, command: string) => {
      const termId = `sh-${Date.now().toString(36)}`
      record(thread.id, { type: 'vellum/shell', termId, command, at: new Date().toISOString() })
      const session = startTerm({
        id: termId,
        argv: [process.env.SHELL ?? '/bin/zsh', '-lc', command],
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

  const setDraft = useCallback((threadId: string, text: string, tags: Tag[]) => {
    setDrafts((d) => ({ ...d, [threadId]: { text, tags } }))
  }, [])

  const draftsRef = useRef(drafts)
  draftsRef.current = drafts

  /** Ctrl+Enter: send what was written at the end, plus any edits made to earlier text. */
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
    if (!text && !edits) return
    if (thread.running) return
    if (pane?.kind === 'claude' && pane.threadId === thread.id) return
    const tags = tagsIn(text, d.tags)
    record(thread.id, { type: 'vellum/user', text, tags, at: new Date().toISOString() })
    if (edits) record(thread.id, { type: 'vellum/synced' })
    if (text && !thread.blocks.some((b) => b.kind === 'user') && (thread.title === 'Untitled' || thread.title === 'New thread')) {
      record(thread.id, { type: 'vellum/title', title: titleFrom(text) })
    }
    runnerFor(thread).send([edits, text ? promptFor(text, tags) : ''].filter(Boolean).join('\n\n'))
    setDraft(thread.id, '', [])
  }, [pane, record, runShell, runnerFor, setDraft])
  const sendRef = useRef(send)
  sendRef.current = send

  const openNote = useCallback((id: string) => {
    setTabs((t) => (t.includes(id) ? t : [...t, id]))
    setActiveId(id)
  }, [])

  const closeTab = useCallback(
    (id: string) => {
      const i = tabs.indexOf(id)
      const next = tabs.filter((x) => x !== id)
      setTabs(next)
      if (id === activeId) setActiveId(next[Math.min(Math.max(i, 0), next.length - 1)])
    },
    [tabs, activeId],
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

  const openLogin = useCallback((profileId: string) => {
    const profile = profilesRef.current.find((p) => p.id === profileId)
    if (!profile) return
    setOverlay(null)
    const session = startTerm({ argv: ['claude'], cwd: homedir(), env: profileEnv(profile), cols: 100, rows: 30 })
    setPane({ kind: 'login', profileId, session })
    session.exited.then(() => setPane((p) => (p?.session === session ? null : p)))
  }, [])

  const openClaude = useCallback(() => {
    if (!active?.claudeSessionId) return
    const profile = profilesRef.current.find((p) => p.id === active.profileId)
    if (!profile) return
    // One writer per session: stop the headless process while the interactive one runs.
    runners.current.get(active.id)?.interrupt()
    const session = startTerm({
      argv: ['claude', '--resume', active.claudeSessionId],
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
      const next = n === 'smoke' ? 'frost' : 'smoke'
      updateSettings({ material: next })
      return next
    })
  }, [])

  const actions: BlockActions = useMemo(
    () => ({
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
    [active?.id, active?.profileId, focusComposer, openLogin, record, setDraft],
  )

  // ---- shortcuts

  shortcuts.current = (e: KeyEvent) => {
    const mods = e.modifiers
    if (!mods?.cmd) return
    const key = (e.key ?? '').toLowerCase()
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
      const step = key === '[' || key === '{' || key === 'bracketleft' ? -1 : 1
      const i = activeId ? tabs.indexOf(activeId) : -1
      if (tabs.length) setActiveId(tabs[(i + step + tabs.length) % tabs.length])
    } else if (key === 'k') {
      e.preventDefault()
      setOverlay((o) => (o === 'switcher' ? null : 'switcher'))
    } else if (key === '.') {
      e.preventDefault()
      interrupt()
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
      killAllRunners()
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

  const m = material
  const paneRadius = concentric(windowRadius, shellInset)
  const loginProfile = pane?.kind === 'login' ? profiles.find((p) => p.id === pane.profileId) : undefined
  const tabThreads = tabs.map((id) => threads.find((t) => t.id === id)).filter((t): t is Thread => Boolean(t))
  const editsWaiting = active ? pendingEdits(active).length > 0 : false
  const placeholder = !active?.blocks.length
    ? 'Start writing.  Ctrl+Enter asks Claude · ! runs a command · @ tags a file'
    : editsWaiting
      ? 'Ctrl+Enter tells Claude about your edits'
      : 'Keep writing…'

  return (
    <MaterialContext.Provider value={material}>
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          paddingLeft: shellInset,
          paddingRight: shellInset,
          paddingBottom: shellInset,
          backgroundColor: m.rootTint,
          fontFamily: font.sans,
          color: m.text,
          selectionColor: m.appearance === 'dark' ? '#7aa2e855' : '#1447e633',
        }}
      >
        <TabBar
          tabs={tabThreads}
          activeId={activeId}
          unread={unread}
          onPick={(id) => {
            setActiveId(id)
            setTimeout(focusComposer, 50)
          }}
          onSwitcher={() => setOverlay('switcher')}
          onNew={() => setOverlay('new')}
          onToggleMaterial={toggleMaterial}
        />
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
          }}
        >
          {pane ? (
            <TerminalPane
              pane={pane}
              title={pane.kind === 'login' ? `Log in · ${loginProfile?.name ?? ''}` : 'Claude Code'}
              hint={pane.kind === 'login' ? 'Type /login and finish in the browser, then /exit.' : 'Interactive session on this note. Quit claude or close to return.'}
              onClose={closePane}
            />
          ) : active ? (
            <>
              <PageTitle
                thread={active}
                profile={activeProfile}
                canOpenClaude={Boolean(active.claudeSessionId)}
                onRename={(title) => record(active.id, { type: 'vellum/title', title })}
                onOpenClaude={openClaude}
                onClose={() => closeTab(active.id)}
              />
              <Document
                thread={active}
                actions={actions}
                onStop={interrupt}
                onTailClick={focusComposer}
                composer={
                  <Composer
                    value={draft.text}
                    tags={draft.tags}
                    onChange={(text, tags) => setDraft(active.id, text, tags)}
                    onSend={send}
                    profile={activeProfile}
                    workspace={active.workspace}
                    placeholder={placeholder}
                    composerRef={composerRef}
                  />
                }
              />
            </>
          ) : (
            <EmptyState onNew={() => setOverlay('new')} />
          )}
        </div>
        {overlay === 'new' ? (
          <NewThreadDialog
            open
            onClose={() => setOverlay(null)}
            profiles={profiles}
            recentFolders={recentFolders}
            initialProfileId={active?.profileId}
            suggestProfile={(folder) => profileForWorkspace(profiles, folder)?.id}
            onCreate={createThread}
            onAddProfile={(name) => setProfiles(createProfile(name))}
            onLogin={openLogin}
          />
        ) : null}
        {overlay === 'switcher' ? (
          <ThreadSwitcher
            open
            onClose={() => setOverlay(null)}
            threads={threads}
            profiles={profiles}
            activeId={activeId}
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
  titlebarTransparent: true,
  windowBackground: SOLID ? 'opaque' : 'blurred',
  trafficLightX: 16,
  trafficLightY: 17,
  keyboardFocusDim: false,
  focus: process.env.GPUIX_BACKGROUND !== '1',
  onKeyDown(event) {
    shortcuts.current?.(event)
  },
})
