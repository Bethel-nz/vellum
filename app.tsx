// Vellum: a markdown note you can talk to. Drives the official `claude` CLI.
//
// Layout: one floating content pane on the glass (no sidebar). A slim header,
// the document (a bottom-aligned virtual list), and a plain composer at its end.
// Threads are reached with Cmd+K; Cmd+N starts one.

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { render, useGpuixRequired, useWindowSize, type KeyEvent, type PublicInstance } from '@gpuix/react'
import { ClaudeRunner, killAllRunners } from './core/claude'
import { createProfile, loadProfiles, profileEnv, profileForWorkspace, rememberWorkspace, updateProfile, type Profile } from './core/profiles'
import { readSettings, systemAppearance, updateSettings } from './core/store'
import { promptFor, tagsIn } from './core/tags'
import { killAllTerms, startTerm, type TermSession } from './core/term'
import {
  appendLine,
  appendRecord,
  loadThreads,
  newThread,
  newThreadId,
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
  readingWidth,
  shellInset,
  smoke,
  solid,
  windowRadius,
  type MaterialName,
} from './ui/theme'

const SOLID = process.env.VELLUM_SOLID === '1'
const FONT_DIR = path.join(import.meta.dir, 'assets', 'fonts')
const FONTS = ['Inter-Regular.ttf', 'Inter-Medium.ttf', 'Inter-SemiBold.ttf', 'Inter-Italic.ttf']

type Pane =
  | { kind: 'login'; profileId: string; session: TermSession }
  | { kind: 'claude'; threadId: string; session: TermSession }

type Draft = { text: string; tags: Tag[] }

// Window-level shortcuts are registered once in render(); App swaps the handler in.
const shortcuts: { current?: (e: KeyEvent) => void } = {}

// ---------------------------------------------------------------- document

function Paragraph({ children, kind }: { children: React.ReactNode; kind?: Block['kind'] | 'title' | 'status' }) {
  const top = kind === 'user' ? 22 : kind === 'title' ? 28 : 6
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', paddingTop: top, paddingBottom: 6 }}>
      <div style={{ width: '100%', maxWidth: readingWidth, paddingLeft: 28, paddingRight: 28 }}>{children}</div>
    </div>
  )
}

function TitleBlock({ thread, profile }: { thread: Thread; profile?: Profile }) {
  const m = useM()
  const created = new Date(thread.createdAt)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 4 }}>
      <text style={{ fontSize: 22, lineHeight: 28, fontWeight: 600, color: m.text }}>{thread.title}</text>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {profile ? <Dot color={profile.color} size={6} /> : null}
        <Meta>{`${profile?.name ?? thread.profileId} · ${thread.workspace.replace(homedir(), '~')} · ${created.toLocaleDateString([], { month: 'short', day: 'numeric' })}`}</Meta>
      </div>
    </div>
  )
}

const Document = memo(function Document({
  thread,
  profile,
  actions,
}: {
  thread: Thread
  profile?: Profile
  actions: BlockActions
}) {
  const m = useM()
  return (
    <virtual-list
      alignment="bottom"
      followTail
      estimatedItemHeight={90}
      overdraw={600}
      style={{ flexGrow: 1, minHeight: 0, width: '100%', scrollbarColor: m.scrollbar, scrollbarWidth: 8 }}
    >
      <Paragraph key="title" kind="title">
        <TitleBlock thread={thread} profile={profile} />
      </Paragraph>
      {thread.blocks.map((b) => (
        <Paragraph key={b.id} kind={b.kind}>
          <BlockView block={b} actions={actions} />
        </Paragraph>
      ))}
      {thread.running ? (
        <Paragraph key="working" kind="status">
          <Meta color={m.textMuted}>Working…</Meta>
        </Paragraph>
      ) : null}
      <div key="tail" style={{ height: 12 }} />
    </virtual-list>
  )
})

// ---------------------------------------------------------------- header

