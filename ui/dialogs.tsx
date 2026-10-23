// Modal surfaces: "New thread" (which account, which folder) and the Cmd+K thread switcher.
// Overlays use the opaque popup token: GPUIX can only blur the whole window.

import { useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Dialog,
  DialogBackdrop,
  DialogPopup,
  DialogPortal,
  motion,
  useGpuixRequired,
  type KeyEvent,
  type PublicInstance,
} from '@gpuix/react'
import { Button } from '@gpuix/react/button'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { Profile } from '../core/profiles'
import type { Thread } from '../core/threads'
import { Dot, Icon, Kbd, Meta, Quiet, useM } from './kit'
import { concentric, font, motion as mo, radiusXl } from './theme'

function Sheet({ open, onClose, width, children, initialFocus }: { open: boolean; onClose: () => void; width: number; children: ReactNode; initialFocus?: React.RefObject<PublicInstance | null> }) {
  const m = useM()
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPortal>
        <DialogBackdrop style={{ backgroundColor: m.scrim }} />
        <DialogPopup
          initialFocus={initialFocus}
          style={{
            width,
            maxWidth: '92%',
            backgroundColor: m.popup,
            borderRadius: radiusXl,
            borderWidth: 1,
            borderColor: m.border,
            boxShadow: { offsetX: 0, offsetY: 18, blurRadius: 48, spreadRadius: 0, color: m.shadow },
            overflow: 'hidden',
          }}
        >
          <motion.div
            initial={{ opacity: 0, top: mo.popoverRise }}
            animate={{ opacity: 1, top: 0 }}
            transition={{ duration: mo.duration.sm, ease: mo.expoOut }}
            style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}
          >
            {children}
          </motion.div>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  const m = useM()
  return <text style={{ fontSize: 12, lineHeight: 16, color: m.textMuted, fontWeight: 500 }}>{children}</text>
}

