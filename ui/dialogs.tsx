// New note: the project first, with an agent/account selector.
// Overlays use the opaque popup token: GPUIX can only blur the whole window.

import { useRef, useState, type ReactNode } from 'react'
import {
  useGpuixRequired,
  type PublicInstance,
} from '@gpuix/react'
import { Button } from '@gpuix/react/button'
import path from 'node:path'
import type { Profile } from '../core/profiles'
import { agentChoices, agentFor, type AgentId } from '../core/agents'
import { Dot, Icon, Meta, Quiet, useM } from './kit'
import { closedByOutsidePress, Menu, Segmented, Sheet } from '../components'
import { keys, primary } from '../core/platform'
import { accentFor, concentric, radiusXl, shortPath } from './theme'
import { useLoaded } from './useLoaded'

function SectionLabel({ children }: { children: ReactNode }) {
  const m = useM()
  return <text style={{ fontSize: 12, lineHeight: 16, color: m.textMuted, fontWeight: 500 }}>{children}</text>
}

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
        height: 34,
        paddingLeft: 14,
        paddingRight: 14,
        borderRadius: 8,
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
      <text style={{ fontSize: 13, lineHeight: 16, color: m.pane, fontWeight: 500 }}>{children}</text>
      {shortcut ? <text style={{ fontSize: 11, lineHeight: 16, color: m.pane, opacity: 0.6 }}>{keys(shortcut)}</text> : null}
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
  const [folder, setFolder] = useState<string | undefined>(initialFolder ?? recentFolders[0])
  const [profileId, setProfileId] = useState<string | undefined>(() =>
    initialFolder ? initialProfileId : (recentFolders[0] && suggestProfile(recentFolders[0])) || initialProfileId || profiles[0]?.id,
  )
  const shownFolders = [...new Set([initialFolder, ...recentFolders].filter((item): item is string => Boolean(item)))].slice(0, 5)
  const folders = folder && !shownFolders.includes(folder) ? [folder, ...shownFolders] : shownFolders
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
    <Sheet open={open} onClose={onClose} width={440} initialFocus={root} testId="new-note">
      <div ref={root} testId="new-note-body" tabIndex={0} onKeyDown={(event) => {
        if (primary(event.modifiers) && event.key === 'enter') { event.preventDefault(); event.stopPropagation(); if (!adding) create() }
      }} style={{ display: 'flex', flexDirection: 'column', keyboardFocusDim: false }}>
        <div style={{ padding: 20, paddingBottom: 14 }}>
          <text style={{ fontSize: 16, lineHeight: 22, color: m.text, fontWeight: 600 }}>New note</text>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 16, paddingRight: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', paddingLeft: 6, paddingRight: 4 }}>
            <SectionLabel>Project</SectionLabel>
            <div style={{ flexGrow: 1 }} />
            <Quiet onPress={browse} testId="choose-folder" title="Choose another project folder"><Icon name="folderPlus" size={13} /><Meta color={m.textMuted}>Choose folder…</Meta></Quiet>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {folders.map((item) => {
              const selected = item === folder
              const recentIndex = shownFolders.indexOf(item)
              return <Button key={item} onClick={() => chooseFolder(item)} testId={recentIndex >= 0 ? `recent-${recentIndex}` : 'selected-folder'} aria-label={`Use ${item}`} aria-pressed={selected} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingLeft: 12, paddingRight: 12, borderRadius: 10, borderWidth: 1, borderColor: selected ? m.borderFocused : '#00000000', backgroundColor: selected ? m.popupHover : '#00000000', hover: { backgroundColor: m.popupHover }, focusVisible: { outlineWidth: 2, outlineColor: m.focusRing }, cursor: 'pointer' }}>
                <Icon name={selected ? 'folderOpen' : 'folderClosed'} size={18} color={selected ? m.textUi : m.textMuted} />
                <div style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <text style={{ fontSize: 13.5, lineHeight: 18, fontWeight: 500, color: m.text, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{path.basename(item) || item}</text>
                  <text style={{ fontSize: 11.5, lineHeight: 16, color: m.textMuted, whiteSpace: 'nowrap', textOverflow: 'ellipsis-start' }}>{shortPath(path.dirname(item))}</text>
                </div>
                {selected ? <Icon name="check" size={14} color={m.textUi} /> : null}
              </Button>
            })}
            {!folders.length ? <div style={{ padding: 14, borderRadius: 10, borderWidth: 1, borderColor: m.border }}><Meta color={m.textMuted}>Choose a folder to start your first project note.</Meta></div> : null}
          </div>
          {config.length ? <div testId="trust-warning" style={{ padding: 10, borderRadius: 8, backgroundColor: m.dangerBg }}><text style={{ fontSize: 12, lineHeight: 17, color: m.danger }}>{`This folder has ${config.join(', ')}. Its hooks and MCP servers can run without approval. Continue only if you trust this folder.`}</text></div> : null}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 20, paddingTop: 16, paddingBottom: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <SectionLabel>With</SectionLabel>
            <div style={{ position: 'relative', minWidth: 0, flexGrow: 1, display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
              <Quiet onPress={() => setAccountOpen((value) => !value && !closedByOutsidePress('new-note-account'))} testId="new-note-account" title="Choose an agent and account" style={{ height: 32, justifyContent: 'flex-start', paddingLeft: 10, paddingRight: 8, borderRadius: 8, backgroundColor: m.pane, borderWidth: 1, borderColor: m.border, gap: 8, maxWidth: '100%' }}>
                {profile ? <Dot color={accentFor(m, profiles, profile.id)} size={7} /> : null}
                <text style={{ fontSize: 12.5, lineHeight: 17, color: m.textUi, minWidth: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{profile ? `${agentFor(profile).title} · ${profile.name}` : 'Choose an account'}</text>
                <Icon name="chevronDown" size={12} color={m.textMuted} />
              </Quiet>
              <Menu open={accountOpen} onClose={() => setAccountOpen(false)} width={300} side="top" testId="new-note-accounts" closeKey="new-note-account" items={[
                ...profiles.map((item) => ({ label: item.name, hint: agentFor(item).title, dot: accentFor(m, profiles, item.id), checked: item.id === profileId, testId: `profile-${item.id}`, onSelect: () => setProfileId(item.id) })),
                { kind: 'separator' },
                { label: 'Add account…', icon: 'plus', testId: 'add-profile', onSelect: () => setAdding(true) },
              ]} />
            </div>
          </div>
          {profile?.loggedIn === false ? <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}><Meta color={m.textMuted}>Sign in to ask {agentFor(profile).title}.</Meta><Quiet onPress={() => onLogin(profile.id)} testId={`profile-login-${profile.id}`}><Meta color={m.textUi}>Log in</Meta></Quiet></div> : null}
          {adding ? (
            <div testId="new-profile-form" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: m.border }}>
            <div style={{ alignSelf: 'start' }}><Segmented<AgentId> testId="new-profile-agent" value={newAgent} onChange={setNewAgent} options={choices.map((c) => ({ value: c.agent.id, label: c.agent.title }))} width={84} /></div>
            {cannot ? <Meta color={m.textMuted}>{cannot}</Meta> : null}
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <div style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, height: 30, paddingLeft: 8, paddingRight: 8, borderRadius: 8, borderWidth: 1, borderColor: m.border, display: 'flex', alignItems: 'center' }}>
                <input
                  testId="new-profile-name"
                  autoFocus
                  value={newName}
                  placeholder="Work"
                  onChange={(e) => setNewName(e.value ?? '')}
                  onSubmit={addProfile}
                  style={{ flexGrow: 1, minWidth: 0, fontSize: 13, color: m.text }}
                />
              </div>
              <Quiet onPress={() => setAdding(false)} style={{ height: 30 }}>
                <Meta color={m.textMuted}>Cancel</Meta>
              </Quiet>
              <Quiet onPress={addProfile} disabled={!newName.trim() || Boolean(cannot)} testId="new-profile-add" style={{ height: 30, paddingLeft: 12, paddingRight: 12 }}><Meta color={m.textUi}>Add</Meta></Quiet>
            </div>
            </div>
          ) : null}
        </div>

        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'end', gap: 8, padding: 20, paddingTop: 2 }}>
          <Quiet onPress={onClose} testId="new-note-cancel">
            <text style={{ fontSize: 13, lineHeight: 16, color: m.textMuted }}>Cancel</text>
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
