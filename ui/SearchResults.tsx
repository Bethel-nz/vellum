import path from 'node:path'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGpuixRequired, useWindowSize, type KeyEvent, type PublicInstance } from '@gpuix/react'
import { Button as Base } from '@gpuix/react/button'
import { Button, closedByOutsidePress, Dot, Icon, Label, Menu, Segmented, type MenuItem } from '../components'
import type { Profile } from '../core/profiles'
import type { Thread } from '../core/threads'
import { keys, primary } from '../core/platform'
import { searchNote } from '../core/search'
import { ago } from './dialogs'
import { accentFor, radiusXl, shortPath } from './theme'
import { useM } from './kit'
import { useWindowed } from './windowed'

/** The shelf owns this state, so closing search or switching to recipes preserves it. */
export function useSearchResultsState() {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [sort, setSort] = useState<'match' | 'newest' | 'az'>('match')
  const [state, setState] = useState<'all' | 'open' | 'running'>('all')
  const [profile, setProfile] = useState<string>()
  const [project, setProject] = useState<string>()
  const [menu, setMenu] = useState(false)
  return { query, setQuery, active, setActive, sort, setSort, state, setState, profile, setProfile, project, setProject, menu, setMenu }
}

/** How many rows are mounted at once: a few screens' worth. */
const SPAN = 40

