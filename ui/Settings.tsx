// Settings (⌘,): one page per sidebar item, with its own scroll position starting at the top.
// Escape or Back to note returns to the note. Changes persist to settings.json (accounts to profiles.json).

import { useRef, useState } from 'react'
import { DismissableLayer, type PublicInstance } from '@gpuix/react'
import { motion } from '../components/spring'
import { Button, closedByOutsidePress, Dot, Field, Icon, Label, Menu, Segmented, Switch, type MenuItem } from '../components'
import { enter, leave, offset } from '../components/motion'
import { sameLogin } from '../core/auth'
import type { Profile } from '../core/profiles'
import { agentChoices, agentFor, type AgentId } from '../core/agents'
import { accentFor } from './theme'
import { useM } from './kit'
import { readSettings, updateSettings, type Settings } from '../core/store'
import { cycleModes, defaultMode, modeLabel, modes, type Think } from '../core/asks'
import { effortLabel } from '../core/models'
import { font } from './theme'
import type { MaterialName } from './theme'
import { keys } from '../core/platform'
import { Activity } from './Activity'
import { BrowserSettings } from './BrowserSettings'
import { McpSettings } from './McpSettings'
import { TrashSettings } from './Trash'
import type { Thread } from '../core/threads'
import { groups, matches, pageInfo, slug, type SettingsGroup, type SettingsPage as Page } from './settings/catalog'
import { SettingsNavigation } from './settings/Navigation'
import { SettingsResultLink, SettingsRow as SheetRow, SettingsSection as SheetSection, ThemeCards } from './settings/controls'

export type TabMode = NonNullable<Settings['tabs']>
export type MotionPref = 'system' | 'reduce' | 'full'


