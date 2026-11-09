import path from 'node:path'
import { useEffect, useRef, useState } from 'react'
import { useGpuixRequired, useWindowSize, type PublicInstance } from '@gpuix/react'
import { Button, Field, Menu, closedByOutsidePress, type MenuItem } from '../components'
import { keys } from '../core/platform'
import { Icon, useM } from './kit'
import { shortPath, type } from './theme'

/** A project changes the page you see, never the folder of an existing note. */
export function ProjectPicker({ workspace, recent, open, onOpenChange, onPick, onBrowse, onOpenFile }: {
  workspace: string
  recent: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (folder: string) => void
  onBrowse: () => void
  onOpenFile: () => void
}) {
  const renderer = useGpuixRequired()
  const m = useM()
  const window = useWindowSize()
  const search = useRef<PublicInstance>(null)
  const [query, setQuery] = useState('')
  useEffect(() => {
    if (!open) return
    setQuery('')
    const timer = setTimeout(() => { if (search.current) renderer.focusElement?.(search.current.id) }, 32)
    return () => clearTimeout(timer)
  }, [open, renderer])
  const matches = (folder: string) => folder.toLowerCase().includes(query.trim().toLowerCase())
  // Search reaches every saved project; the visible list stays inside a short window.
  const limit = Math.max(1, Math.min(8, Math.floor((window.height - 210) / 28)))
  const folders = recent.filter((folder) => folder !== workspace && matches(folder)).slice(0, limit)
  const item = (folder: string, testId: string): MenuItem => ({
    label: path.basename(folder) || folder, icon: 'folder', hint: shortPath(path.dirname(folder)),
    checked: folder === workspace, testId, onSelect: () => onPick(folder),
  })
  return <div style={{ position: 'relative', flexShrink: 0 }}>
    <Button testId="project-picker" title={`Project: ${workspace} · ${keys('⌘O')} opens a folder`} selected={open} expanded={open} onPress={() => onOpenChange(!open && !closedByOutsidePress('projects'))}>
      <Icon name="folder" size={14} />
      <text style={{ ...type.label, color: m.text, maxWidth: window.width < 800 ? 80 : 120, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{path.basename(workspace) || workspace}</text>
      <Icon name="chevronDown" size={11} />
    </Button>
    <Menu open={open} onClose={() => onOpenChange(false)} testId="project-menu" closeKey="projects" width={Math.min(360, window.width - 24)} header={(submit) => <Field fieldRef={search} testId="project-search" placeholder="Search projects…" value={query} onChange={setQuery} onSubmit={submit} />} items={[
      ...(matches(workspace) ? [{ kind: 'label', label: 'This window' } as MenuItem, item(workspace, 'project-current')] : []),
      ...(folders.length ? [{ kind: 'label', label: 'Recent projects' } as MenuItem, ...folders.map((folder, index) => item(folder, `project-recent-${index}`))] : []),
      ...(!matches(workspace) && !folders.length ? [{ kind: 'label', label: 'No matching projects' } as MenuItem] : []),
      { kind: 'separator' },
      { label: 'Open folder…', icon: 'folderPlus', shortcut: '⌘O', testId: 'project-open-folder', onSelect: onBrowse },
      { label: 'Open note…', hint: '.vel or any file', icon: 'file', testId: 'project-open-file', onSelect: onOpenFile },
    ]} />
  </div>
}
