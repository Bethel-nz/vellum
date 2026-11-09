import path from 'node:path'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useGpuixRequired, useIsPresent, type PublicInstance } from '@gpuix/react'
import { Button as Base } from '@gpuix/react/button'
import { AnimatePresence, motion } from '../components/spring'
import { spring, tween, useReducedMotion } from '../components/motion'
import { Scroll } from '../components/Scroll'
import { font, radiusBase, radiusXl, scrollbarWidth } from './theme'
import { Button, CloseButton, closedByOutsidePress, Icon, Label, Menu, Meta, Segmented, SidePanel, type MenuItem } from '../components'
import { annotationPage, captureOpen, type AnnotationCapture } from '../core/annotations'
import type { CaptureStatus, SavedCapture } from '../core/capture'
import { captureDir } from '../core/captures'
import type { Thread } from '../core/threads'
import { useWindowed } from './windowed'
import { useM } from './kit'

type Filter = 'all' | 'open' | 'resolved' | 'dismissed'
const statusNames: Record<CaptureStatus, string> = { queued: 'Queued', acknowledged: 'Seen', resolved: 'Resolved', dismissed: 'Dismissed' }
const identity = (saved: SavedCapture) => `${saved.noteId}/${saved.capture.id}`

export function Annotations({ open, onClose, captures, notes, onOpen, onInspect, onStatus, onSend, onSendToAgent }: {
  open: boolean
  onClose: () => void
  captures: AnnotationCapture[]
  notes: Thread[]
  onOpen: (saved: SavedCapture) => void
  onInspect: (saved: SavedCapture) => void
  onStatus: (saved: SavedCapture, status: CaptureStatus) => void
  onSend: (saved: SavedCapture, noteId: string) => Promise<void>
  onSendToAgent: (saved: SavedCapture) => void
}) {
  const m = useM()
  const renderer = useGpuixRequired()
  const input = useRef<PublicInstance>(null)
  const routeInput = useRef<PublicInstance>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('open')
  const [expanded, setExpanded] = useState<string>()
  const [host, setHost] = useState<string>()
  const [project, setProject] = useState<string>()
  const [filterMenu, setFilterMenu] = useState(false)
  const [actionMenu, setActionMenu] = useState<string>()
  const [routeMenu, setRouteMenu] = useState<string>()
  const [routeQuery, setRouteQuery] = useState('')
  const [sending, setSending] = useState<string>()
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) { setActionMenu(undefined); setRouteMenu(undefined); setFilterMenu(false); return }
    if (!routeMenu) return
    const timer = setTimeout(() => { if (routeInput.current) renderer.focusElement?.(routeInput.current.id) }, 16)
    return () => clearTimeout(timer)
  }, [open, routeMenu, renderer])
  const hosts = useMemo(() => [...new Set(captures.map(({ saved }) => annotationPage(saved.capture.page.url).host))].sort(), [captures])
  const projects = useMemo(() => [...new Set(captures.map(({ note }) => note.workspace).filter(Boolean))].sort(), [captures])
  const scoped = useMemo(() => captures.filter(({ saved, note }) => {
    if (host && annotationPage(saved.capture.page.url).host !== host || project && note.workspace !== project) return false
    const text = query.trim().toLowerCase()
    return !text || [saved.capture.page.url, saved.capture.page.title, note.title, note.workspace, saved.summary, saved.reply, ...saved.capture.elements.flatMap((element) => [element.note, element.selector, element.react?.component])].some((value) => value?.toLowerCase().includes(text))
  }), [captures, host, project, query])
  const counts = { all: scoped.length, open: scoped.filter(({ saved }) => captureOpen(saved)).length, resolved: scoped.filter(({ saved }) => saved.status === 'resolved').length, dismissed: scoped.filter(({ saved }) => saved.status === 'dismissed').length }
  const filtered = useMemo(() => scoped.filter(({ saved }) => filter === 'all' || (filter === 'open' ? captureOpen(saved) : saved.status === filter)), [scoped, filter])
  const window = useWindowed(filtered.length, 20, [query, filter, host, project])
  const filters: MenuItem[] = [
    { kind: 'label', label: 'Site' },
    { label: 'All sites', checked: !host, onSelect: () => setHost(undefined) },
    ...hosts.map((value) => ({ label: value, checked: host === value, testId: `annotations-host-${value}`, onSelect: () => setHost(value) })),
    { kind: 'separator' }, { kind: 'label', label: 'Project' },
    { label: 'All projects', checked: !project, onSelect: () => setProject(undefined) },
    ...projects.map((value) => ({ label: path.basename(value), hint: value, checked: project === value, testId: `annotations-project-${path.basename(value)}`, onSelect: () => setProject(value) })),
    ...(host || project ? [{ kind: 'separator' as const }, { label: 'Clear filters', icon: 'x' as const, onSelect: () => { setHost(undefined); setProject(undefined) } }] : []),
  ]
  const route = async (saved: SavedCapture, noteId: string) => {
    setSending(identity(saved))
    setError('')
    setRouteMenu(undefined)
    try { await onSend(saved, noteId) }
    catch (e) { setError((e as Error).message) }
    finally { setSending(undefined) }
  }

  return <SidePanel open={open} onClose={onClose} width={600} initialFocus={input} testId="annotations">
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 9, height: 52, paddingLeft: 20, paddingRight: 14, flexShrink: 0 }}>
      <Icon name="pencil" size={15} color={m.textMuted} />
      <text style={{ fontSize: 14, lineHeight: 20, fontWeight: 600, color: m.text }}>Annotations</text>
      <div style={{ flexGrow: 1 }} />
      <CloseButton onPress={onClose} title="Close annotations (esc)" testId="annotations-close" />
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingLeft: 16, paddingRight: 16, paddingBottom: 16, flexShrink: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {/* The same search pill and Filters pill as the Library (ui/SearchResults.tsx). */}
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 9, height: 38, paddingLeft: 12, paddingRight: 12, borderRadius: 19, backgroundColor: m.chipBg, flexGrow: 1, minWidth: 0 }}>
          <Icon name="search" size={16} />
          <input ref={input} value={query} testId="annotations-search" placeholder="Search annotations…" onChange={(event) => setQuery(event.value ?? '')} style={{ flexGrow: 1, minWidth: 0, fontSize: 13.5, color: m.text }} />
        </div>
        <div onKeyDown={(event) => { if (event.key === 'escape' && filterMenu) { event.preventDefault(); event.stopPropagation(); setFilterMenu(false) } }} style={{ position: 'relative', flexShrink: 0 }}>
          <Button testId="annotations-filter" selected={filterMenu || Boolean(host || project)} title="Filter by site or project" onPress={() => setFilterMenu((value) => !value && !closedByOutsidePress('annotations-filter'))} style={{ height: 38, paddingLeft: 12, paddingRight: 12, borderRadius: 19, borderWidth: 1, borderColor: m.border }}><Icon name="settings" size={15} /><Label>Filters</Label></Button>
          <Menu open={filterMenu} onClose={() => setFilterMenu(false)} items={filters} side="bottom" align="end" width={280} closeKey="annotations-filter" testId="annotations-filters" />
        </div>
      </div>
      <Segmented pill testId="annotations-state" value={filter} onChange={setFilter} width="fill" options={([
        ['all', 'All'], ['open', 'Open'], ['resolved', 'Resolved'], ['dismissed', 'Dismissed'],
      ] as const).map(([value, label]) => ({ value, label: `${label} ${counts[value]}` }))} />
      {host || project ? <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}><Meta color={m.textMuted}>{[host, project && path.basename(project)].filter(Boolean).join(' · ')}</Meta><Button onPress={() => { setHost(undefined); setProject(undefined) }} title="Clear annotation filters"><Icon name="x" size={11} /></Button></div> : null}
      {error ? <text style={{ fontSize: 12, lineHeight: 17, color: m.danger }}>{error}</text> : null}
    </div>
    {!filtered.length ? <div testId="annotations-empty" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 7 }}><text style={{ fontSize: 13, lineHeight: 19, color: m.textUi }}>{captures.length ? 'No annotations match.' : 'No annotations yet.'}</text><text style={{ fontSize: 12, lineHeight: 18, color: m.textMuted }}>{captures.length ? 'Try another filter or search.' : 'Select elements with Vellum Snapshot and send them to a note.'}</text></div> : null}
    <virtual-list {...window.props} testId="annotations-list" alignment="top" estimatedItemHeight={132} overdraw={400} style={{ flexGrow: 1, minHeight: 0, marginLeft: 16, marginRight: 16, marginBottom: 16, borderRadius: radiusXl, borderWidth: filtered.length ? 1 : 0, borderColor: m.border, backgroundColor: m.pane, scrollbarColor: m.scrollbar, scrollbarWidth }}>
      {filtered.slice(window.start, window.end).map(({ saved, note }) => {
        const id = identity(saved)
        const isExpanded = expanded === id
        const targets = routeMenu === id ? notes.filter((target) => target.id !== note.id && (!routeQuery.trim() || `${target.title} ${target.workspace}`.toLowerCase().includes(routeQuery.trim().toLowerCase()))).slice(0, 12) : []
        const busy = sending === id
        const statusColor = saved.status === 'resolved' ? m.success : saved.status === 'dismissed' ? m.textMuted : m.blue
        const statusIcon = saved.status === 'resolved' ? 'circleCheck' : saved.status === 'acknowledged' ? 'checkCheck' : saved.status === 'dismissed' ? 'ban' : 'circleDot'
        const page = annotationPage(saved.capture.page.url)
        const messages = [...new Set(saved.capture.elements.map((element) => element.note?.trim()).filter(Boolean))]
        const title = messages[0] || saved.capture.page.title || 'Page annotation'
        return <div key={id} testId={`annotation-${saved.capture.id}`} style={{ display: 'flex', flexDirection: 'column', borderBottomWidth: 1, borderColor: m.border, padding: 14, gap: 8 }}>
          <Base testId={`annotation-toggle-${saved.capture.id}`} aria-label={title} aria-expanded={isExpanded} onClick={() => setExpanded((current) => current === id ? undefined : id)} style={{ display: 'flex', flexDirection: 'row', alignItems: 'start', gap: 10, minHeight: 22, borderRadius: 4, hover: { backgroundColor: m.hover }, focusVisible: { outlineWidth: 2, outlineColor: m.focusRing, outlineOffset: 2 } }}>
            <text style={{ flexGrow: 1, minWidth: 0, fontSize: 13, lineHeight: 19, fontWeight: 500, color: m.text, lineClamp: 2 }}>{title.replace(/\s+/g, ' ')}</text>
            <text style={{ fontSize: 11, lineHeight: 19, color: m.textMuted, flexShrink: 0 }}>{age(saved.capture.createdAt)}</text>
            <Icon name={isExpanded ? 'chevronUp' : 'chevronDown'} size={13} color={m.textMuted} />
          </Base>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <Icon name="link" size={11} color={m.textMuted} />
            <text style={{ flexGrow: 1, minWidth: 0, fontSize: 11, lineHeight: 16, color: m.textMuted, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{page.label}</text>
            <Icon name="notes" size={11} color={m.textMuted} />
            <text style={{ maxWidth: 170, minWidth: 0, fontSize: 11, lineHeight: 16, color: m.textMuted, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{note.title}</text>
          </div>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name={statusIcon} size={13} color={statusColor} />
            <text style={{ fontSize: 11.5, lineHeight: 17, color: statusColor }}>{statusNames[saved.status]}</text>
            <text style={{ fontSize: 11, lineHeight: 17, color: m.textMuted }}>{`${saved.capture.elements.length} ${saved.capture.elements.length === 1 ? 'element' : 'elements'}`}</text>
            <div style={{ flexGrow: 1 }} />
            <Button onPress={() => onOpen(saved)} testId={`annotation-open-${saved.capture.id}`} title={`Open ${note.title}`} style={{ height: 26, borderRadius: 13, paddingLeft: 10, paddingRight: 10, backgroundColor: m.chipBg, borderWidth: 1, borderColor: m.border }}><Icon name="notes" size={12} /><Label>Open note</Label></Button>
            {captureOpen(saved) ? <Button onPress={() => onStatus(saved, 'resolved')} disabled={busy} testId={`annotation-resolve-${saved.capture.id}`} title="Resolve annotation" style={{ width: 26, height: 26, paddingLeft: 0, paddingRight: 0 }}><Icon name="circleCheck" size={15} color={m.textMuted} /></Button> : null}
            <div onKeyDown={(event) => { if (event.key === 'escape' && (actionMenu === id || routeMenu === id)) { event.preventDefault(); event.stopPropagation(); setActionMenu(undefined); setRouteMenu(undefined) } }} style={{ position: 'relative' }}>
              <Button onPress={() => setActionMenu((value) => value === id || closedByOutsidePress(`annotation-${id}`) ? undefined : id)} disabled={busy} testId={`annotation-actions-${saved.capture.id}`} title="Annotation actions" style={{ width: 26, height: 26, paddingLeft: 0, paddingRight: 0 }}><Icon name="more" size={15} /></Button>
              <Menu open={actionMenu === id} onClose={() => setActionMenu(undefined)} align="end" width={230} closeKey={`annotation-${id}`} items={[
                ...(saved.status === 'queued' && !saved.delivery ? [{ label: 'Send to agent', icon: 'send' as const, onSelect: () => onSendToAgent(saved) }] : []),
                { label: 'Inspect capture', icon: 'search', onSelect: () => onInspect(saved) },
                { label: 'Send to another note…', icon: 'notes', testId: `annotation-route-${saved.capture.id}`, onSelect: () => { setRouteQuery(''); setRouteMenu(id) } },
                { kind: 'separator' },
                captureOpen(saved) ? { label: 'Dismiss', icon: 'x', testId: `annotation-dismiss-${saved.capture.id}`, onSelect: () => onStatus(saved, 'dismissed') } : { label: 'Reopen', icon: 'refresh', testId: `annotation-reopen-${saved.capture.id}`, onSelect: () => onStatus(saved, 'queued') },
              ]} />
              <Menu open={routeMenu === id} onClose={() => setRouteMenu(undefined)} align="end" width={300} closeKey={`annotation-route-${id}`} testId="annotation-route-menu" header={(submit) => <div style={{ padding: 8 }}><input onSubmit={submit} ref={routeInput} value={routeQuery} testId="annotation-route-search" placeholder="Find a destination note…" onChange={(event) => setRouteQuery(event.value ?? '')} onKeyDown={(event) => { if (!['escape', 'down', 'up', 'enter'].includes(event.key ?? '') && !(event.modifiers?.ctrl && ['n', 'p'].includes(event.key ?? ''))) event.stopPropagation() }} style={{ height: 30, paddingLeft: 8, paddingRight: 8, fontSize: 12, color: m.text, backgroundColor: m.chipBg, borderRadius: 6 }} /></div>} items={targets.length ? targets.map((target) => ({ label: target.title, hint: target.workspace ? path.basename(target.workspace) : undefined, testId: `annotation-target-${target.id}`, onSelect: () => void route(saved, target.id) })) : [{ kind: 'label', label: 'No matching notes' }]} />
            </div>
          </div>
          {!isExpanded && (saved.summary || saved.reply) ? <text style={{ fontSize: 11.5, lineHeight: 17, color: m.textMuted, lineClamp: 1 }}>{saved.summary || saved.reply}</text> : null}
          <AnimatePresence initial={false}>{isExpanded ? <AnnotationDetails key="details" saved={saved} workspace={note.workspace} onInspect={() => onInspect(saved)} /> : null}</AnimatePresence>
        </div>
      })}
    </virtual-list>
  </SidePanel>
}

function age(at: string) {
  const elapsed = Date.now() - Date.parse(at)
  if (!Number.isFinite(elapsed)) return ''
  const minutes = Math.max(0, Math.floor(elapsed / 60_000))
  if (!minutes) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function AnnotationDetails({ saved, workspace, onInspect }: { saved: SavedCapture; workspace: string; onInspect: () => void }) {
  const m = useM()
  const reduced = useReducedMotion()
  const present = useIsPresent()
  const [height, setHeight] = useState(0)
  return <motion.div initial={reduced ? false : { height: 0, opacity: 0 }} animate={{ height, opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={tween(spring.smooth)} style={{ position: 'relative', overflow: 'hidden', flexShrink: 0, pointerEvents: 'none' }}>
    <div onLayout={(event) => { const next = Math.ceil(event.height ?? 0); setHeight((previous) => previous === next ? previous : next) }} style={{ position: 'absolute', top: 0, left: 0, right: 0, display: 'flex', flexDirection: 'column', pointerEvents: present ? 'auto' : 'none', paddingTop: 6 }}>
      <Scroll testId={`annotation-details-${saved.capture.id}`} style={{ maxHeight: 360, borderRadius: radiusBase, backgroundColor: m.popup }} padding={12} gap={14}>
        <text style={{ fontSize: 11.5, lineHeight: 17, fontWeight: 500, color: m.textMuted }}>Selected elements</text>
        {saved.capture.elements.map((element, index) => <div key={`${element.ref}-${index}`} style={{ display: 'flex', flexDirection: 'row', gap: 12, alignItems: 'start' }}>
          <Button onPress={onInspect} title="Inspect captured elements" testId={`annotation-inspect-${saved.capture.id}-${index}`} style={{ width: 76, height: 56, flexShrink: 0, paddingLeft: 0, paddingRight: 0, borderRadius: 6, overflow: 'hidden', backgroundColor: m.chipBg, borderWidth: 1, borderColor: m.border }}><img src={path.join(captureDir(saved.noteId, saved.capture.id), element.shots.element)} objectFit="contain" style={{ width: '100%', height: '100%', borderRadius: 6 }} /></Button>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1, minWidth: 0 }}>
            <text style={{ fontSize: 12.5, lineHeight: 18, color: m.text }}>{element.note?.trim() || 'Captured element'}</text>
            <text style={{ fontSize: 10.5, lineHeight: 16, color: m.textMuted, fontFamily: font.mono }}>{element.react?.component || element.selector}</text>
          </div>
        </div>)}
        {saved.summary ? <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><Meta color={m.textMuted}>Update</Meta><text style={{ fontSize: 12, lineHeight: 18, color: m.textUi }}>{saved.summary}</text></div> : null}
        {saved.reply && saved.reply !== saved.summary ? <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><Meta color={m.textMuted}>Agent response</Meta><text style={{ fontSize: 12, lineHeight: 18, color: m.textUi }}>{saved.reply}</text></div> : null}
        {workspace ? <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><Meta color={m.textMuted}>Project</Meta><text style={{ fontSize: 11, lineHeight: 16, color: m.textMuted, fontFamily: font.mono }}>{workspace}</text></div> : null}
        <Button testId={`annotation-view-${saved.capture.id}`} onPress={onInspect} style={{ alignSelf: 'start', paddingLeft: 0 }}><Icon name="search" size={12} /><Label>Inspect capture</Label></Button>
      </Scroll>
    </div>
  </motion.div>
}