export function SearchResults({ threads, profiles, activeId, openIds, inputRef, onPick, onDelete, onClose, onKeyDown, controls }: {
  threads: Thread[]; profiles: Profile[]; activeId?: string; openIds: string[]; inputRef: React.RefObject<PublicInstance | null>
  onPick: (id: string) => void; onDelete: (id: string) => void; onClose: () => void; onKeyDown: (event: KeyEvent) => void
  controls: ReturnType<typeof useSearchResultsState>
}) {
  const m = useM()
  const renderer = useGpuixRequired()
  const window = useWindowSize()
  const wide = window.width >= 760
  const { query, setQuery, active, setActive, sort, setSort, state, setState, profile, setProfile, project, setProject, menu, setMenu } = controls
  const searched = useMemo(() => {
    const start = performance.now()
    const matches = threads.flatMap((thread) => { const result = searchNote(thread, query); return result ? [result] : [] })
    const results = matches.filter(({ thread }) => (state !== 'open' || openIds.includes(thread.id)) && (state !== 'running' || thread.running) && (!profile || profile === thread.profileId) && (!project || project === thread.workspace))
    results.sort((a, b) => sort === 'az' ? a.thread.title.localeCompare(b.thread.title, undefined, { sensitivity: 'base' }) : (sort === 'match' && query.trim() ? a.rank - b.rank : 0) || b.thread.updatedAt.localeCompare(a.thread.updatedAt))
    return { matches, results, elapsed: performance.now() - start }
  }, [threads, query, state, profile, project, sort, openIds])
  const projects = [...new Set(threads.map((thread) => thread.workspace))].sort()
  const choose = (index: number) => { const result = searched.results[index]; if (result) onPick(result.thread.id) }
  const reset = () => { setState('all'); setProfile(undefined); setProject(undefined); setActive(0) }
  // The row under the pointer or the arrows goes to the trash; the next one takes its place.
  const remove = (index: number) => {
    const result = searched.results[index]
    if (!result) return
    onDelete(result.thread.id)
    setActive(Math.min(index, Math.max(0, searched.results.length - 2)))
  }
  const key = (event: KeyEvent) => {
    onKeyDown(event)
    if (event.defaultPrevented) return
    // ⇧⌘⌫, since the field keeps ⌘⌫ (delete to the start of the line) to itself.
    if (primary(event.modifiers) && event.modifiers?.shift && event.key === 'backspace') { event.preventDefault(); remove(active); return }
    const direction = event.key === 'down' || (event.modifiers?.ctrl && event.key === 'n') ? 1 : event.key === 'up' || (event.modifiers?.ctrl && event.key === 'p') ? -1 : 0
    if (direction) { event.preventDefault(); setActive((index) => searched.results.length ? (index + direction + searched.results.length) % searched.results.length : 0) }
  }
  // The rows' callbacks keep their identity, so a row that didn't change isn't built again.
  const latest = useRef({ remove, onPick })
  latest.current = { remove, onPick }
  const removeRow = useCallback((index: number) => latest.current.remove(index), [])
  const pickRow = useCallback((id: string) => latest.current.onPick(id), [])
  // Only a window of rows near the viewport is mounted (ui/windowed.ts); the arrows bring their
  // row into view.
  const total = searched.results.length
  const rows = useWindowed(total, SPAN, [query, state, profile, project, sort])
  useEffect(() => rows.reveal(active, 0, true), [active])
  const stateOptions = [{ value: 'all', label: 'All notes' }, { value: 'open', label: 'Open tabs' }, { value: 'running', label: 'Running' }] as const
  // Filters live in the Filters menu; each row's hint is how many notes it would show.
  const count = (keep: (thread: Thread) => boolean) => String(searched.matches.filter(({ thread }) => keep(thread)).length)
  const filtered = state !== 'all' || Boolean(profile) || Boolean(project)
  // Built only while the menu is open: each row counts every match.
  const filterItems: MenuItem[] = !menu ? [] : [
    ...stateOptions.map((option) => ({ label: option.label, hint: count((thread) => option.value === 'all' || (option.value === 'open' ? openIds.includes(thread.id) : thread.running)), checked: state === option.value, testId: `history-filter-${option.value}`, onSelect: () => { setState(option.value); setActive(0) } })),
    { kind: 'separator' as const }, { kind: 'label' as const, label: 'Account' },
    { label: 'All accounts', hint: count(() => true), checked: !profile, testId: 'history-profile-all', onSelect: () => { setProfile(undefined); setActive(0) } },
    ...profiles.map((option) => ({ label: option.name, hint: count((thread) => thread.profileId === option.id), dot: accentFor(m, profiles, option.id), checked: profile === option.id, testId: `history-profile-${option.id}`, onSelect: () => { setProfile(option.id); setActive(0) } })),
    { kind: 'separator' as const }, { kind: 'label' as const, label: 'Project' },
    { label: 'All projects', hint: count(() => true), checked: !project, testId: 'history-project-all', onSelect: () => { setProject(undefined); setActive(0) } },
    ...projects.map((folder) => ({ label: path.basename(folder), hint: count((thread) => thread.workspace === folder), checked: project === folder, testId: `history-project-${folder}`, onSelect: () => { setProject(folder); setActive(0) } })),
    ...(filtered ? [{ kind: 'separator' as const }, { label: 'Clear filters', icon: 'x' as const, testId: 'history-reset-filters', onSelect: reset }] : []),
  ]
  return <>
    <div style={{ display: 'flex', flexDirection: 'row', gap: 8, padding: 14, borderBottomWidth: 1, borderColor: m.border, flexShrink: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 9, height: 38, paddingLeft: 12, paddingRight: 6, borderRadius: 19, backgroundColor: m.chipBg, flexGrow: 1, minWidth: 0 }}>
        <Icon name="search" size={16} />
        <input ref={inputRef} testId="history-input" value={query} placeholder="Search notes and conversations…" onChange={(event) => { setQuery(event.value ?? ''); setActive(0) }} onSubmit={() => choose(active)} onKeyDown={key} style={{ flexGrow: 1, minWidth: 0, fontSize: 13.5, color: m.text }} />
        {query ? <Button testId="history-clear" title="Clear search" onPress={() => { setQuery(''); setActive(0); if (inputRef.current) renderer.focusElement?.(inputRef.current.id) }} style={{ width: 26, height: 26, paddingLeft: 0, paddingRight: 0, borderRadius: 13 }}><Icon name="x" size={13} /></Button> : null}
      </div>
      <div style={{ position: 'relative' }}>
        <Button testId="history-filters" title="Filter notes" onPress={() => setMenu(!menu && !closedByOutsidePress('history-filters'))} selected={menu || filtered} style={{ height: 38, paddingLeft: 12, paddingRight: 12, borderRadius: 19, borderWidth: 1, borderColor: m.border }}><Icon name="settings" size={15} /><Label>Filters</Label></Button>
        <Menu open={menu} onClose={() => setMenu(false)} side="bottom" align="end" width={260} items={filterItems} testId="history-filter-menu" closeKey="history-filters" />
      </div>
    </div>
    <div style={{ display: 'flex', flexDirection: 'row', flexGrow: 1, minHeight: 0 }}>
      <div style={{ flexGrow: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, flexShrink: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 4, flexGrow: 1 }}><text testId="history-results" style={{ fontSize: 12, lineHeight: 17, color: m.textUi }}>{`${searched.results.length} ${searched.results.length === 1 ? 'result' : 'results'}`}</text>{wide ? <text style={{ fontSize: 10.5, lineHeight: 16, color: m.textFaint }}>{`in ${searched.elapsed < 10 ? '<0.01' : (searched.elapsed / 1000).toFixed(2)} seconds`}</text> : null}</div>
          <Segmented pill testId="history-sort" value={sort} onChange={(value) => { setSort(value); setActive(0) }} width={74} options={[{ value: 'match', label: 'Best match' }, { value: 'newest', label: 'Newest' }, { value: 'az', label: 'A to Z' }]} />
        </div>
        {!searched.results.length ? <text style={{ padding: 24, fontSize: 13, lineHeight: 18, color: m.textMuted }}>{threads.length ? `No notes match “${query.trim()}”.` : 'No notes yet.'}</text> : null}
        <virtual-list
          {...rows.props}
          testId="history-list"
          alignment="top"
          estimatedItemHeight={110}
          overdraw={400}
          style={{ flexGrow: 1, minHeight: 0, width: '100%', scrollbarColor: m.scrollbar, scrollbarWidth: 6 }}
        >
          {searched.results.slice(rows.start, rows.end).map(({ thread, excerpt }, i) => {
            const index = rows.start + i
            return <HistoryRow key={thread.id} thread={thread} excerpt={excerpt} index={index} active={index === active} current={thread.id === activeId} open={openIds.includes(thread.id)} query={query.trim()} profiles={profiles} last={index === total - 1} onPick={pickRow} onHover={setActive} onRemove={removeRow} />
          })}
        </virtual-list>
      </div>
    </div>
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: 36, paddingLeft: 16, paddingRight: 12, borderTopWidth: 1, borderColor: m.border }}><text style={{ fontSize: 11, lineHeight: 16, color: m.textFaint, flexGrow: 1 }}>{keys('↩ open · ⇧⌘⌫ move to Trash · ⌃N ⌃P move · esc close')}</text><Button testId="history-close" title="Close (esc)" onPress={onClose} style={{ width: 24, paddingLeft: 0, paddingRight: 0 }}><Icon name="x" size={12} /></Button></div>
  </>
}

