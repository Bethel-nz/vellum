// The end of the note, where new writing goes: a plain textarea, the last paragraph of the document.
// Enter = newline, ⌘↵ = send. "!" runs a shell command, "@" tags skills, folders and
// files, "#" tags files only (type ":42" after one to point at a line), and "$" at the start
// picks a recipe (core/recipes.ts), whose prompt is sent in place of `$name …`.
//
// A picked file is written by its name alone (`#printed.ts`), or as much of its path as tells it
// from the draft's other files; the tag keeps the whole path. The textarea can't draw chips, so
// once you write elsewhere the draft reads as it will when sent, chips and all: a chip opens its
// file, anywhere else goes back to writing. Editing a tag's name turns it back into a `#` search.
//
// ⇧⇥ cycles the permission mode (Ask, Edits, Plan, Auto); the mode, thinking, model and context
// live in the status bar at the bottom left (ui/StatusBar.tsx). While Claude waits on an ask and
// the draft is empty, ↵ ⌘↵ esc answer the approval card instead of editing.

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { DismissableLayer, useGpuixRequired, type KeyEvent, type PublicInstance } from '@gpuix/react'
import { FloatingLayer } from '@gpuix/react/floating'
import { cycleModes, modes, type PermissionMode } from '../core/asks'

const modeLabel = (mode: PermissionMode) => modes.find((x) => x.id === mode)?.label ?? mode
import { keys, primary } from '../core/platform'
import type { Profile } from '../core/profiles'
import { recipeCall, type Recipe } from '../core/recipes'
import { relabel, suggest, tagsIn, tagText, type Suggestion } from '../core/tags'
import { TokenText, type TokenContext } from './Tokens'
import type { Tag } from '../core/threads'
import { FileIcon, Icon, Meta, Quiet, useM } from './kit'
import { motion as m_ } from '@gpuix/react'
import { concentric, elevation, font, radiusBase, type } from './theme'
import { enter, offset, useReducedMotion } from '../components/motion'

/** The "@query" or "#query" being typed at the end of the draft, trigger included. */
function activeQuery(text: string): string | undefined {
  const match = /(?:^|\s)([@#][^\s@#]*)$/.exec(text)
  // `#path:42` is finished: the line number is typed after the pick, not searched for.
  return match && !/^#.+:\d*$/.test(match[1]!) ? match[1] : undefined
}

/** One row of the popup: a tag to insert, or a recipe. */
type PopupRow = { key: string; testId: string; icon?: ReactNode; text: string; mono: boolean; hint?: string }

/** The "$name" being typed as the whole draft so far, without the "$"; else undefined. */
function recipeQuery(text: string): string | undefined {
  return /^\$([a-z0-9-]*)$/.exec(text)?.[1]
}

function TagPopup({
  items,
  active,
  onPick,
  onHover,
}: {
  items: PopupRow[]
  active: number
  onPick: (i: number) => void
  onHover: (i: number) => void
}) {
  const m = useM()
  const reduced = useReducedMotion()
  return (
    <FloatingLayer
      side="top"
      align="start"
      sideOffset={8}
      style={{
        width: 420,
        padding: 4,
        backgroundColor: m.popup,
        borderRadius: concentric(radiusBase + 4, 0),
        borderWidth: 1,
        borderColor: m.border,
        boxShadow: elevation(m, 'popover'),
      }}
    >
      <m_.div
        initial={reduced ? false : { opacity: 0, top: offset.menu }}
        animate={{ opacity: 1, top: 0 }}
        transition={enter('fast')}
        style={{ display: 'flex', flexDirection: 'column', position: 'relative' }}
      >
        {items.map((s, i) => (
          <div
            key={s.key}
            testId={s.testId}
            onClick={() => onPick(i)}
            onMouseEnter={() => onHover(i)}
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              height: 28,
              paddingLeft: 8,
              paddingRight: 8,
              borderRadius: concentric(radiusBase + 4, 4),
              backgroundColor: i === active ? m.popupHover : m.popup,
              cursor: 'pointer',
            }}
          >
            {s.icon}
            <text style={{ flexGrow: 1, minWidth: 0, fontSize: 12.5, lineHeight: 16, color: m.text, fontFamily: s.mono ? font.mono : font.sans, whiteSpace: 'nowrap', textOverflow: 'ellipsis-start' }}>
              {s.text}
            </text>
            {s.hint ? <Meta>{s.hint}</Meta> : null}
          </div>
        ))}
        <div style={{ display: 'flex', flexDirection: 'row', gap: 10, paddingLeft: 8, paddingTop: 4, paddingBottom: 2 }}>
          <Meta>{keys('⌃N ⌃P to move')}</Meta>
          <Meta>⇥ or ↩ to insert</Meta>
          <Meta>esc to close</Meta>
        </div>
      </m_.div>
    </FloatingLayer>
  )
}

