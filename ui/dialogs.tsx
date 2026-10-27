// New note: the project first, with an agent/account selector.
// Overlays use the opaque popup token: GPUIX can only blur the whole window.

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import {
  useGpuixRequired,
  type PublicInstance,
} from '@gpuix/react'
import { Button } from '@gpuix/react/button'
import path from 'node:path'
import type { Profile } from '../core/profiles'
import { agentChoices, agentFor, type AgentId } from '../core/agents'
import { Dot, FileIcon, Icon, Meta, Quiet, useM } from './kit'
import { closedByOutsidePress, Field, Label, Menu, Scroll, Segmented, Sheet } from '../components'
import { keys, primary } from '../core/platform'
import { accentFor, concentric, radiusBase, radiusXl, shortPath, type } from './theme'
import { langIcons } from './langIcons'
import { useLoaded } from './useLoaded'

/** A folder's own mark, then its stack's language glyph, then its initials. Never a mystery box. */
const ICON_FILES = ['icon.png', 'logo.png', 'logo.svg', 'icon.svg', 'favicon.ico', 'apple-touch-icon.png', 'app-icon.png']
const MANIFESTS: Array<[file: string, stack: string]> = [
  ['package.json', 'Node'], ['deno.json', 'Deno'], ['bunfig.toml', 'Bun'],
  ['Cargo.toml', 'Rust'], ['go.mod', 'Go'], ['Package.swift', 'Swift'],
  ['pyproject.toml', 'Python'], ['requirements.txt', 'Python'], ['setup.py', 'Python'],
  ['Gemfile', 'Ruby'], ['pom.xml', 'Maven'], ['build.gradle', 'Gradle'], ['build.gradle.kts', 'Gradle'],
  ['composer.json', 'PHP'], ['CMakeLists.txt', 'C++'], ['Makefile', 'C'],
]

type ProjectMark = { icon?: string; stack?: string; manifest?: string }

async function detectProject(folder: string): Promise<ProjectMark> {
  for (const file of ICON_FILES) {
    if (await Bun.file(path.join(folder, file)).exists()) return { icon: path.join(folder, file) }
  }
  for (const [file, stack] of MANIFESTS) {
    if (await Bun.file(path.join(folder, file)).exists()) return { stack, manifest: path.join(folder, file) }
  }
  return {}
}

