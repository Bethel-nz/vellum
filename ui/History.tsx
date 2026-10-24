// Past notes and recipes, as a sidebar from the left (the shelf in the strip; ⌘Y opens past notes,
// ⇧⌘Y recipes). Tabs stop at nine, so this is where everything else lives: every note, newest
// first, grouped by day, with a filter that has focus as it opens. ↑↓ or ⌃N ⌃P move, ↩ opens,
// esc closes. ⌘K stays the quick jump. Recipes are the other side (ui/Recipes.tsx).

import { useMemo, useRef, useState } from 'react'
import { useGpuixRequired, type KeyEvent, type PublicInstance } from '@gpuix/react'
import { Button, Label, Menu, Scroll, Segmented, SidePanel } from '../components'
import { keys, primary } from '../core/platform'
import type { Profile } from '../core/profiles'
import type { Recipe } from '../core/recipes'
import { RecipesView } from './Recipes'
import type { Thread } from '../core/threads'
import { ago, Row } from './dialogs'
import { Dot, Icon, Meta, useM } from './kit'
import { accentFor, font } from './theme'
import path from 'node:path'

const DAY = 86_400_000

function dayGroup(iso: string, now = new Date()): string {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const t = new Date(iso).getTime()
  if (t >= start) return 'Today'
  if (t >= start - DAY) return 'Yesterday'
  if (t >= start - 6 * DAY) return 'This week'
  if (t >= start - 29 * DAY) return 'This month'
  return 'Earlier'
}

