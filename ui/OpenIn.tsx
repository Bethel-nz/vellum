// "Open in", in the file pane's header: the app you last opened with, one click away, and a menu
// of the others this Mac has (Finder, editors, terminals, git clients), each with its icon. With a
// file open, an editor opens the file and Finder shows it selected; terminals and git clients, and
// everything when no file is open, get the note's folder.
import { useEffect, useMemo, useState } from 'react'
import { Button, Menu, closedByOutsidePress, type MenuItem } from '../components'
import { Icon } from '../components/Icon'
import { appIcon, openIn, openTargets, type OpenTarget } from '../core/openin'
import { revealFile } from '../core/platform'
import { readSettings, updateSettings } from '../core/store'

const kinds: { kind: OpenTarget['kind']; label: string }[] = [
  { kind: 'files', label: 'Files' },
  { kind: 'editor', label: 'Editors' },
  { kind: 'terminal', label: 'Terminals' },
  { kind: 'git', label: 'Git' },
]

export function OpenIn({ folder, file }: { folder: string; file?: string }) {
  const targets = useMemo(openTargets, [])
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState(() => readSettings().openIn)
  const [icons, setIcons] = useState<Record<string, string>>({})
  useEffect(() => {
    for (const t of targets) void appIcon(t).then((png) => png && setIcons((all) => ({ ...all, [t.id]: png })))
  }, [targets])

  const current = targets.find((t) => t.id === chosen) ?? targets[0]
  if (!current) return null
  const go = (t: OpenTarget) => {
    if (file && t.kind === 'files') revealFile(file)
    else openIn(t, file && t.kind === 'editor' ? file : folder)
    setChosen(t.id)
    updateSettings({ openIn: t.id })
  }

  const what = !file ? `Open the note's folder in ${current.name}` : current.kind === 'files' ? `Show this file in ${current.name}` : current.kind === 'editor' ? `Open this file in ${current.name}` : `Open its folder in ${current.name}`
  const items: MenuItem[] = []
  for (const { kind, label } of kinds) {
    const group = targets.filter((t) => t.kind === kind)
    if (!group.length) continue
    if (items.length) items.push({ kind: 'separator' })
    // A heading only once there's more than one group worth telling apart.
    if (targets.some((t) => t.kind !== 'files' && t.kind !== kind)) items.push({ kind: 'label', label })
    for (const t of group) items.push({ label: t.name, image: icons[t.id] ?? '', checked: t.id === current.id, testId: `open-in-${t.id}`, onSelect: () => go(t) })
  }

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
      <Button onPress={() => go(current)} testId="open-in" title={what} style={{ paddingLeft: 6, paddingRight: 6 }}>
        {icons[current.id] ? <img src={icons[current.id]} style={{ width: 18, height: 18 }} objectFit="contain" /> : <Icon name="folder" size={14} />}
      </Button>
      <Button onPress={() => setOpen((v) => !v && !closedByOutsidePress('open-in'))} selected={open} testId="open-in-menu-button" title="Open in another app" style={{ paddingLeft: 4, paddingRight: 4 }}>
        <Icon name="chevronDown" size={11} />
      </Button>
      <Menu open={open} onClose={() => setOpen(false)} side="bottom" align="end" width={220} testId="open-in-menu" closeKey="open-in" items={items} />
    </div>
  )
}