export function SettingsPage({
  top,
  onClose,
  material,
  onMaterial,
  tabs,
  onTabs,
  motion: motionPref,
  onMotion,
  showThoughts,
  onShowThoughts,
  profiles,
  busy,
  refreshing,
  onRefresh,
  onLogin,
  onLogout,
  onAddProfile,
  onRestore,
}: {
  /** Where the page starts: under the tab strip while it shows. */
  top: number
  onClose: () => void
  material: MaterialName
  onMaterial: (next: MaterialName) => void
  tabs: TabMode
  onTabs: (next: TabMode) => void
  motion: MotionPref
  onMotion: (next: MotionPref) => void
  showThoughts: boolean
  onShowThoughts: (next: boolean) => void
  profiles: Profile[]
  /** Account ids a login or logout is running for. */
  busy: Set<string>
  refreshing: Set<string>
  onRefresh: (profileId: string) => void
  onLogin: (profileId: string) => void
  onLogout: (profileId: string) => void
  onAddProfile: (name: string, agent: AgentId) => void
  /** A note brought back from Trash, for Past notes. */
  onRestore: (thread: Thread) => void
}) {
  const m = useM()
  const root = useRef<PublicInstance>(null)
  const [current, setCurrent] = useState<Page>('Vellum')
  const [query, setQuery] = useState('')
  const searching = Boolean(query.trim())
  const accountNames = profiles.map((profile) => `${profile.name} ${profile.email ?? ''} ${profile.plan ?? ''}`).join(' ')
  const hits = groups.filter((group) => matches(group, query, accountNames))
  const visible = searching ? hits : groups.filter((group) => group.page === current)
  const open = (page: Page) => { setCurrent(page); setQuery('') }
  const content = (group: SettingsGroup) => {
    switch (group.id) {
      case 'thinking': return <SheetSection label="Model activity"><SheetRow label="Show model thinking" detail="Include reasoning in expandable activity. Tool results stay visible either way."><Switch checked={showThoughts} onChange={onShowThoughts} label="Show model thinking" testId="set-show-thoughts" /></SheetRow></SheetSection>
      case 'new-notes': return <NewNotes profiles={profiles} />
      case 'instructions': return <Instructions />
      case 'notifications': return <Notifications />
      case 'theme': return <>{searching ? <Button onPress={() => open('Appearance')} title="Open Appearance settings" style={{ alignSelf: 'start', marginBottom: 8 }}><text style={{ fontSize: 12, color: m.blue }}>Appearance</text><Icon name="chevronRight" size={11} color={m.blue} /></Button> : null}<ThemeCards value={material} onChange={onMaterial} /></>
      case 'interface': return <SheetSection label="Interface" hint={keys('⇧⌘T toggles the tab strip. ⌘⇧L switches themes.')}>
        <SheetRow label="Tab strip" detail="Keep tabs visible, hide them while you write, or hide them entirely."><Segmented testId="set-tabs" value={tabs} onChange={onTabs} options={[{ value: 'pinned', label: 'Pinned' }, { value: 'auto', label: 'Auto' }, { value: 'hidden', label: 'Hidden' }]} width={70} /></SheetRow>
        <SheetRow label="Motion" detail="System follows your device’s reduced motion setting."><Segmented testId="set-motion" value={motionPref} onChange={onMotion} options={[{ value: 'system', label: 'System' }, { value: 'reduce', label: 'Reduced' }, { value: 'full', label: 'Full' }]} width={70} /></SheetRow>
      </SheetSection>
      case 'accounts': return <Accounts profiles={profiles} busy={busy} refreshing={refreshing} onRefresh={onRefresh} onLogin={onLogin} onLogout={onLogout} onAddProfile={onAddProfile} />
      case 'browser': return <BrowserSettings />
      case 'mcp': return <McpSettings />
      case 'activity': return <Activity />
      case 'trash': return <TrashSettings profiles={profiles} onRestore={onRestore} />
    }
  }

  return (
    <DismissableLayer onEscapeKeyDown={onClose} initialFocus={() => root.current?.id ?? null}>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: GPUIX needs a native focus target for Escape. */}
      <motion.div ref={root} initial={false} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={leave()} testId="settings" role="dialog" aria-label="Settings" tabIndex={0} style={{ position: 'absolute', top, left: 0, right: 0, bottom: 0, backgroundColor: m.rootTint, keyboardFocusDim: false }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'row' }}>
          <SettingsNavigation page={current} query={query} shown={(page) => !searching || hits.some((group) => group.page === page)} onQuery={setQuery} onOpen={open} onBack={onClose} />
          <div testId="settings-content" style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0, marginTop: 8, marginRight: 8, marginBottom: 8, borderRadius: 12, borderWidth: 1, borderColor: m.border, backgroundColor: m.pane, overflow: 'hidden' }}>
            <motion.div key={searching ? 'search' : current} initial={{ opacity: 0, top: offset.menu }} animate={{ opacity: 1, top: 0 }} transition={enter('fast')} testId="settings-page-scroll" style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', flexGrow: 1, minHeight: 0, overflowY: 'scroll', pointerEvents: 'auto', scrollbarColor: m.scrollbar, scrollbarWidth: 10 }}>
              {/* biome-ignore lint/a11y/useSemanticElements: GPUIX regions use native div hosts. */}
              <div role="region" aria-label={searching ? 'Search settings' : current} testId={searching ? 'settings-results' : `settings-${slug(current)}`} style={{ display: 'flex', flexDirection: 'column', width: '100%', maxWidth: 776, flexShrink: 0, paddingTop: 40, paddingBottom: 56, paddingLeft: 28, paddingRight: 28 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingBottom: 20 }}>
                  <text testId="settings-page-title" style={{ fontSize: 20, lineHeight: 28, fontWeight: 600, color: m.text }}>{searching ? 'Search results' : current}</text>
                  <text style={{ fontSize: 13.5, lineHeight: 20, color: m.textMuted }}>{searching ? `Settings matching “${query.trim()}”.` : pageInfo[current].intro}</text>
                </div>
                {visible.map((group) => <SettingsResultLink.Provider key={group.id} value={searching ? { page: group.page, open: () => open(group.page) } : undefined}><div testId={`settings-group-${group.id}`}>{content(group)}</div></SettingsResultLink.Provider>)}
                {!visible.length ? <text testId="settings-search-empty" style={{ fontSize: 13.5, lineHeight: 20, color: m.textMuted }}>No settings found. Try a different word.</text> : null}
              </div>
            </motion.div>
          </div>
        </div>
      </motion.div>
    </DismissableLayer>
  )
}

/** These read and write settings.json themselves: nothing else on screen changes with them. */
function useSetting<K extends keyof Settings>(key: K): [Settings[K], (next: Settings[K]) => void] {
  const [value, setValue] = useState(() => readSettings()[key])
  return [value, (next) => { setValue(next); updateSettings({ [key]: next } as Partial<Settings>) }]
}

const startEfforts: Think[] = ['off', 'on', 'high', 'max']