function Row({ selected, onPress, children, testId }: { selected?: boolean; onPress: () => void; children: ReactNode; testId?: string }) {
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

function PrimaryButton({ children, onPress, disabled, testId }: { children: ReactNode; onPress: () => void; disabled?: boolean; testId?: string }) {
  const m = useM()
  return (
    <Button
      testId={testId}
      disabled={disabled}
      onClick={onPress}
      style={{
        height: 30,
        paddingLeft: 14,
        paddingRight: 14,
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        backgroundColor: m.accent,
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? 'default' : 'pointer',
        hover: disabled ? undefined : { opacity: 0.9 },
        active: disabled ? undefined : { opacity: 0.8 },
        focusVisible: { outlineWidth: 2, outlineColor: m.focusRing, outlineOffset: 2 },
      }}
    >
      <text style={{ fontSize: 13, lineHeight: 16, color: '#ffffff', fontWeight: 500 }}>{children}</text>
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
  onCreate: (profileId: string, folder: string) => void
  onAddProfile: (name: string) => void
  onLogin: (profileId: string) => void
}) {
  const m = useM()
  const renderer = useGpuixRequired()
  const [folder, setFolder] = useState<string | undefined>(recentFolders[0])
  const [profileId, setProfileId] = useState<string | undefined>(
    () => (recentFolders[0] && suggestProfile(recentFolders[0])) || initialProfileId || profiles[0]?.id,
  )
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')

  const chooseFolder = async (path: string) => {
    setFolder(path)
    const suggested = suggestProfile(path)
    if (suggested) setProfileId(suggested)
  }

  const browse = async () => {
    const picked = await renderer.promptForPaths?.({ directories: true, files: false, multiple: false, prompt: 'Use folder' })
    if (picked?.[0]) chooseFolder(picked[0])
  }

  const ready = Boolean(profileId && folder)
  return (
    <Sheet open={open} onClose={onClose} width={480}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 18 }}>
        <text style={{ fontSize: 15, lineHeight: 20, color: m.text, fontWeight: 600 }}>New thread</text>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <SectionLabel>Which account?</SectionLabel>
          {profiles.map((p) => (
            <Row key={p.id} selected={p.id === profileId} onPress={() => setProfileId(p.id)} testId={`profile-${p.id}`}>
              <Dot color={p.color} size={8} />
              <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 }}>
                <text style={{ fontSize: 13, lineHeight: 18, color: m.text }}>{p.name}</text>
                <text style={{ fontSize: 11, lineHeight: 14, color: m.textFaint, fontFamily: font.mono, whiteSpace: 'nowrap', textOverflow: 'ellipsis-start' }}>
                  {p.configDir ?? '~/.claude (Claude Code default)'}
                </text>
              </div>
              {p.loggedIn === false ? <Meta color={m.danger}>not logged in</Meta> : null}
              <Quiet onPress={() => onLogin(p.id)} title={`Log in to ${p.name}`}>
                <Meta color={m.textMuted}>Log in</Meta>
              </Quiet>
              {p.id === profileId ? <Icon name="chevronRight" size={12} color={m.textMuted} /> : null}
            </Row>
          ))}
          {adding ? (
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 10 }}>
              <div style={{ flexGrow: 1, height: 30, paddingLeft: 8, paddingRight: 8, borderRadius: 8, borderWidth: 1, borderColor: m.border, display: 'flex', alignItems: 'center' }}>
                <input
                  testId="new-profile-name"
                  autoFocus
                  value={newName}
                  placeholder="Account name, e.g. Work"
                  onChange={(e) => setNewName(e.value ?? '')}
                  onSubmit={() => {
                    if (newName.trim()) {
                      onAddProfile(newName.trim())
                      setNewName('')
                      setAdding(false)
                    }
                  }}
                  style={{ flexGrow: 1, minWidth: 0, fontSize: 13, color: m.text }}
                />
              </div>
              <Quiet onPress={() => setAdding(false)}>
                <Meta color={m.textMuted}>Cancel</Meta>
              </Quiet>
            </div>
          ) : (
            <Quiet onPress={() => setAdding(true)} style={{ alignSelf: 'start' }} testId="add-profile">
              <Icon name="plus" size={12} />
              <Meta color={m.textMuted}>Add account</Meta>
            </Quiet>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <SectionLabel>Which folder?</SectionLabel>
          {recentFolders.slice(0, 5).map((f) => (
            <Row key={f} selected={f === folder} onPress={() => chooseFolder(f)}>
              <Icon name="folder" size={13} />
              <text style={{ flexGrow: 1, minWidth: 0, fontSize: 12.5, lineHeight: 17, color: m.text, fontFamily: font.mono, whiteSpace: 'nowrap', textOverflow: 'ellipsis-start' }}>{f}</text>
            </Row>
          ))}
          {folder && !recentFolders.includes(folder) ? (
            <Row selected onPress={() => {}}>
              <Icon name="folder" size={13} />
              <text style={{ flexGrow: 1, minWidth: 0, fontSize: 12.5, lineHeight: 17, color: m.text, fontFamily: font.mono, whiteSpace: 'nowrap', textOverflow: 'ellipsis-start' }}>{folder}</text>
            </Row>
          ) : null}
          {folder && projectConfig(folder).length ? (
            <div style={{ padding: 10, borderRadius: concentric(radiusXl, 8), backgroundColor: m.dangerBg }}>
              <text style={{ fontSize: 12, lineHeight: 17, color: m.danger }}>
                {`This folder has ${projectConfig(folder).join(', ')}. Headless runs skip Claude Code's trust prompt, so its hooks and MCP servers run without asking. Only continue if you trust this folder.`}
              </text>
            </div>
          ) : null}
          <Quiet onPress={browse} style={{ alignSelf: 'start' }} testId="choose-folder">
            <Icon name="plus" size={12} />
            <Meta color={m.textMuted}>Choose folder…</Meta>
          </Quiet>
        </div>

        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'end', gap: 8 }}>
          <Quiet onPress={onClose}>
            <text style={{ fontSize: 13, lineHeight: 16, color: m.textMuted }}>Cancel</text>
          </Quiet>
          <PrimaryButton testId="create-thread" disabled={!ready} onPress={() => ready && onCreate(profileId!, folder!)}>
            Create thread
          </PrimaryButton>
        </div>
      </div>
    </Sheet>
  )
}

/** Project files that make Claude Code run folder-provided config (hooks, MCP servers). */
function projectConfig(folder: string): string[] {
  return ['.mcp.json', '.claude/settings.json', '.claude/settings.local.json'].filter((f) => existsSync(path.join(folder, f)))
}

