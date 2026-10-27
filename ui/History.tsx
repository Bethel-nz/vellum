// Past notes and recipes, as a sidebar from the left (the shelf in the strip; ⌘Y opens past notes,
// ⇧⌘Y recipes). Tabs stop at nine, so this is where everything else lives: every note, newest
// first, grouped by day, with a filter that has focus as it opens. ↑↓ or ⌃N ⌃P move, ↩ opens,
// esc closes. ⌘K opens the same Library search. Recipes are the other side (ui/Recipes.tsx).

import { useEffect, useRef } from 'react'
import { useGpuixRequired, useWindowSize, type KeyEvent, type PublicInstance } from '@gpuix/react'
import { motion } from '../components/spring'
import { Button, Icon, Segmented, SidePanel, useM } from '../components'
import { enter, offset, useReducedMotion } from '../components/motion'
import { primary } from '../core/platform'
import type { Profile } from '../core/profiles'
import type { Recipe } from '../core/recipes'
import { RecipesView } from './Recipes'
import type { Thread } from '../core/threads'
import { SearchResults, useSearchResultsState } from './SearchResults'

/** Both sides share it, so switching between them doesn't resize the panel under the slide. */
const WIDTH = 480

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
  onDelete,
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
  /** Moves a note to the trash (core/trash.ts). */
  onDelete: (id: string) => void
}) {
  const inputRef = useRef<PublicInstance>(null)
  const recipesRef = useRef<PublicInstance>(null)
  const search = useSearchResultsState()
  const renderer = useGpuixRequired()
  const m = useM()
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => { const field = view === 'recipes' ? recipesRef.current : inputRef.current; if (field) renderer.focusElement?.(field.id) }, 16)
    return () => clearTimeout(timer)
  }, [open, view, renderer])

  const onKeyDown = (e: KeyEvent) => {
    if (primary(e.modifiers) && e.key === 'k') {
      e.preventDefault()
      if (view === 'history') onClose()
      else onView('history')
    } else if (e.key === 'escape' || (primary(e.modifiers) && e.key === 'y' && !e.modifiers?.shift)) {
      e.preventDefault()
      onClose()
    } else if (primary(e.modifiers) && e.key === 'y' && e.modifiers?.shift) {
      e.preventDefault()
      onView(view === 'recipes' ? 'history' : 'recipes')
    }
  }

  // Switching sides slides the new one in from its side of the switch (Past notes left, Recipes
  // right). Not as the panel opens: the panel's own entrance is enough.
  const reduced = useReducedMotion()
  const window = useWindowSize()
  const seen = useRef({ open, view })
  const switched = open && seen.current.open && seen.current.view !== view
  seen.current = { open, view }
  const slideFrom = switched && !reduced ? (view === 'recipes' ? offset.dialog : -offset.dialog) : undefined

  return (
    <SidePanel open={open} onClose={onClose} side="left" width={Math.min(WIDTH, window.width - 60)} initialFocus={view === 'recipes' ? recipesRef : inputRef} testId="history">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingLeft: 14, paddingRight: 14, paddingTop: 14, flexShrink: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}><text style={{ fontSize: 14, lineHeight: 20, fontWeight: 600, color: m.text, flexGrow: 1 }}>Library</text><Button onPress={onClose} title="Close Library"><Icon name="x" size={13} /></Button></div>
        <Segmented<'history' | 'recipes'> pill testId="history-view" value={view} onChange={onView} width="fill" options={[{ value: 'history', label: 'Past notes' }, { value: 'recipes', label: 'Recipes' }]} />
      </div>
      <motion.div
        key={view}
        initial={slideFrom === undefined ? false : { opacity: 0, left: slideFrom }}
        animate={{ opacity: 1, left: 0 }}
        transition={enter('fast')}
        style={{ position: 'relative', display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, paddingTop: view === 'recipes' ? 12 : 0 }}
      >
      {view === 'recipes' ? (
        <RecipesView recipes={recipes} folder={folder} onUse={onUseRecipe} onChanged={onRecipesChanged} inputRef={recipesRef} onKeyDown={onKeyDown} />
      ) : (
      <SearchResults threads={threads} profiles={profiles} activeId={activeId} openIds={openIds} inputRef={inputRef} onPick={onPick} onDelete={onDelete} onClose={onClose} onKeyDown={onKeyDown} controls={search} />
      )}
      </motion.div>
    </SidePanel>
  )
}