/** What a new note starts with, and what's open at launch. */
function NewNotes({ profiles }: { profiles: Profile[] }) {
  const [mode, setMode] = useSetting('newNoteMode')
  const [think, setThink] = useSetting('newNoteThink')
  const [profile, setProfile] = useSetting('newNoteProfile')
  const [atLaunch, setAtLaunch] = useSetting('atLaunch')
  return (
    <SheetSection label="New notes" hint="Defaults for new notes. Existing notes keep their settings.">
      <SheetRow label="Mode" detail={modes.find((x) => x.id === (mode ?? defaultMode))?.hint}>
        <Segmented testId="set-new-mode" value={mode ?? defaultMode} onChange={setMode} options={cycleModes.map((id) => ({ value: id, label: modeLabel(id) }))} width={64} />
      </SheetRow>
      <SheetRow label="Effort" detail="How much the model thinks before replying.">
        <Segmented testId="set-new-effort" value={think ?? 'on'} onChange={setThink} options={startEfforts.map((value) => ({ value, label: effortLabel(value) }))} width={70} />
      </SheetRow>
      {profiles.length > 1 ? (
        <SheetRow label="Account" detail="Folders with a saved account use that account.">
          <AccountPick profiles={profiles} value={profiles.some((p) => p.id === profile) ? profile : undefined} onChange={setProfile} />
        </SheetRow>
      ) : null}
      <SheetRow label="At launch">
        <Segmented testId="set-at-launch" value={atLaunch ?? 'last'} onChange={setAtLaunch} options={[{ value: 'last', label: 'Last note' }, { value: 'new', label: 'New note' }]} width={84} />
      </SheetRow>
    </SheetSection>
  )
}

/** One account from a menu, however many there are; unset follows the open note. */
function AccountPick({ profiles, value, onChange }: { profiles: Profile[]; value?: string; onChange: (id: string | undefined) => void }) {
  const m = useM()
  const [open, setOpen] = useState(false)
  const chosen = profiles.find((p) => p.id === value)
  const items: MenuItem[] = [
    { label: 'Current account', checked: !chosen, testId: 'set-new-account-open', onSelect: () => onChange(undefined) },
    { kind: 'separator' },
    ...profiles.map((p): MenuItem => ({ label: p.name, dot: accentFor(m, profiles, p.id), checked: p.id === chosen?.id, testId: `set-new-account-${p.id}`, onSelect: () => onChange(p.id) })),
  ]
  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <Button onPress={() => setOpen((v) => !v && !closedByOutsidePress('new-account'))} selected={open} testId="set-new-account" title="Choose default account" style={{ gap: 7, paddingLeft: 10, paddingRight: 8, borderWidth: 1, borderColor: m.border }}>
        {chosen ? <Dot color={accentFor(m, profiles, chosen.id)} size={8} /> : null}
        <Label>{chosen?.name ?? 'Current account'}</Label>
        <Icon name="chevronDown" size={11} />
      </Button>
      <Menu open={open} onClose={() => setOpen(false)} side="bottom" align="end" width={220} testId="set-new-account-menu" closeKey="new-account" items={items} />
    </div>
  )
}

/** Your own words for Claude, sent with what Vellum tells it (core/prompt.ts). */
function Instructions() {
  const m = useM()
  const [text, setText] = useSetting('instructions')
  return (
    <SheetSection label="Instructions" hint="New notes use these instructions. Existing notes update after their next summary. Project instructions still apply.">
      <textarea
        testId="set-instructions"
        value={text ?? ''}
        placeholder="Reply in British English. Prefer bun over npm."
        minRows={4}
        maxRows={14}
        onChange={(e) => setText(e.value || undefined)}
        style={{ width: '100%', minWidth: 0, fontFamily: font.mono, fontSize: 12.5, lineHeight: 19, color: m.text, backgroundColor: m.chipBg, borderRadius: 10, borderWidth: 1, borderColor: m.border, padding: 10 }}
      />
    </SheetSection>
  )
}

/** Desktop alerts only leave the app while its window is unfocused. */
function Notifications() {
  const [want, setWant] = useSetting('notify')
  return (
    <SheetSection label="Notifications" hint="Desktop alerts appear while this window is unfocused. The notification inbox always keeps requests and replies together.">
      <SheetRow label="Desktop alerts" detail="Requests include questions, approvals and agent errors. All also includes replies.">
        <Segmented testId="set-notify" value={want ?? 'asks'} onChange={setWant} options={[{ value: 'off', label: 'Never' }, { value: 'asks', label: 'Requests' }, { value: 'all', label: 'All' }]} width={92} />
      </SheetRow>
    </SheetSection>
  )
}

