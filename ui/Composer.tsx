// The end of the note, where new writing goes: a plain textarea, the last paragraph of the document.
// ⌘↵ sends, ↵ starts a new line. "!" runs a shell command, "@" tags skills, folders and
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
import { DismissableLayer, useGpuixRequired, useWindowSize, type KeyEvent, type PublicInstance } from '@gpuix/react'
import { FloatingLayer } from '@gpuix/react/floating'
import { cycleModes, modes as allModes, type PermissionMode } from '../core/asks'

const modeLabel = (mode: PermissionMode) => allModes.find((x) => x.id === mode)?.label ?? mode
import { keys, primary } from '../core/platform'
import type { Profile } from '../core/profiles'
import { recipeCall, type Recipe } from '../core/recipes'
import { relabel, suggest, tagsIn, tagText, type Suggestion } from '../core/tags'
import { TokenText, type TokenContext } from './Tokens'
import type { Tag } from '../core/threads'
import { FileIcon, Icon, Meta, Quiet, useM } from './kit'
import { PopoverBackdrop } from '../components/PopoverBackdrop'
import { motion as m_ } from '../components/spring'
import { concentric, elevation, font, radiusBase, type } from './theme'
import { enter, offset, useReducedMotion } from '../components/motion'
import { useAgent } from '../components/AgentContext'