function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

export function ThreadSwitcher({
  open,
  onClose,
  threads,
  profiles,
  activeId,
  onPick,
  onNew,
}: {
  open: boolean
  onClose: () => void
  threads: Thread[]
  profiles: Profile[]
  activeId?: string
  onPick: (id: string) => void
  onNew: () => void
}) {
  const m = useM()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<PublicInstance>(null)
  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return threads.filter((t) => !q || t.title.toLowerCase().includes(q) || t.workspace.toLowerCase().includes(q))
  }, [threads, query])
  // Group by workspace, keeping recency order inside each group.
  const groups = useMemo(() => {
    const map = new Map<string, Thread[]>()
    for (const t of list) map.set(t.workspace, [...(map.get(t.workspace) ?? []), t])
    return [...map.entries()]
  }, [list])
  const flat = groups.flatMap(([, ts]) => ts)
  const pick = (t?: Thread) => t && onPick(t.id)

  const onKeyDown = (e: KeyEvent) => {
    const step = (d: number) => {
      e.preventDefault()
      setActive((a) => (flat.length ? (a + d + flat.length) % flat.length : 0))
    }
    if (e.key === 'escape') {
      e.preventDefault()
      onClose()
    } else if ((e.modifiers?.ctrl && e.key === 'n') || e.key === 'down') step(1)
    else if ((e.modifiers?.ctrl && e.key === 'p') || e.key === 'up') step(-1)
  }

  return (
    <Sheet open={open} onClose={onClose} width={560} initialFocus={inputRef}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, height: 46, paddingLeft: 16, paddingRight: 12, borderBottomWidth: 1, borderColor: m.border }}>
        <Icon name="search" size={15} />
        <input
          ref={inputRef}
          testId="switcher-input"
          value={query}
          placeholder="Jump to a thread…"
          onChange={(e) => {
            setQuery(e.value ?? '')
            setActive(0)
          }}
          onSubmit={() => pick(flat[active])}
          onKeyDown={onKeyDown}
          style={{ flexGrow: 1, minWidth: 0, fontSize: 14, color: m.text }}
        />
        <Kbd>⌃N ⌃P</Kbd>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 420, overflowY: 'scroll', scrollbarColor: m.scrollbar, scrollbarWidth: 6, padding: 6 }}>
        {flat.length === 0 ? (
          <div style={{ padding: 14 }}>
            <text style={{ fontSize: 13, lineHeight: 18, color: m.textMuted }}>{threads.length ? 'No thread matches.' : 'No threads yet.'}</text>
          </div>
        ) : null}
        {groups.map(([workspace, ts]) => (
          <div key={workspace} style={{ display: 'flex', flexDirection: 'column', gap: 1, paddingBottom: 6 }}>
            <div style={{ paddingLeft: 10, paddingTop: 6, paddingBottom: 4 }}>
              <text style={{ fontSize: 11, lineHeight: 14, color: m.textFaint, fontFamily: font.mono, whiteSpace: 'nowrap', textOverflow: 'ellipsis-start' }}>{workspace}</text>
            </div>
            {ts.map((t) => {
              const i = flat.indexOf(t)
              const p = profiles.find((x) => x.id === t.profileId)
              return (
                <Row key={t.id} selected={i === active} onPress={() => pick(t)} testId={`thread-${t.id}`}>
                  <Dot color={p?.color ?? m.textFaint} />
                  <text style={{ flexGrow: 1, minWidth: 0, fontSize: 13, lineHeight: 18, color: t.id === activeId ? m.text : m.textMuted, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{t.title}</text>
                  {t.running ? <Meta color={m.textMuted}>working</Meta> : null}
                  <Meta>{ago(t.updatedAt)}</Meta>
                </Row>
              )
            })}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 10, paddingRight: 10, height: 38, borderTopWidth: 1, borderColor: m.border }}>
        <Quiet onPress={onNew} testId="switcher-new">
          <Icon name="plus" size={12} />
          <Meta color={m.textMuted}>New thread</Meta>
        </Quiet>
        <div style={{ flexGrow: 1 }} />
        <Meta>↩ open · esc close</Meta>
      </div>
    </Sheet>
  )
}
