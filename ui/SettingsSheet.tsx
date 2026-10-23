// Settings (⌘,): accounts, appearance, the tab strip and motion. Everything persists to
// settings.json (accounts to profiles.json). Translucency is a window option, so it applies on the
// next launch; the rest applies at once.

import { useState } from 'react'
import { Button, Dot, Field, Label, Segmented, Sheet, SheetHeader, SheetRow, SheetSection, Switch } from '../components'
import { sameLogin } from '../core/auth'
import type { Profile } from '../core/profiles'
import { accentFor } from './theme'
import { useM } from './kit'
import type { Settings } from '../core/store'
import type { MaterialName } from './theme'
import { keys } from '../core/platform'

export type TabMode = NonNullable<Settings['tabs']>
export type MotionPref = 'system' | 'reduce' | 'full'

export function SettingsSheet({
  open,
  onClose,
  material,
  onMaterial,
  translucent,
  onTranslucent,
  tabs,
  onTabs,
  motion,
  onMotion,
  profiles,
  busy,
  onLogin,
  onLogout,
  onAddProfile,
}: {
  open: boolean
  onClose: () => void
  material: MaterialName
  onMaterial: (next: MaterialName) => void
  translucent: boolean
  onTranslucent: (next: boolean) => void
  tabs: TabMode
  onTabs: (next: TabMode) => void
  motion: MotionPref
  onMotion: (next: MotionPref) => void
  profiles: Profile[]
  /** Account ids a login or logout is running for. */
  busy: Set<string>
  onLogin: (profileId: string) => void
  onLogout: (profileId: string) => void
  onAddProfile: (name: string) => void
}) {
  return (
    <Sheet open={open} onClose={onClose} width={520} testId="settings">
      <SheetHeader title="Settings" onClose={onClose} />
      <Accounts profiles={profiles} busy={busy} onLogin={onLogin} onLogout={onLogout} onAddProfile={onAddProfile} />
      <SheetSection label="Appearance">
        <SheetRow label="Theme" detail="Groknight is the default; smoke and frost are the older glass looks.">
          <Segmented
            testId="set-material"
            value={material}
            onChange={onMaterial}
            options={[
              { value: 'groknight', label: 'Groknight' },
              { value: 'smoke', label: 'Smoke' },
              { value: 'frost', label: 'Frost' },
            ]}
            width={84}
          />
        </SheetRow>
        <SheetRow label="Translucent window" detail="Blur the desktop behind the window. Next launch.">
          <Switch testId="set-translucent" checked={translucent} onChange={onTranslucent} label="Translucent window" />
        </SheetRow>
      </SheetSection>
      <SheetSection label="Tabs" hint={keys('⇧⌘T shows or hides the tab strip in any mode.')}>
        <SheetRow label="Tab strip" detail="Auto tucks it away while you write; hidden keeps it gone.">
          <Segmented
            testId="set-tabs"
            value={tabs}
            onChange={onTabs}
            options={[
              { value: 'pinned', label: 'Pinned' },
              { value: 'auto', label: 'Auto' },
              { value: 'hidden', label: 'Hidden' },
            ]}
            width={70}
          />
        </SheetRow>
      </SheetSection>
      <SheetSection label="Motion">
        <SheetRow label="Reduce motion" detail="System follows macOS Accessibility. Reduced shows changes without movement.">
          <Segmented
            testId="set-motion"
            value={motion}
            onChange={onMotion}
            options={[
              { value: 'system', label: 'System' },
              { value: 'reduce', label: 'Reduced' },
              { value: 'full', label: 'Full' },
            ]}
            width={70}
          />
        </SheetRow>
      </SheetSection>
      <div style={{ height: 6 }} />
    </Sheet>
  )
}

/** Who each account is, and logging it in or out. */
function Accounts({
  profiles,
  busy,
  onLogin,
  onLogout,
  onAddProfile,
}: {
  profiles: Profile[]
  busy: Set<string>
  onLogin: (profileId: string) => void
  onLogout: (profileId: string) => void
  onAddProfile: (name: string) => void
}) {
  const m = useM()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const add = () => {
    if (!name.trim()) return
    onAddProfile(name.trim())
    setName('')
    setAdding(false)
  }
  return (
    <SheetSection label="Accounts" hint="Each account keeps its own login. Your skills, settings and history are shared.">
      {profiles.map((p) => {
        // The later of two accounts with one login is the mistake; the first is fine.
        const same = p.loggedIn && p.email ? sameLogin(profiles, p.id, p.email) : undefined
        const twin = same && profiles.indexOf(same) < profiles.indexOf(p) ? same : undefined
        const who = twin
          ? `Same login as ${twin.name}. Log out, sign out of claude.ai in your browser, and log in again.`
          : p.loggedIn === false
            ? 'Not logged in'
            : p.email
              ? [p.email, p.plan].filter(Boolean).join(' · ')
              : 'Checking…'
        return (
          <SheetRow key={p.id} label={p.name} detail={who} testId={`account-${p.id}`}>
            <Dot color={accentFor(m, profiles, p.id)} size={8} />
            {busy.has(p.id) ? (
              <Label muted>Working…</Label>
            ) : p.loggedIn === false ? (
              <Button variant="solid" onPress={() => onLogin(p.id)} testId={`login-${p.id}`} title={`Log in to ${p.name}`}>
                <Label variant="solid">Log in</Label>
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
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <div style={{ flexGrow: 1 }}>
            <Field value={name} onChange={setName} onSubmit={add} placeholder="Name, e.g. Work 2" autoFocus testId="new-account-name" />
          </div>
          <Button onPress={() => setAdding(false)}>
            <Label muted>Cancel</Label>
          </Button>
          <Button variant="solid" onPress={add} testId="new-account-add">
            <Label variant="solid">Add</Label>
          </Button>
        </div>
      ) : (
        <Button onPress={() => setAdding(true)} testId="add-account" style={{ alignSelf: 'start' }}>
          <Label muted>Add account</Label>
        </Button>
      )}
    </SheetSection>
  )
}