/** One tile of the project grid: a radio with a real mark, name and stack-or-path note. */
function ProjectTile({ folder, selected, onPick, onMove, nodeRef, testId }: {
  folder: string
  selected: boolean
  onPick: () => void
  onMove: (dx: number, dy: number) => void
  nodeRef: (node: PublicInstance | null) => void
  testId?: string
}) {
  const m = useM()
  const [mark, setMark] = useState<ProjectMark>({})
  useEffect(() => {
    let live = true
    detectProject(folder).then((found) => { if (live) setMark(found) })
    return () => { live = false }
  }, [folder])
  const base = path.basename(folder) || folder
  const dir = shortPath(path.dirname(folder))
  const initials = base.split(/[-_ ]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')
  return (
    <Button
      ref={nodeRef}
      testId={testId}
      aria-label={folder}
      aria-selected={selected}
      onClick={onPick}
      onKeyDown={(event) => {
        if (event.key === 'left') { event.preventDefault(); onMove(-1, 0) }
        else if (event.key === 'right') { event.preventDefault(); onMove(1, 0) }
        else if (event.key === 'up') { event.preventDefault(); onMove(0, -1) }
        else if (event.key === 'down') { event.preventDefault(); onMove(0, 1) }
        else if (event.key === 'enter' || event.key === 'space') { event.preventDefault(); onPick() }
      }}
      style={{
        flexGrow: 1,
        flexBasis: 0,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        paddingTop: 14,
        paddingBottom: 12,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: radiusBase,
        borderWidth: 1,
        borderColor: selected ? m.borderFocused : m.border,
        backgroundColor: selected ? m.selected : '#00000000',
        cursor: 'pointer',
        hover: { backgroundColor: selected ? m.selected : m.popupHover },
        focusVisible: { outlineWidth: 2, outlineColor: m.focusRing, outlineOffset: -1 },
      }}
    >
      {mark.icon ? (
        <img src={mark.icon} objectFit="cover" style={{ width: 40, height: 40, borderRadius: 10, borderWidth: 1, borderColor: m.border }} />
      ) : mark.stack && langIcons[mark.stack] ? (
        <div style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: '#ffffff', borderWidth: 1, borderColor: m.border, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <img src={langIcons[mark.stack]} objectFit="contain" style={{ width: 28, height: 28 }} />
        </div>
      ) : mark.manifest ? (
        <div style={{ width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><FileIcon path={mark.manifest} size={30} /></div>
      ) : (
        <div style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: m.chipBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><text style={{ fontSize: 15, lineHeight: 20, fontWeight: 600, color: m.textMuted }}>{initials || '?'}</text></div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, width: '100%', minWidth: 0 }}>
        <text style={{ ...type.label, fontWeight: 500, color: m.text, whiteSpace: 'nowrap', textOverflow: 'ellipsis', maxWidth: '100%' }}>{base}</text>
        <text style={{ fontSize: 11.5, lineHeight: 16, color: m.textMuted, whiteSpace: 'nowrap', textOverflow: 'ellipsis-start', maxWidth: '100%' }}>{mark.stack ? `${mark.stack} · ${dir}` : dir}</text>
      </div>
    </Button>
  )
}

/** A selectable row in a dialog list (recipes reuse it): quiet fill, hover wash, token radius. */
export function Row({ selected, onPress, children, testId }: { selected?: boolean; onPress: () => void; children: ReactNode; testId?: string }) {
  const m = useM()
  return (
    <Button
      testId={testId}
      onClick={onPress}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        minHeight: 34,
        paddingLeft: 10,
        paddingRight: 6,
        borderRadius: concentric(radiusXl, 8),
        backgroundColor: selected ? m.popupHover : m.popup,
        cursor: 'pointer',
        hover: { backgroundColor: m.popupHover },
        focusVisible: { outlineWidth: 2, outlineColor: m.focusRing },
      }}
    >
      {children}
    </Button>
  )
}

function PrimaryButton({ children, onPress, disabled, testId, shortcut }: { children: ReactNode; onPress: () => void; disabled?: boolean; testId?: string; shortcut?: string }) {
  const m = useM()
  return (
    <Button
      testId={testId}
      disabled={disabled}
      onClick={onPress}
      onKeyDown={(event) => { if (primary(event.modifiers) && event.key === 'enter') event.preventDefault() }}
      style={{
        height: 32,
        paddingLeft: 14,
        paddingRight: 14,
        borderRadius: concentric(radiusBase, 2),
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        // Inverted neutral: violet is kept for the agent's own identity.
        backgroundColor: m.text,
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? 'default' : 'pointer',
        hover: disabled ? undefined : { opacity: 0.9 },
        active: disabled ? undefined : { opacity: 0.8 },
        focusVisible: { outlineWidth: 2, outlineColor: m.focusRing, outlineOffset: 2 },
      }}
    >
      <text style={{ ...type.label, fontWeight: 500, color: m.pane }}>{children}</text>
      {shortcut ? <text style={{ ...type.caption, color: m.pane, opacity: 0.6 }}>{keys(shortcut)}</text> : null}
    </Button>
  )
}

export function NewThreadDialog({
  open,
  onClose,
  profiles,
  recentFolders,
  suggestProfile,
  initialProfileId,
  initialFolder,
  onCreate,
  onAddProfile,
  onLogin,
}: {
  open: boolean
  onClose: () => void
  profiles: Profile[]
  recentFolders: string[]
  suggestProfile: (folder: string) => string | undefined
  initialProfileId?: string
  /** The current note's folder: the dialog starts there, on that note's account. */
  initialFolder?: string
  onCreate: (profileId: string, folder: string) => void
  onAddProfile: (name: string, agent: AgentId) => void
  onLogin: (profileId: string) => void
}) {
  const m = useM()
  const renderer = useGpuixRequired()
  const root = useRef<PublicInstance>(null)
  const searchRef = useRef<PublicInstance>(null)
  const tiles = useRef(new Map<number, PublicInstance>())
  const [folder, setFolder] = useState<string | undefined>(initialFolder ?? recentFolders[0])
  const [profileId, setProfileId] = useState<string | undefined>(() =>
    initialFolder ? initialProfileId : (recentFolders[0] && suggestProfile(recentFolders[0])) || initialProfileId || profiles[0]?.id,
  )
  const [query, setQuery] = useState('')
  const shownFolders = [...new Set([initialFolder, ...recentFolders].filter((item): item is string => Boolean(item)))]
  const folders = folder && !shownFolders.includes(folder) ? [folder, ...shownFolders] : shownFolders
  // The grid filters as you type; a hidden selection follows the first match (ModelPicker precedent).
  const visible = folders.filter((item) => {
    const q = query.trim().toLowerCase()
    return !q || path.basename(item).toLowerCase().includes(q) || item.toLowerCase().includes(q)
  })
  useEffect(() => {
    if (folder && !visible.includes(folder) && visible[0]) void chooseFolder(visible[0])
  }, [query])
  const COLS = 3
  const rows: string[][] = []
  for (let i = 0; i < visible.length; i += COLS) rows.push(visible.slice(i, i + COLS))
  const move = (from: number, dx: number, dy: number) => {
    if (!visible.length) return
    const next = (from + dx + dy * COLS + visible.length * COLS) % visible.length
    const item = visible[next]
    if (item && item !== folder) void chooseFolder(item)
    const node = tiles.current.get(next)
    if (node) {
      renderer.focusElement?.(node.id)
      renderer.scrollIntoView?.(node.id)
    }
  }
  const config = useLoaded(() => (folder ? projectConfig(folder) : Promise.resolve([])), [folder]) ?? []
  const [adding, setAdding] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newAgent, setNewAgent] = useState<AgentId>('claude')
  const choices = agentChoices(profiles)
  const cannot = choices.find((c) => c.agent.id === newAgent)?.why
  const profile = profiles.find((item) => item.id === profileId)
  const addProfile = () => {
    if (!newName.trim() || cannot) return
    onAddProfile(newName.trim(), newAgent)
    setNewName('')
    setNewAgent('claude')
    setAdding(false)
  }

  const chooseFolder = async (path: string) => {
    setFolder(path)
    const suggested = suggestProfile(path)
    if (suggested) setProfileId(suggested)
  }

  const browse = async () => {
    const picked = await renderer.promptForPaths?.({ directories: true, files: false, multiple: false, prompt: 'Use folder' })
    if (picked?.[0]) chooseFolder(picked[0])
  }

  const ready = Boolean(profile && folder)
  const create = () => { if (profile && folder) onCreate(profile.id, folder) }
  return (
    <Sheet open={open} onClose={onClose} width={440} initialFocus={searchRef} testId="new-note">
      <div ref={root} testId="new-note-body" tabIndex={0} onKeyDown={(event) => {
        if (primary(event.modifiers) && event.key === 'enter') { event.preventDefault(); event.stopPropagation(); if (!adding) create() }
      }} style={{ display: 'flex', flexDirection: 'column', keyboardFocusDim: false }}>
        <div style={{ padding: 18, paddingBottom: 12 }}>
          <text style={{ ...type.title, fontWeight: 600, color: m.text }}>New note</text>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 18, paddingRight: 18 }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <div style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, height: 34, paddingLeft: 10, paddingRight: 6, borderRadius: concentric(radiusBase, 2), backgroundColor: m.chipBg }}>
              <Icon name="search" size={13} color={m.textMuted} />
              <input
                ref={searchRef}
                testId="new-note-search"
                value={query}
                placeholder="Search projects…"
                onChange={(e) => setQuery(e.value ?? '')}
                onSubmit={() => { if (!adding) create() }}
                style={{ flexGrow: 1, minWidth: 0, fontSize: 12.5, color: m.text }}
              />
              {query ? <Quiet onPress={() => setQuery('')} testId="new-note-search-clear" title="Clear search" style={{ width: 22, paddingLeft: 0, paddingRight: 0 }}><Icon name="x" size={11} /></Quiet> : null}
            </div>
            <Quiet onPress={browse} testId="choose-folder" title="Choose another project folder" style={{ height: 34, paddingLeft: 10, paddingRight: 10 }}><Icon name="folderPlus" size={13} /><Meta>Browse</Meta></Quiet>
          </div>
          <Scroll testId="new-note-grid-scroll" style={{ maxHeight: 340 }}>
          <div testId="new-note-grid" role="radiogroup" aria-label="Projects" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rows.map((row, r) => (
              <div key={r} style={{ display: 'flex', flexDirection: 'row', gap: 8 }}>
                {row.map((item) => {
                  const index = visible.indexOf(item)
                  const recentIndex = shownFolders.indexOf(item)
                  return <ProjectTile key={item} folder={item} selected={item === folder} onPick={() => chooseFolder(item)} onMove={(dx, dy) => move(index, dx, dy)} nodeRef={(node) => { if (node) tiles.current.set(index, node); else tiles.current.delete(index) }} testId={recentIndex >= 0 ? `recent-${recentIndex}` : 'selected-folder'} />
                })}
              </div>
            ))}
            {!folders.length ? <div style={{ padding: 14, borderRadius: radiusBase, borderWidth: 1, borderColor: m.border }}><Meta>Choose a folder to start your first project note.</Meta></div> : null}
            {folders.length && !visible.length ? <div style={{ padding: 14 }}><Meta>{`No projects match “${query.trim()}”.`}</Meta></div> : null}
          </div>
          </Scroll>
          <Meta>{query.trim() ? `${visible.length} of ${folders.length} · ` : ''}↑↓←→ move · ↵ select</Meta>
          {config.length ? <div testId="trust-warning" style={{ padding: 10, borderRadius: concentric(radiusBase, 2), backgroundColor: m.dangerBg }}><text style={{ fontSize: 12, lineHeight: 17, color: m.danger }}>{`This folder has ${config.join(', ')}. Its hooks and MCP servers can run without approval. Continue only if you trust this folder.`}</text></div> : null}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 18, paddingTop: 16, paddingBottom: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Label muted>With</Label>
            <div style={{ position: 'relative', minWidth: 0, flexGrow: 1, display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
              <Quiet onPress={() => setAccountOpen((value) => !value && !closedByOutsidePress('new-note-account'))} testId="new-note-account" title="Choose an agent and account" style={{ height: 32, justifyContent: 'flex-start', paddingLeft: 10, paddingRight: 8, borderRadius: concentric(radiusBase, 2), backgroundColor: m.pane, borderWidth: 1, borderColor: m.border, gap: 8, maxWidth: '100%' }}>
                {profile ? <Dot color={accentFor(m, profiles, profile.id)} size={7} /> : null}
                <text style={{ fontSize: 12.5, lineHeight: 16, color: m.textUi, minWidth: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{profile ? `${agentFor(profile).title} · ${profile.name}` : 'Choose an account'}</text>
                <Icon name="chevronDown" size={12} color={m.textMuted} />
              </Quiet>
              <Menu open={accountOpen} onClose={() => setAccountOpen(false)} width={300} side="top" testId="new-note-accounts" closeKey="new-note-account" items={[
                ...profiles.map((item) => ({ label: item.name, hint: agentFor(item).title, dot: accentFor(m, profiles, item.id), checked: item.id === profileId, testId: `profile-${item.id}`, onSelect: () => setProfileId(item.id) })),
                { kind: 'separator' },
                { label: 'Add account…', icon: 'plus', testId: 'add-profile', onSelect: () => setAdding(true) },
              ]} />
            </div>
          </div>
          {profile?.loggedIn === false ? <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}><Meta>Sign in to ask {agentFor(profile).title}.</Meta><Quiet onPress={() => onLogin(profile.id)} testId={`profile-login-${profile.id}`}><Meta color={m.textUi}>Log in</Meta></Quiet></div> : null}
          {adding ? (
            <div testId="new-profile-form" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12, borderRadius: radiusBase, borderWidth: 1, borderColor: m.border }}>
            <div style={{ alignSelf: 'start' }}><Segmented<AgentId> testId="new-profile-agent" value={newAgent} onChange={setNewAgent} options={choices.map((c) => ({ value: c.agent.id, label: c.agent.title }))} width={84} /></div>
            {cannot ? <Meta>{cannot}</Meta> : null}
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <Field testId="new-profile-name" autoFocus value={newName} placeholder="Work" onChange={setNewName} onSubmit={addProfile} style={{ flexGrow: 1 }} />
              <Quiet onPress={() => setAdding(false)} style={{ height: 32 }}>
                <Meta>Cancel</Meta>
              </Quiet>
              <Quiet onPress={addProfile} disabled={!newName.trim() || Boolean(cannot)} testId="new-profile-add" style={{ height: 32, paddingLeft: 12, paddingRight: 12 }}><Meta color={m.textUi}>Add</Meta></Quiet>
            </div>
            </div>
          ) : null}
        </div>

        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'end', gap: 8, padding: 18, paddingTop: 2 }}>
          <Quiet onPress={onClose} testId="new-note-cancel">
            <Label muted>Cancel</Label>
          </Quiet>
          <PrimaryButton testId="create-thread" disabled={!ready || adding} onPress={create} shortcut="⌘↵">
            Create note
          </PrimaryButton>
        </div>
      </div>
    </Sheet>
  )
}

/** Project files that make Claude Code run folder-provided config (hooks, MCP servers). */
async function projectConfig(folder: string): Promise<string[]> {
  const files = ['.mcp.json', '.claude/settings.json', '.claude/settings.local.json']
  const found = await Promise.all(files.map((f) => Bun.file(path.join(folder, f)).exists()))
  return files.filter((_, i) => found[i])
}

export function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}
