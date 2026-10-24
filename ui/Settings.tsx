// Settings (⌘,): a page of its own over the note, under the tab strip. Sections are listed on the
// left and scroll on the right; a section's name scrolls to it and lights while you're in it.
// esc or Done goes back to the note, which stays as it was underneath. Everything persists to
// settings.json (accounts to profiles.json). Translucency is a window option, so it applies on
// the next launch; the rest applies at once.

import { useRef, useState, type ReactNode } from 'react'
import { DismissableLayer, motion, useGpuixRequired, type PublicInstance } from '@gpuix/react'
import { Button, Dot, Field, Label, Segmented, SheetRow, SheetSection, Switch } from '../components'
import { enter, offset } from '../components/motion'
import { sameLogin } from '../core/auth'
import type { Profile } from '../core/profiles'
import { accentFor } from './theme'
import { useM } from './kit'
import type { Settings } from '../core/store'
import type { MaterialName } from './theme'
import { keys } from '../core/platform'

export type TabMode = NonNullable<Settings['tabs']>
export type MotionPref = 'system' | 'reduce' | 'full'

const sections = ['Accounts', 'Appearance', 'Tabs', 'Motion'] as const
type Section = (typeof sections)[number]
const NAV = 176
/** A section counts as the one you're in once its top is this close under the top edge. */
const READING_LINE = 48

export function SettingsPage({
  top,
  onClose,
  material,
  onMaterial,
  translucent,
  onTranslucent,
  tabs,
  onTabs,
  motion: motionPref,
  onMotion,
  profiles,
  busy,
  onLogin,
  onLogout,
  onAddProfile,
}: {
  /** Where the page starts: under the tab strip while it shows. */
  top: number
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
  const m = useM()
  const renderer = useGpuixRequired()
  const root = useRef<PublicInstance>(null)
  const scroller = useRef<PublicInstance>(null)
  const anchors = useRef(new Map<Section, PublicInstance>())
  const [current, setCurrent] = useState<Section>('Accounts')
  // A section you jumped to stays lit through the scroll that jump makes, even when the page is
  // too short for it to reach the top.
  const jumped = useRef(0)

  const boundsOf = (node: PublicInstance | null | undefined) => (node ? renderer.getElementBounds?.(node.id) : undefined)
  /** The last section whose top has reached the reading line. */
  const track = () => {
    if (Date.now() - jumped.current < 300) return
    const box = boundsOf(scroller.current)
    if (!box) return
    let at: Section = 'Accounts'
    for (const s of sections) {
      const b = boundsOf(anchors.current.get(s))
      if (b && b.y - box.y <= READING_LINE) at = s
    }
    setCurrent(at)
  }
  const go = (s: Section) => {
    const box = boundsOf(scroller.current)
    const b = boundsOf(anchors.current.get(s))
    const now = scroller.current ? renderer.getScrollOffset?.(scroller.current.id) : undefined
    if (!box || !b || !now || !scroller.current) return
    // Scroll offsets are 0 at the start and negative further down.
    jumped.current = Date.now()
    renderer.scrollTo?.(scroller.current.id, 0, Math.min(0, now[1] - (b.y - box.y) + 12))
    setCurrent(s)
  }
  const section = (s: Section, children: ReactNode) => (
    <div key={s} ref={(node) => { if (node) anchors.current.set(s, node); else anchors.current.delete(s) }} testId={`settings-${s.toLowerCase()}`}>
      {children}
    </div>
  )

  return (
    <DismissableLayer onEscapeKeyDown={onClose} initialFocus={() => root.current?.id ?? null}>
      <div ref={root} testId="settings" tabIndex={0} style={{ position: 'absolute', top, left: 0, right: 0, bottom: 0, backgroundColor: m.pane, keyboardFocusDim: false }}>
        <motion.div
          initial={{ opacity: 0, top: offset.menu }}
          animate={{ opacity: 1, top: 0 }}
          transition={enter('standard')}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'row' }}
        >
          <div style={{ width: NAV, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 22, paddingLeft: 14, paddingRight: 10, borderRightWidth: 1, borderColor: m.border }}>
            <text style={{ fontSize: 15, lineHeight: 20, fontWeight: 600, color: m.text, paddingLeft: 8, paddingBottom: 12 }}>Settings</text>
            {sections.map((s) => (
              <Button key={s} onPress={() => go(s)} selected={current === s} testId={`settings-go-${s.toLowerCase()}`} style={{ justifyContent: 'flex-start', paddingLeft: 8 }}>
                <Label muted={current !== s}>{s}</Label>
              </Button>
            ))}
          </div>
          <div style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-end', paddingTop: 10, paddingRight: 12, flexShrink: 0 }}>
              <Button onPress={onClose} testId="settings-done" title="Back to the note (esc)">
                <Label muted>Done</Label>
              </Button>
            </div>
            <div ref={scroller} onScrollChange={track} style={{ flexGrow: 1, minHeight: 0, overflowY: 'scroll', scrollbarColor: m.scrollbar, scrollbarWidth: 10, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column', width: '100%', maxWidth: 600, paddingLeft: 24, paddingRight: 24, paddingBottom: 240, gap: 14 }}>
                {section('Accounts', <Accounts profiles={profiles} busy={busy} onLogin={onLogin} onLogout={onLogout} onAddProfile={onAddProfile} />)}
                {section(
                  'Appearance',
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
                  </SheetSection>,
                )}
                {section(
                  'Tabs',
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
                  </SheetSection>,
                )}
                {section(
                  'Motion',
                  <SheetSection label="Motion">
                    <SheetRow label="Reduce motion" detail="System follows macOS Accessibility. Reduced shows changes without movement.">
                      <Segmented
                        testId="set-motion"
                        value={motionPref}
                        onChange={onMotion}
                        options={[
                          { value: 'system', label: 'System' },
                          { value: 'reduce', label: 'Reduced' },
                          { value: 'full', label: 'Full' },
                        ]}
                        width={70}
                      />
                    </SheetRow>
                  </SheetSection>,
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </DismissableLayer>
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