function Header({
  thread,
  canOpenClaude,
  onOpenClaude,
  onSwitcher,
  onNew,
  onToggleMaterial,
}: {
  thread?: Thread
  canOpenClaude: boolean
  onOpenClaude: () => void
  onSwitcher: () => void
  onNew: () => void
  onToggleMaterial: () => void
}) {
  const m = useM()
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        height: headerHeight,
        flexShrink: 0,
        paddingLeft: 78,
        paddingRight: 8,
        gap: 4,
        userSelect: 'none',
      }}
    >
      <div style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <text style={{ fontSize: 12.5, lineHeight: 16, color: m.textMuted, fontWeight: 500, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          {thread?.title ?? 'Vellum'}
        </text>
      </div>
      {thread ? (
        <Quiet onPress={onOpenClaude} disabled={!canOpenClaude} testId="open-claude" title="Open in Claude Code">
          <Icon name="terminal" size={13} />
          <Meta color={m.textMuted}>Open in Claude Code</Meta>
        </Quiet>
      ) : null}
      <Quiet onPress={onToggleMaterial} testId="toggle-material" title="Toggle smoke and frost (⌘⇧L)">
        <Icon name={m.name === 'smoke' ? 'moon' : 'sun'} size={13} />
      </Quiet>
      <Quiet onPress={onSwitcher} testId="open-switcher" title="Threads (⌘K)">
        <Icon name="search" size={13} />
        <Meta color={m.textFaint}>⌘K</Meta>
      </Quiet>
      <Quiet onPress={onNew} testId="new-thread" title="New thread (⌘N)">
        <Icon name="plus" size={14} />
      </Quiet>
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
        <text style={{ fontSize: 13, lineHeight: 16, color: m.text }}>New thread</text>
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
  const [threads, setThreads] = useState<Thread[]>(loadThreads)
  const [activeId, setActiveId] = useState<string | undefined>(() => {
    const last = readSettings().lastThreadId
    return threads.some((t) => t.id === last) ? last : threads[0]?.id
  })
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [overlay, setOverlay] = useState<null | 'new' | 'switcher'>(null)
  const [pane, setPane] = useState<Pane | null>(null)
  const composerRef = useRef<PublicInstance>(null)
  const runners = useRef(new Map<string, ClaudeRunner>())
  const profilesRef = useRef(profiles)
  profilesRef.current = profiles
  const threadsRef = useRef(threads)
  threadsRef.current = threads

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

  const focusComposer = useCallback(() => {
    const id = composerRef.current?.id
    if (id != null) renderer.focusElement?.(id)
  }, [renderer])

  // ---- thread state

  const dispatch = useCallback((threadId: string, ev: unknown) => {
    setThreads((prev) => prev.map((t) => (t.id === threadId ? reduce(t, ev) : t)))
  }, [])

  const record = useCallback(
    (threadId: string, rec: VellumRecord) => {
      appendRecord(threadId, rec)
      dispatch(threadId, rec)
    },
    [dispatch],
  )

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

  const send = useCallback(() => {
    if (!active) return
    const text = draft.text.trim()
    if (!text) return
    if (text.startsWith('!')) {
      const command = text.slice(1).trim()
      if (command) runShell(active, command)
      setDraft(active.id, '', [])
      return
    }
    if (active.running) return
    if (pane?.kind === 'claude' && pane.threadId === active.id) return
    const tags = tagsIn(text, draft.tags)
    record(active.id, { type: 'vellum/user', text, tags, at: new Date().toISOString() })
    if (!active.blocks.some((b) => b.kind === 'user') && active.title === 'New thread') {
      record(active.id, { type: 'vellum/title', title: titleFrom(text) })
    }
    runnerFor(active).send(promptFor(text, tags))
    setDraft(active.id, '', [])
  }, [active, draft, pane, record, runShell, runnerFor, setDraft])

  const interrupt = useCallback(() => {
    if (active) runners.current.get(active.id)?.interrupt()
  }, [active])

  const createThread = useCallback(
    (profileId: string, folder: string) => {
      const meta = { id: newThreadId(), title: 'New thread', profileId, workspace: folder, createdAt: new Date().toISOString() }
      appendRecord(meta.id, { type: 'vellum/meta', meta })
      setThreads((prev) => [newThread(meta), ...prev])
      setProfiles(rememberWorkspace(profileId, folder))
      setActiveId(meta.id)
      setOverlay(null)
      setTimeout(focusComposer, 50)
    },
    [focusComposer],
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
      onLogin: () => active && openLogin(active.profileId),
      onSendOutput: (command, output) => {
        if (!active) return
        setDraft(active.id, `Output of \`${command}\`:\n\n\`\`\`\n${output}\n\`\`\`\n\n`, draft.tags)
        setTimeout(focusComposer, 30)
      },
      onReturnFocus: focusComposer,
    }),
    [active?.id, active?.profileId, draft.tags, focusComposer, openLogin, setDraft],
  )

  // ---- shortcuts

  shortcuts.current = (e: KeyEvent) => {
    const mods = e.modifiers
    if (!mods?.cmd) return
    const key = (e.key ?? '').toLowerCase()
    if (key === 'n' && !mods.shift) {
      e.preventDefault()
      setOverlay('new')
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

  return (
    <MaterialContext.Provider value={material}>
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'row',
          padding: shellInset,
          backgroundColor: m.rootTint,
          fontFamily: font.sans,
          color: m.text,
          selectionColor: m.appearance === 'dark' ? '#7aa2e855' : '#1447e633',
        }}
      >
        <div
          style={{
            flexGrow: 1,
            minWidth: 0,
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
          <Header
            thread={active}
            canOpenClaude={Boolean(active?.claudeSessionId) && !pane}
            onOpenClaude={openClaude}
            onSwitcher={() => setOverlay('switcher')}
            onNew={() => setOverlay('new')}
            onToggleMaterial={toggleMaterial}
          />
          {pane ? (
            <TerminalPane
              pane={pane}
              title={pane.kind === 'login' ? `Log in · ${loginProfile?.name ?? ''}` : 'Claude Code'}
              hint={pane.kind === 'login' ? 'Type /login and finish in the browser, then /exit.' : 'Interactive session on this thread. Quit claude or close to return.'}
              onClose={closePane}
            />
          ) : active ? (
            <>
              <Document thread={active} profile={activeProfile} actions={actions} />
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, paddingTop: 6, paddingBottom: 12 }}>
                <div style={{ width: '100%', maxWidth: readingWidth, paddingLeft: 28, paddingRight: 28 }}>
                  <div style={{ height: 1, backgroundColor: m.borderFaint, marginBottom: 12 }} />
                  <Composer
                    value={draft.text}
                    tags={draft.tags}
                    onChange={(text, tags) => setDraft(active.id, text, tags)}
                    onSend={send}
                    profile={activeProfile}
                    workspace={active.workspace}
                    model={active.model}
                    running={active.running}
                    onStop={interrupt}
                    onProfileClick={() => setOverlay('new')}
                    composerRef={composerRef}
                  />
                </div>
              </div>
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
              setActiveId(id)
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
