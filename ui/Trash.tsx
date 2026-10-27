// Settings › Trash: the notes you deleted from Past notes (⇧⌘⌫), kept for 30 days (core/trash.ts).
// Restore puts one back where it was, in Past notes; Delete removes it for good, after asking,
// and Empty Trash removes them all.

import path from 'node:path'
import { useEffect, useState } from 'react'
import { Button, Dot, Icon, Label } from '../components'
import { ConfirmMorph } from '../components/ConfirmMorph'
import type { Profile } from '../core/profiles'
import type { Thread } from '../core/threads'
import { daysLeft, deleteForever, emptyTrash, restoreNote, trashed, TRASH_DAYS, type Trashed } from '../core/trash'
import { ago } from './dialogs'
import { useM } from './kit'
import { SettingsSection as SheetSection } from './settings/controls'
import { accentFor, shortPath, type } from './theme'

export function TrashSettings({ profiles, onRestore }: { profiles: Profile[]; onRestore: (thread: Thread) => void }) {
  const m = useM()
  // Read on open, which also clears out what is past its 30 days; each change reads it again.
  const [items, setItems] = useState<Trashed[]>([])
  const [confirming, setConfirming] = useState<string>()
  const reload = () => void trashed().then(setItems)
  useEffect(reload, [])
  const restore = async (id: string) => {
    const thread = await restoreNote(id)
    if (thread) onRestore(thread)
    setConfirming(undefined)
    reload()
  }
  const remove = (id: string) => {
    deleteForever(id)
    setConfirming(undefined)
    reload()
  }

  return (
    <SheetSection label="Deleted notes" hint={`Deleted notes stay here for ${TRASH_DAYS} days, then they’re gone for good.`}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
      {items.length ? (
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', minHeight: 34 }}>
          <text testId="trash-count" style={{ ...type.label, color: m.textUi, flexGrow: 1 }}>{items.length === 1 ? '1 note' : `${items.length} notes`}</text>
          <ConfirmMorph
            key={items.length}
            label="Empty Trash"
            prompt={items.length === 1 ? 'Delete 1 note for good?' : `Delete ${items.length} notes for good?`}
            confirmLabel="Empty Trash"
            doneLabel="Trash emptied"
            onConfirm={() => {
              void emptyTrash().then(reload)
            }}
            testId="trash-empty"
          />
        </div>
      ) : (
        <div testId="trash-empty-state" style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingTop: 10, paddingBottom: 10 }}>
          <text style={{ ...type.label, color: m.textUi }}>Trash is empty</text>
          <text style={{ fontSize: 11.5, lineHeight: 15, color: m.textMuted }}>Notes you delete from Past notes wait here, so you can bring them back.</text>
        </div>
      )}
      {items.map((t) => (
        <div key={t.id} testId={`trash-${t.id}`} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingTop: 6, paddingBottom: 6, borderTopWidth: 1, borderColor: m.border }}>
          <Icon name="notes" size={14} color={m.textMuted} />
          <div style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <text style={{ ...type.label, color: m.textUi, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{t.title}</text>
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Dot color={accentFor(m, profiles, t.profileId)} size={5} />
              <text style={{ fontSize: 11.5, lineHeight: 15, color: m.textMuted, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                {`${path.basename(t.workspace) || shortPath(t.workspace)} · ${deletedAgo(t.deletedAt)} · ${daysLeft(t) === 1 ? '1 day left' : `${daysLeft(t)} days left`}`}
              </text>
            </div>
          </div>
          {confirming === t.id ? (
            <>
              <text style={{ fontSize: 12.5, lineHeight: 16, color: m.textMuted }}>Delete for good?</text>
              <Button testId={`trash-cancel-${t.id}`} onPress={() => setConfirming(undefined)}>
                <Label muted>Cancel</Label>
              </Button>
              <Button testId={`trash-delete-confirm-${t.id}`} variant="danger" onPress={() => remove(t.id)} style={{ backgroundColor: m.dangerBg }}>
                <Label variant="danger">Delete</Label>
              </Button>
            </>
          ) : (
            <>
              <Button testId={`trash-restore-${t.id}`} title="Put it back in Past notes" onPress={() => restore(t.id)}>
                <Label>Restore</Label>
              </Button>
              <Button testId={`trash-delete-${t.id}`} title="Delete for good" onPress={() => setConfirming(t.id)} style={{ width: 28, paddingLeft: 0, paddingRight: 0 }}>
                <Icon name="trash" size={14} />
              </Button>
            </>
          )}
        </div>
      ))}
      </div>
    </SheetSection>
  )
}

const deletedAgo = (iso: string) => (ago(iso) === 'now' ? 'Deleted just now' : `Deleted ${ago(iso)} ago`)