export function History({
  open,
  onClose,
  threads,
  profiles,
  activeId,
  openIds,
  onPick,
  view,
  onView,
  recipes,
  folder,
  onUseRecipe,
  onRecipesChanged,
}: {
  open: boolean
  onClose: () => void
  threads: Thread[]
  profiles: Profile[]
  activeId?: string
  openIds: string[]
  onPick: (id: string) => void
  view: 'history' | 'recipes'
  onView: (view: 'history' | 'recipes') => void
  recipes: Recipe[]
  /** The note's folder, for its project recipes. */
  folder?: string
  onUseRecipe: (name: string) => void
  onRecipesChanged: () => void
}) {
  const m = useM()
  const renderer = useGpuixRequired()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [sort, setSort] = useState<'match' | 'newest' | 'az'>('match')
  const [filter, setFilter] = useState<'all' | 'open' | 'running'>('all')
  const [profile, setProfile] = useState<string | undefined>(undefined)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const inputRef = useRef<PublicInstance>(null)
  const recipesRef = useRef<PublicInstance>(null)
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = threads
      .filter((t) => !q || t.title.toLowerCase().includes(q) || t.workspace.toLowerCase().includes(q))
      .filter((t) => (filter !== 'open' || openIds.includes(t.id)) && (filter !== 'running' || t.running) && (!profile || t.profileId === profile))
    const rank = (t: Thread) => t.title.toLowerCase() === q ? 0 : t.title.toLowerCase().startsWith(q) ? 1 : t.title.toLowerCase().includes(q) ? 2 : 3
    list.sort((a, b) => sort === 'az' ? a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) : (sort === 'match' && q ? rank(a) - rank(b) : 0) || b.updatedAt.localeCompare(a.updatedAt))
    const out: [string, Thread[]][] = []
    for (const t of list) {
      const g = sort === 'az' || (sort === 'match' && q) ? 'Results' : dayGroup(t.updatedAt)
      const last = out.at(-1)
      if (last?.[0] === g) last[1].push(t)
      else out.push([g, [t]])
    }
    return out
  }, [threads, query, sort, filter, profile, openIds])
  const flat = groups.flatMap(([, ts]) => ts)
  const pick = (t?: Thread) => t && onPick(t.id)

  const onKeyDown = (e: KeyEvent) => {
    const step = (d: number) => {
      e.preventDefault()
      setActive((a) => (flat.length ? (a + d + flat.length) % flat.length : 0))
    }
    if (e.key === 'escape' || (primary(e.modifiers) && e.key === 'y' && !e.modifiers?.shift)) {
      e.preventDefault()
      onClose()
    } else if (primary(e.modifiers) && e.key === 'y' && e.modifiers?.shift) {
      e.preventDefault()
      onView(view === 'recipes' ? 'history' : 'recipes')
    } else if ((e.modifiers?.ctrl && e.key === 'n') || e.key === 'down') step(1)
    else if ((e.modifiers?.ctrl && e.key === 'p') || e.key === 'up') step(-1)
  }

  return (
    <SidePanel open={open} onClose={onClose} side="left" width={480} initialFocus={view === 'recipes' ? recipesRef : inputRef} testId="history">
      <div style={{ display: 'flex', flexDirection: 'row', paddingLeft: 14, paddingRight: 14, paddingTop: 14, flexShrink: 0 }}>
        <Segmented<'history' | 'recipes'> pill testId="history-view" value={view} onChange={onView} width={96} options={[{ value: 'history', label: 'Past notes' }, { value: 'recipes', label: 'Recipes' }]} />
      </div>
      {view === 'recipes' ? (
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, paddingTop: 12 }}>
          <RecipesView recipes={recipes} folder={folder} onUse={onUseRecipe} onChanged={onRecipesChanged} inputRef={recipesRef} onKeyDown={onKeyDown} />
        </div>
      ) : (
      <>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, borderBottomWidth: 1, borderColor: m.border, flexShrink: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 9, height: 38, paddingLeft: 12, paddingRight: 6, borderRadius: 19, backgroundColor: m.chipBg, borderWidth: 1, borderColor: m.border, flexGrow: 1, minWidth: 0 }}>
        <Icon name="search" size={16} />
        <input
          ref={inputRef}
          testId="history-input"
          value={query}
          placeholder="Past notes…"
          onChange={(e) => {
            setQuery(e.value ?? '')
            setActive(0)
          }}
          onSubmit={() => pick(flat[active])}
          onKeyDown={onKeyDown}
          style={{ flexGrow: 1, minWidth: 0, fontSize: 13.5, color: m.text }}
        />
        {query ? <Button onPress={() => { setQuery(''); setActive(0); if (inputRef.current) renderer.focusElement?.(inputRef.current.id) }} testId="history-clear" title="Clear search" style={{ width: 26, height: 26, paddingLeft: 0, paddingRight: 0, borderRadius: 13 }}><Icon name="x" size={14} /></Button> : null}
      </div>
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <Button onPress={() => setFiltersOpen((value) => !value)} testId="history-filters" title="Filter notes" selected={filtersOpen || filter !== 'all' || Boolean(profile)} style={{ height: 38, paddingLeft: 12, paddingRight: 12, borderRadius: 19, borderWidth: 1, borderColor: m.border, gap: 8 }}><Icon name="settings" size={16} /><Label>Filters</Label></Button>
        <Menu open={filtersOpen} onClose={() => setFiltersOpen(false)} side="bottom" align="end" width={240} testId="history-filter-menu" items={[
          ...([{ value: 'all', label: 'All notes' }, { value: 'open', label: 'Open tabs' }, { value: 'running', label: 'Running' }] as const).map((option) => ({ label: option.label, checked: filter === option.value, testId: `history-filter-${option.value}`, onSelect: () => { setFilter(option.value); setActive(0) } })),
          { kind: 'separator' }, { kind: 'label', label: 'Account' },
          { label: 'All accounts', checked: !profile, testId: 'history-profile-all', onSelect: () => { setProfile(undefined); setActive(0) } },
          ...profiles.map((option) => ({ label: option.name, dot: accentFor(m, profiles, option.id), checked: profile === option.id, testId: `history-profile-${option.id}`, onSelect: () => { setProfile(option.id); setActive(0) } })),
        ]} />
      </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingLeft: 16, paddingRight: 14, paddingTop: 12, paddingBottom: 12, flexShrink: 0 }}>
        <text testId="history-results" style={{ fontSize: 12, lineHeight: 17, color: m.textMuted }}>{`${flat.length} ${flat.length === 1 ? 'result' : 'results'}`}</text>
        <Segmented<'match' | 'newest' | 'az'> pill testId="history-sort" value={sort} onChange={(value) => { setSort(value); setActive(0) }} width={82} options={[{ value: 'match', label: 'Best match' }, { value: 'newest', label: 'Newest' }, { value: 'az', label: 'A to Z' }]} />
      </div>
      <Scroll style={{ flexGrow: 1 }} padding={6}>
        {flat.length === 0 ? (
          <div style={{ padding: 14 }}>
            <text style={{ fontSize: 13, lineHeight: 18, color: m.textMuted }}>{threads.length ? `No notes match “${query.trim()}”.` : keys('No notes yet. ⌘N starts one.')}</text>
          </div>
        ) : null}
        {groups.map(([label, ts]) => (
          <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 1, paddingBottom: 8 }}>
            <div style={{ paddingLeft: 10, paddingTop: 6, paddingBottom: 4 }}>
              <text style={{ fontSize: 11, lineHeight: 14, color: m.textFaint, fontWeight: 500 }}>{label}</text>
            </div>
            {ts.map((t) => {
              const i = flat.indexOf(t)
              return (
                <Row key={t.id} selected={i === active} onPress={() => pick(t)} testId={`history-${t.id}`}>
                  <Dot color={t.running ? m.accent : accentFor(m, profiles, t.profileId)} pulse={t.running} />
                  <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0, paddingTop: 5, paddingBottom: 5 }}>
                    <text style={{ fontSize: 13, lineHeight: 17, color: t.id === activeId ? m.text : m.textUi, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{t.title}</text>
                    <text style={{ fontSize: 11, lineHeight: 14, color: m.textFaint, fontFamily: font.mono, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{`${path.basename(t.workspace)}/`}</text>
                  </div>
                  {openIds.includes(t.id) ? <Meta color={m.textMuted}>open</Meta> : null}
                  <Meta>{ago(t.updatedAt)}</Meta>
                </Row>
              )
            })}
          </div>
        ))}
      </Scroll>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 12, height: 36, borderTopWidth: 1, borderColor: m.border, flexShrink: 0 }}>
        <Meta>{keys('↩ open · ⌃N ⌃P move · esc close')}</Meta>
        <div style={{ flexGrow: 1 }} />
        <Button onPress={onClose} testId="history-close" title="Close (esc)" style={{ width: 24, paddingLeft: 0, paddingRight: 0 }}><Icon name="x" size={13} /></Button>
      </div>
      </>
      )}
    </SidePanel>
  )
}