/** The "@query" or "#query" being typed at the end of the draft, trigger included. */
/** The text a change put in at once (a paste, dictation), or '' when it only removed or typed one character. */
function insertedRun(before: string, after: string): string {
  if (after.length - before.length < 2) return ''
  let start = 0
  while (start < before.length && before[start] === after[start]) start++
  let end = 0
  while (end < before.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++
  return after.slice(start, after.length - end)
}

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
  onClose,
}: {
  items: PopupRow[]
  active: number
  onPick: (i: number) => void
  onHover: (i: number) => void
  onClose: () => void
}) {
  const m = useM()
  const reduced = useReducedMotion()
  return (
    <FloatingLayer
      side="top"
      align="start"
      sideOffset={8}
      style={{
        width: 360,
        padding: 5,
        backgroundColor: m.popup,
        borderRadius: concentric(radiusBase + 4, 0),
        borderWidth: 1,
        borderColor: m.border,
        boxShadow: elevation(m, 'popover'),
      }}
    >
      <PopoverBackdrop onClose={onClose} />
      <m_.div
        initial={reduced ? false : { opacity: 0, top: offset.menu }}
        animate={{ opacity: 1, top: 0 }}
        transition={enter('fast')}
        style={{ display: 'flex', flexDirection: 'column', position: 'relative', pointerEvents: 'none' }}
      >
        {items.map((s, i) => (
          <div
            key={s.key}
            testId={s.testId}
            onMouseDown={() => onPick(i)}
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
              pointerEvents: 'auto',
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

let leftAt = 0
/** True just after a press outside took focus from the composer, so that press (on the note's tail) doesn't hand it straight back. */
export const composerJustLeft = () => Date.now() - leftAt < 250

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
  modes,
  onMode,
  asking,
  onAskKey,
  images = [],
  onPaste,
  onRemoveImage,
  recipes = [],
  running,
  canSteer,
  queue = [],
  onSteerQueued,
  onForceQueued,
  onUnqueue,
  variant = 'note',
  sendRow = false,
}: {
  value: string
  tags: Tag[]
  onChange: (value: string, tags: Tag[]) => void
  /** ⌘↵; ⌥⌘↵ asks to steer, which the owner reads as a plain send when Claude isn't working. */
  onSend: (steer?: boolean) => void
  profile?: Profile
  workspace?: string
  placeholder: string
  /** The tab strip's auto mode tucks away while you write. */
  onFocusChange?: (focused: boolean) => void
  /** The draft's chips, while you're not writing in it. */
  tokenCtx?: TokenContext
  composerRef: RefObject<PublicInstance | null>
  mode?: PermissionMode
  /** The modes the note's agent has (core/agents.ts); ⇧⇥ cycles the ones among Ask, Edits, Plan and Auto. */
  modes?: { id: PermissionMode; label: string; hint: string }[]
  onMode?: (mode: PermissionMode) => void
  /** Claude is waiting on an approval in this note. */
  asking?: boolean
  onAskKey?: (key: 'allow' | 'always' | 'deny') => void
  /** Images pasted into this draft, as files. */
  images?: string[]
  /**
   * ⌘V, so the owner can check the clipboard for an image. With text on the clipboard the text
   * field pastes it itself and the key never arrives: then this gets the text that went in at
   * once (`inserted`), for the owner to compare with the clipboard.
   */
  onPaste?: (inserted?: string) => void
  onRemoveImage?: (index: number) => void
  /** Recipes for `$`: yours and the note's project's. */
  recipes?: Recipe[]
  /** Claude is working in this note: ⌘↵ queues what you write for after the turn. */
  running?: boolean
  /** …and ⌥⌘↵ (Steer) can put it into the turn instead; without this, Steer stops the turn and sends it now. */
  canSteer?: boolean
  /** Messages queued while Claude works, oldest first. */
  queue?: QueuedMessage[]
  onSteerQueued?: (index: number) => void
  /** Stop the running turn and send this queued message right away, ahead of the rest. */
  onForceQueued?: (index: number) => void
  onUnqueue?: (index: number) => void
  /** New note shares tagging, with Enter to open the draft and a larger writing surface. */
  variant?: 'note' | 'new-note'
  /** Page composer: the key hint and a send button under the draft. */
  sendRow?: boolean
}) {
  const m = useM()
  const agent = useAgent()
  const renderer = useGpuixRequired()
  const window = useWindowSize()
  const newNote = variant === 'new-note'
  const minRows = newNote ? window.height < 680 ? 2 : 4 : 1
  // Only the new-note sheet autofocuses, and an autofocused textarea never reports focus.
  const [focused, setFocused] = useState(newNote)
  // focusElement doesn't report onFocus, so this says so itself.
  const focusInput = () => {
    setFocused(true)
    if (composerRef.current) renderer.focusElement?.(composerRef.current.id)
  }
  const leave = () => {
    setFocused(false)
    const id = composerRef.current?.id
    if (id == null || renderer.getFocusedElementId?.() !== id) return
    leftAt = Date.now()
    renderer.blur?.()
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
    ? recipeItems.map((r, i) => ({ key: `recipe:${r.file}`, testId: `recipe-pick-${i}`, icon: <Icon name="library" size={14} />, text: `$${r.name}`, mono: true, hint: r.description ?? (r.scope === 'project' ? 'this project' : undefined) }))
    : items.map((s, i) => ({ key: `${s.type}:${s.value}`, testId: `tag-${i}`, icon: s.type === 'file' ? <FileIcon path={s.value} size={14} /> : s.type === 'skill' ? <Icon name="zap" size={14} color={m.accent} /> : <Icon name="folder" size={14} />, text: s.type === 'skill' ? s.value : s.label, mono: s.type !== 'skill', hint: s.hint }))

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
    if (onMode && mode && modes && e.key === 'tab' && mods?.shift && !mods.ctrl && !open) {
      e.preventDefault()
      const cycle = cycleModes.filter((id) => modes.some((x) => x.id === id))
      const i = cycle.indexOf(mode)
      if (cycle.length) onMode(cycle[(i + 1) % cycle.length]!)
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
      if (e.key === 'down' || e.key === 'up') {
        e.preventDefault()
        setActive((a) => (a + (e.key === 'down' ? 1 : count - 1)) % count)
        return
      }
      if ((e.key === 'tab' && !mods?.ctrl) || (primary(mods) && e.key === 'enter')) {
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
      onSend(Boolean(mods?.alt))
    }
  }

  const shell = !newNote && value.startsWith('!')
  const chips = !focused && !shell && tokenCtx && tagsIn(value, tags).length > 0
  const called = value.startsWith('$') ? recipeCall(value, recipes) : undefined
  const folder = workspace ? workspace.split(/[\\/]/).filter(Boolean).pop() : undefined
  return (
    // A press outside blurs the field, unless that press already focused something else.
    <div onMouseDownOutside={leave} style={{ display: 'flex', flexDirection: 'column', gap: 6, position: 'relative', ...(newNote ? { minHeight: minRows * 33 } : {}) }}>
      {open ? (
        <DismissableLayer onEscapeKeyDown={() => setDismissed(recipesOpen ? value : query)}>
          <TagPopup items={rows} active={active} onPick={(i) => (recipesOpen ? pickRecipe(recipeItems[i]!) : pick(items[i]!))} onHover={setActive} onClose={() => setDismissed(recipesOpen ? value : query)} />
        </DismissableLayer>
      ) : null}
      {queue.length ? <Queued queue={queue} canSteer={canSteer} tokenCtx={tokenCtx} onSteer={onSteerQueued} onForce={onForceQueued} onRemove={onUnqueue} /> : null}
      <textarea
        ref={composerRef}
        testId={newNote ? 'new-note-writing' : 'composer'}
        aria-label={newNote ? 'New note draft' : undefined}
        value={value}
        placeholder={placeholder}
        minRows={minRows}
        maxRows={newNote ? window.height < 680 ? 3 : 6 : 10000}
        autoFocus={newNote}
        theme={{ caret: m.appearance === 'dark' ? m.text : m.accent, textFaint: m.textFaint }}
        style={{
          width: '100%',
          minWidth: 0,
          ...(shell ? { fontFamily: font.mono, fontSize: 13, lineHeight: 21 } : { fontFamily: font.sans, ...type.user, fontWeight: 500 }),
          ...(newNote ? { fontSize: 22, lineHeight: 33, fontWeight: 400 } : {}),
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
          const inserted = insertedRun(value, next)
          onChange(next, tags)
          if (inserted) onPaste?.(inserted)
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
      {sendRow && !running && !asking && !open ? <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Meta color={m.textMuted}>{keys('⌘↵ send · @ skills & files')}</Meta>
        <div style={{ flexGrow: 1 }} />
        <Quiet testId="send-message" title="Send message (⌘↵)" onPress={() => onSend()}>
          <Icon name="send" size={14} color={m.textMuted} />
        </Quiet>
      </div> : null}
      {shell ? <Meta>{keys(`⌘↵ runs this in ${folder ?? 'the folder'}`)}</Meta> : null}
      {called && !open ? <Meta>{keys(`⌘↵ sends the $${called.recipe.name} recipe${called.recipe.mode ? ` in ${modeLabel(called.recipe.mode)}` : ''}${called.input.trim() ? ', with what follows as its input' : ''}`)}</Meta> : null}
      {running && value.trim() && !shell && !called && !open ? (
        // Under what you're writing while Claude works: after this turn, or into it now.
        <div testId="draft-actions" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: -8 }}>
          <Quiet testId="draft-queue" title={`${agent.title} picks it up next turn`} onPress={() => onSend(false)}>
            <Meta color={m.textMuted}>{keys('Queue ⌘↵')}</Meta>
          </Quiet>
          <Quiet testId="draft-steer" title={canSteer ? `Tell ${agent.title} now, in this turn` : 'Stop this turn and send it now'} onPress={() => onSend(true)}>
            <Meta color={m.textMuted}>{keys('Steer ⌥⌘↵')}</Meta>
          </Quiet>
        </div>
      ) : null}
      {asking && !value.trim() ? <Meta color={m.textMuted}>{keys('↵ allow · ⌘↵ always · esc deny')}</Meta> : null}
      {images.length ? <ImageRow images={images} onRemove={onRemoveImage} /> : null}
    </div>
  )
}

/** A message written while Claude was working, waiting for its turn to end. */
export type QueuedMessage = { id?: string; text: string; tags?: Tag[]; images?: string[]; captureId?: string }

/**
 * What you queued, above the paragraph you're writing: your paragraphs as they'll be sent,
 * faded until Claude picks them up next turn. Each can still go now — into this turn
 * (Steer now) or as its own turn right away (Send now) — or be taken out.
 */
function Queued({ queue, canSteer, tokenCtx, onSteer, onForce, onRemove }: { queue: QueuedMessage[]; canSteer?: boolean; tokenCtx?: TokenContext; onSteer?: (index: number) => void; onForce?: (index: number) => void; onRemove?: (index: number) => void }) {
  const m = useM()
  const agent = useAgent()
  return (
    <div testId="queue" style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 12 }}>
      {queue.map((item, i) => (
        <div key={i} testId={`queued-${i}`} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {item.text && tokenCtx && item.tags?.length ? (
            <TokenText text={item.text} tags={item.tags} ctx={tokenCtx} color={m.textMuted} onPress={() => {}} chipPrefix={`queued-${i}-chip`} />
          ) : (
            <text style={{ fontFamily: font.sans, ...type.user, fontWeight: 500, color: m.textMuted }}>
              {item.text || `${item.images?.length ?? 0} ${item.images?.length === 1 ? 'image' : 'images'}`}
            </text>
          )}
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            <Meta>Picked up next turn</Meta>
            {canSteer && onSteer ? (
              <Quiet testId={`queued-steer-${i}`} title={`Tell ${agent.title} now, in this turn`} onPress={() => onSteer(i)}>
                <Meta color={m.textMuted}>Steer now</Meta>
              </Quiet>
            ) : null}
            {onForce ? (
              <Quiet testId={`queued-send-${i}`} title="Stop this turn and send it right away" onPress={() => onForce(i)}>
                <Meta color={m.textMuted}>Send now</Meta>
              </Quiet>
            ) : null}
            {onRemove ? (
              <Quiet testId={`queued-remove-${i}`} title="Take it out of the queue" onPress={() => onRemove(i)}>
                <Meta color={m.textMuted}>Remove</Meta>
              </Quiet>
            ) : null}
          </div>
        </div>
      ))}
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
        <div key={src} testId={`draft-image-${i}`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(-1)} style={{ position: 'relative', width: 96, height: 72, borderRadius: 10, borderWidth: 1, borderColor: m.border }}>
          <img src={src} objectFit="cover" style={{ width: 94, height: 70, borderRadius: 9 }} />
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