export function Composer({
  value,
  tags,
  onChange,
  onSend,
  profile,
  workspace,
  placeholder,
  composerRef,
  onFocusChange,
  tokenCtx,
  mode,
  onMode,
  asking,
  onAskKey,
  images = [],
  onPaste,
  onRemoveImage,
  recipes = [],
}: {
  value: string
  tags: Tag[]
  onChange: (value: string, tags: Tag[]) => void
  onSend: () => void
  profile?: Profile
  workspace?: string
  placeholder: string
  /** The tab strip's auto mode tucks away while you write. */
  onFocusChange?: (focused: boolean) => void
  /** The draft's chips, while you're not writing in it. */
  tokenCtx?: TokenContext
  composerRef: RefObject<PublicInstance | null>
  mode: PermissionMode
  onMode: (mode: PermissionMode) => void
  /** Claude is waiting on an approval in this note. */
  asking?: boolean
  onAskKey?: (key: 'allow' | 'always' | 'deny') => void
  /** Images pasted into this draft, as files. */
  images?: string[]
  /** ⌘V: text pastes as usual; the owner checks the clipboard for an image too. */
  onPaste?: () => void
  onRemoveImage?: (index: number) => void
  /** Recipes for `$`: yours and the note's project's. */
  recipes?: Recipe[]
}) {
  const m = useM()
  const renderer = useGpuixRequired()
  // It autofocuses, and an autofocused textarea never reports focus, so it starts focused.
  const [focused, setFocused] = useState(true)
  // focusElement doesn't report onFocus, so this says so itself.
  const focusInput = () => {
    setFocused(true)
    if (composerRef.current) renderer.focusElement?.(composerRef.current.id)
  }
  const [items, setItems] = useState<Suggestion[]>([])
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState<string | undefined>()
  const query = activeQuery(value)
  const tagsOpen = query !== undefined && query !== dismissed && items.length > 0
  const rq = recipeQuery(value)
  const recipeItems = rq === undefined ? [] : recipes.filter((r) => r.name.includes(rq)).sort((a, b) => Number(!a.name.startsWith(rq)) - Number(!b.name.startsWith(rq))).slice(0, 8)
  const recipesOpen = recipeItems.length > 0 && dismissed !== value
  const open = tagsOpen || recipesOpen
  const count = recipesOpen ? recipeItems.length : items.length
  const request = useRef(0)
  useEffect(() => setActive(0), [rq])

  useEffect(() => {
    if (query === undefined || !workspace || !profile) {
      setItems([])
      return
    }
    const id = ++request.current
    suggest(query.slice(1), workspace, profile, 8, query[0] === '#').then((found) => {
      if (id !== request.current) return
      setItems(found)
      setActive(0)
    })
  }, [query, workspace, profile])

  const pickRecipe = (r: Recipe) => {
    onChange(`$${r.name} `, tags)
  }
  const pickActive = () => (recipesOpen ? pickRecipe(recipeItems[active]!) : pick(items[active]!))
  const rows: PopupRow[] = recipesOpen
    ? recipeItems.map((r, i) => ({ key: `recipe:${r.file}`, testId: `recipe-pick-${i}`, icon: <Icon name="library" size={13} />, text: `$${r.name}`, mono: true, hint: r.description ?? (r.scope === 'project' ? 'this project' : undefined) }))
    : items.map((s, i) => ({ key: `${s.type}:${s.value}`, testId: `tag-${i}`, icon: s.type === 'file' ? <FileIcon path={s.value} size={13} /> : s.type === 'skill' ? undefined : <Icon name="folder" size={13} />, text: s.type === 'skill' ? s.value : s.label, mono: s.type !== 'skill', hint: s.hint }))

  const pick = (s: Suggestion) => {
    const tag = { type: s.type, value: s.value } as Tag
    const all = [...tags.filter((t) => !(t.type === tag.type && t.value === tag.value)), tag]
    onChange(relabel(value.replace(/[@#]([^\s@#]*)$/, tagText(tag) + ' '), all), all)
    setItems([])
    // A click on the popup takes focus from the draft.
    focusInput()
  }

  const onKeyDown = (e: KeyEvent) => {
    const mods = e.modifiers
    if (primary(mods) && e.key === 'v') onPaste?.()
    if (e.key === 'tab' && mods?.shift && !open) {
      e.preventDefault()
      const i = cycleModes.indexOf(mode)
      onMode(cycleModes[(i + 1) % cycleModes.length]!)
      return
    }
    if (asking && onAskKey && !value.trim() && !open) {
      const k = e.key === 'enter' ? (primary(mods) ? 'always' : !mods?.shift && !mods?.ctrl && !mods?.alt && !mods?.cmd ? 'allow' : undefined) : e.key === 'escape' ? 'deny' : undefined
      if (k) {
        e.preventDefault()
        onAskKey(k)
        return
      }
    }
    if (open) {
      if (e.key === 'tab' || (primary(mods) && e.key === 'enter')) {
        e.preventDefault()
        pickActive()
        return
      }
      if (mods?.ctrl && (e.key === 'n' || e.key === 'p')) {
        e.preventDefault()
        setActive((a) => (a + (e.key === 'n' ? 1 : count - 1)) % count)
        return
      }
      if (e.key === 'escape') {
        e.preventDefault()
        setDismissed(recipesOpen ? value : query)
        return
      }
    }
    if (e.key === 'enter' && primary(mods)) {
      e.preventDefault()
      onSend()
    }
  }

  const shell = value.startsWith('!')
  const chips = !focused && !shell && tokenCtx && tagsIn(value, tags).length > 0
  const called = value.startsWith('$') ? recipeCall(value, recipes) : undefined
  const folder = workspace ? workspace.split(/[\\/]/).filter(Boolean).pop() : undefined
  return (
    // A click elsewhere doesn't take a GPUI field's focus, so it's what "writing elsewhere" means
    // here, as for a paragraph being edited (ui/blocks.tsx). Typing brings the textarea back.
    <div onMouseDownOutside={() => setFocused(false)} style={{ display: 'flex', flexDirection: 'column', gap: 6, position: 'relative' }}>
      {open ? (
        <DismissableLayer onEscapeKeyDown={() => setDismissed(recipesOpen ? value : query)}>
          <TagPopup items={rows} active={active} onPick={(i) => (recipesOpen ? pickRecipe(recipeItems[i]!) : pick(items[i]!))} onHover={setActive} />
        </DismissableLayer>
      ) : null}
      <textarea
        ref={composerRef}
        testId="composer"
        value={value}
        placeholder={placeholder}
        minRows={1}
        maxRows={10000}
        autoFocus
        theme={{ caret: m.appearance === 'dark' ? m.text : m.accent, textFaint: m.textFaint }}
        style={{
          width: '100%',
          minWidth: 0,
          ...(shell ? { fontFamily: font.mono, fontSize: 13, lineHeight: 21 } : { fontFamily: font.sans, ...type.user, fontWeight: 500 }),
          color: m.text,
          backgroundColor: '#00000000',
          borderWidth: 0,
          padding: 0,
          // Out of the way while the draft reads as chips; still there to take focus back.
          ...(chips ? { position: 'absolute', top: 0, left: 0, right: 0, opacity: 0, pointerEvents: 'none' } : {}),
        }}
        onChange={(e) => {
          const next = e.value ?? ''
          setFocused(true)
          onChange(next, tags)
          if (dismissed !== undefined && activeQuery(next) !== dismissed && next !== dismissed) setDismissed(undefined)
        }}
        // Plain ↵ arrives here, not in onKeyDown: it picks a tag, or allows a waiting ask.
        onSubmit={open ? pickActive : asking && onAskKey && !value.trim() ? () => onAskKey('allow') : undefined}
        onKeyDown={onKeyDown}
        onFocus={() => {
          setFocused(true)
          onFocusChange?.(true)
        }}
        onBlur={() => {
          setFocused(false)
          onFocusChange?.(false)
        }}
      />
      {chips ? <TokenText testId="draft-read" chipPrefix="draft-chip" text={value} tags={tags} ctx={tokenCtx} color={m.text} onPress={focusInput} /> : null}
      {shell ? <Meta>{keys(`⌘↵ runs this in ${folder ?? 'the folder'}`)}</Meta> : null}
      {called && !open ? <Meta>{keys(`⌘↵ sends the $${called.recipe.name} recipe${called.recipe.mode ? ` in ${modeLabel(called.recipe.mode)}` : ''}${called.input.trim() ? ', with what follows as its input' : ''}`)}</Meta> : null}
      {asking && !value.trim() ? <Meta color={m.blue}>{keys('Claude is waiting on you · ↵ allow · ⌘↵ always · esc deny')}</Meta> : null}
      {images.length ? <ImageRow images={images} onRemove={onRemoveImage} /> : null}
    </div>
  )
}

/** Pasted images waiting to go with the draft: small squares, × on hover to drop one. */
function ImageRow({ images, onRemove }: { images: string[]; onRemove?: (index: number) => void }) {
  const m = useM()
  const [hover, setHover] = useState(-1)
  return (
    <div testId="draft-images" style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 2 }}>
      {images.map((src, i) => (
        <div key={src} testId={`draft-image-${i}`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(-1)} style={{ position: 'relative', width: 64, height: 64, borderRadius: 10, borderWidth: 1, borderColor: m.border }}>
          <img src={src} objectFit="cover" style={{ width: 62, height: 62, borderRadius: 9 }} />
          {hover === i && onRemove ? (
            <Quiet onPress={() => onRemove(i)} testId={`remove-image-${i}`} title="Remove image" style={{ position: 'absolute', top: 3, right: 3, width: 20, height: 20, minHeight: 20, paddingLeft: 0, paddingRight: 0, borderRadius: 10, backgroundColor: m.popup }}>
              <Icon name="x" size={11} color={m.text} />
            </Quiet>
          ) : null}
        </div>
      ))}
    </div>
  )
}
