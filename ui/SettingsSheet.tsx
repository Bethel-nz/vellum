// Settings (⌘,): appearance, the tab strip and motion. Everything persists to settings.json.
// Translucency is a window option, so it applies on the next launch; the rest applies at once.

import { Segmented, Sheet, SheetHeader, SheetRow, SheetSection, Switch } from '../components'
import type { Settings } from '../core/store'
import type { MaterialName } from './theme'

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
}) {
  return (
    <Sheet open={open} onClose={onClose} width={520} testId="settings">
      <SheetHeader title="Settings" onClose={onClose} />
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
      <SheetSection label="Tabs" hint="⌘⇧T shows or hides the tab strip in any mode.">
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