/** One past note. Memoized: hovering moves `active`, and only the two rows it moves between change. */
const HistoryRow = memo(function HistoryRow({ thread, excerpt, index, active, current, open, query, profiles, last, onPick, onHover, onRemove }: {
  thread: Thread; excerpt?: string; index: number; active: boolean; current: boolean; open: boolean; query: string; profiles: Profile[]; last: boolean
  onPick: (id: string) => void; onHover: (index: number) => void; onRemove: (index: number) => void
}) {
  const m = useM()
  const highlight = query ? { query, caseSensitive: false, color: m.selected } : undefined
  return (
    <div style={{ position: 'relative', paddingLeft: 10, paddingRight: 10, paddingBottom: last ? 14 : 4 }}>
      <Base testId={`history-${thread.id}`} aria-label={thread.title} onClick={() => onPick(thread.id)} onMouseEnter={() => onHover(index)} style={{ display: 'flex', flexDirection: 'row', alignItems: 'start', gap: 12, padding: 14, borderRadius: radiusXl, backgroundColor: active ? m.popupHover : '#00000000', hover: { backgroundColor: m.popupHover }, focusVisible: { outlineWidth: 2, outlineColor: m.focusRing } }}>
        <div style={{ paddingTop: 2 }}><Icon name="notes" size={16} color={m.textMuted} /></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flexGrow: 1, minWidth: 0 }}>
          <text highlight={highlight} style={{ fontSize: 13, lineHeight: 18, color: current ? m.text : m.textUi, fontWeight: 500 }}>{thread.title}</text>
          <text style={{ fontSize: 11, lineHeight: 16, color: m.textMuted, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{shortPath(thread.workspace)}</text>
          {excerpt ? <text highlight={highlight} style={{ fontSize: 12, lineHeight: 18, color: m.textMuted, lineClamp: 2, textOverflow: 'ellipsis' }}>{excerpt}</text> : null}
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}><Dot color={accentFor(m, profiles, thread.profileId)} size={5} /><text style={{ fontSize: 10.5, lineHeight: 15, color: m.textMuted }}>{`${profiles.find((item) => item.id === thread.profileId)?.name ?? thread.profileId} · Updated ${ago(thread.updatedAt)}${open ? ' · Open' : ''}${thread.running ? ' · Thinking' : ''}`}</text></div>
        </div>
      </Base>
      {/* Beside the row, not in it: a press on it must not open the note too. */}
      {active ? <div style={{ position: 'absolute', top: 10, right: 20 }}><Button testId={`history-delete-${thread.id}`} title={keys('Move to Trash (⇧⌘⌫)')} onPress={() => onRemove(index)} style={{ width: 28, height: 28, minHeight: 28, paddingLeft: 0, paddingRight: 0 }}><Icon name="trash" size={14} /></Button></div> : null}
    </div>
  )
})