/** Who each account is, and logging it in or out. */
function Accounts({
  profiles,
  busy,
  refreshing,
  onRefresh,
  onLogin,
  onLogout,
  onAddProfile,
}: {
  profiles: Profile[]
  busy: Set<string>
  refreshing: Set<string>
  onRefresh: (profileId: string) => void
  onLogin: (profileId: string) => void
  onLogout: (profileId: string) => void
  onAddProfile: (name: string, agent: AgentId) => void
}) {
  const m = useM()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [agent, setAgent] = useState<AgentId>('claude')
  const choices = agentChoices(profiles)
  const why = choices.find((c) => c.agent.id === agent)?.why
  const add = () => {
    if (!name.trim() || why) return
    onAddProfile(name.trim(), agent)
    setName('')
    setAgent('claude')
    setAdding(false)
  }
  return (
    <SheetSection label="Accounts" hint="Separate logins, each with its agent. Claude accounts share skills, settings and history.">
      {profiles.map((p) => {
        // The later of two accounts with one login is the mistake; the first is fine.
        const same = p.loggedIn && p.email ? sameLogin(profiles, p.id, p.email) : undefined
        const twin = same && profiles.indexOf(same) < profiles.indexOf(p) ? same : undefined
        const own = agentFor(p)
        const named = (text: string) => (own.id === 'claude' ? text : `${own.title} · ${text}`)
        const who = twin
          ? `Same login as ${twin.name}. Log out here and at claude.ai, then log in with another account.`
          : p.loggedIn === false
            ? named('Not logged in')
            : p.email || p.plan
              ? named([p.email, p.plan].filter(Boolean).join(' · '))
              : own.id === 'opencode'
                ? 'OpenCode · its own sign-in (opencode auth login)'
                : named('Checking…')
        return (
          <SheetRow key={p.id} label={p.name} detail={who} testId={`account-${p.id}`}>
            <Dot color={accentFor(m, profiles, p.id)} size={8} />
            <Button onPress={() => onRefresh(p.id)} disabled={busy.has(p.id) || refreshing.has(p.id)} testId={`refresh-account-${p.id}`} title={`Refresh ${own.title} ${own.id === 'opencode' ? 'providers' : 'login status'}`} style={{ width: 24, paddingLeft: 0, paddingRight: 0 }}><Icon name="refresh" size={13} color={m.textMuted} /></Button>
            {busy.has(p.id) ? (
              <Label muted>Signing in…</Label>
            ) : p.loggedIn === false ? (
              <Button variant="solid" onPress={() => onLogin(p.id)} testId={`login-${p.id}`} title={`Log in to ${p.name}`}>
                <Label variant="solid">Log in</Label>
              </Button>
            ) : own.id === 'opencode' ? (
              // OpenCode sign-in is per provider, so connecting another is always offered.
              <Button onPress={() => onLogin(p.id)} testId={`login-${p.id}`} title={`Manage provider connections in ${p.name}`}>
                <Label muted>Manage providers</Label>
              </Button>
            ) : (
              <Button onPress={() => onLogout(p.id)} testId={`logout-${p.id}`} title={`Log out of ${p.name}`}>
                <Label muted>Log out</Label>
              </Button>
            )}
          </SheetRow>
        )
      })}
      {adding ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ alignSelf: 'start' }}><Segmented<AgentId> testId="new-account-agent" value={agent} onChange={setAgent} options={choices.map((c) => ({ value: c.agent.id, label: c.agent.title }))} width={84} /></div>
          {why ? <Label muted>{why}</Label> : null}
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <div style={{ flexGrow: 1 }}>
              <Field value={name} onChange={setName} onSubmit={add} placeholder="Work" autoFocus testId="new-account-name" />
            </div>
            <Button onPress={() => setAdding(false)}>
              <Label muted>Cancel</Label>
            </Button>
            <Button variant="solid" onPress={add} testId="new-account-add" disabled={Boolean(why)}>
              <Label variant="solid">Add account</Label>
            </Button>
          </div>
        </div>
      ) : (
        <Button onPress={() => setAdding(true)} testId="add-account" style={{ alignSelf: 'start' }}>
          <Label muted>Add account</Label>
        </Button>
      )}
    </SheetSection>
  )
}
