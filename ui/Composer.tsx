// The end of the note, where new writing goes: a plain textarea, the last paragraph of the document.
// Enter = newline, ⌘↵ = send. "!" runs a shell command, "@" tags skills, folders and
// files, "#" tags files only (type ":42" after one to point at a line).
//
// Under it, the meta row: the permission mode (⇧⇥ cycles Ask, Edits, Plan, Auto; click for all of
// them) and Think (off, on, max). While Claude waits on an ask and the draft is empty, ↵ ⌘↵ esc
// answer the approval card instead of editing.

import { useEffect, useRef, useState, type RefObject } from 'react'
import { DismissableLayer, type KeyEvent, type PublicInstance } from '@gpuix/react'
import { FloatingLayer } from '@gpuix/react/floating'
import { cycleModes, modeLabel, modes, type PermissionMode, type Think } from '../core/asks'
import { keys, primary } from '../core/platform'
import type { Profile } from '../core/profiles'
import { Menu } from '../components'
import { suggest, tagsIn, tagText, type Suggestion } from '../core/tags'
import { TokenRow, type TokenContext } from './Tokens'
import type { Tag } from '../core/threads'
import { FileIcon, Icon, Meta, Quiet, useM } from './kit'
import { motion as m_ } from '@gpuix/react'
import { concentric, font, motion, radiusBase, type } from './theme'

/** The "@query" or "#query" being typed at the end of the draft, trigger included. */
function activeQuery(text: string): string | undefined {
  const match = /(?:^|\s)([@#][^\s@#]*)$/.exec(text)
  // `#path:42` is finished: the line number is typed after the pick, not searched for.
  return match && !/^#.+:\d*$/.test(match[1]!) ? match[1] : undefined
}

function TagPopup({
  items,
  active,
  onPick,
  onHover,
}: {
  items: Suggestion[]
  active: number
  onPick: (s: Suggestion) => void
  onHover: (i: number) => void
}) {
  const m = useM()
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
        boxShadow: { offsetX: 0, offsetY: 8, blurRadius: 24, spreadRadius: 0, color: m.shadow },
      }}
    >
      <m_.div
        initial={{ opacity: 0, top: motion.popoverRise }}
        animate={{ opacity: 1, top: 0 }}
        transition={{ duration: motion.duration.sm, ease: motion.expoOut }}
        style={{ display: 'flex', flexDirection: 'column', position: 'relative' }}
      >
        {items.map((s, i) => (
          <div
            key={`${s.type}:${s.value}`}
            testId={`tag-${i}`}
            onClick={() => onPick(s)}
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
            {s.type === 'file' ? <FileIcon path={s.value} size={13} /> : <Icon name={s.type === 'skill' ? 'sparkle' : 'folder'} size={13} />}
            <text style={{ flexGrow: 1, minWidth: 0, fontSize: 12.5, lineHeight: 16, color: m.text, fontFamily: s.type === 'skill' ? font.sans : font.mono, whiteSpace: 'nowrap', textOverflow: 'ellipsis-start' }}>
              {s.type === 'skill' ? s.value : s.label}
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
  think,
  onThink,
  asking,
  onAskKey,
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
  /** Chips under the draft, with their hover slices. */
  tokenCtx?: TokenContext
  composerRef: RefObject<PublicInstance | null>
  mode: PermissionMode
  onMode: (mode: PermissionMode) => void
  think: Think
  onThink: (think: Think) => void
  /** Claude is waiting on an approval in this note. */
  asking?: boolean
  onAskKey?: (key: 'allow' | 'always' | 'deny') => void
}) {
  const m = useM()
  const [items, setItems] = useState<Suggestion[]>([])
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState<string | undefined>()
  const query = activeQuery(value)
  const open = query !== undefined && query !== dismissed && items.length > 0
  const request = useRef(0)

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

  const pick = (s: Suggestion) => {
    const tag = { type: s.type, value: s.value } as Tag
    const next = value.replace(/[@#]([^\s@#]*)$/, tagText(tag) + ' ')
    onChange(next, [...tags.filter((t) => !(t.type === tag.type && t.value === tag.value)), tag])
    setItems([])
  }

  const onKeyDown = (e: KeyEvent) => {
    const mods = e.modifiers
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
        pick(items[active]!)
        return
      }
      if (mods?.ctrl && (e.key === 'n' || e.key === 'p')) {
        e.preventDefault()
        setActive((a) => (a + (e.key === 'n' ? 1 : items.length - 1)) % items.length)
        return
      }
      if (e.key === 'escape') {
        e.preventDefault()
        setDismissed(query)
        return
      }
    }
    if (e.key === 'enter' && primary(mods)) {
      e.preventDefault()
      onSend()
    }
  }

  const shell = value.startsWith('!')
  const folder = workspace ? workspace.split(/[\\/]/).filter(Boolean).pop() : undefined
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, position: 'relative' }}>
      {open ? (
        <DismissableLayer onEscapeKeyDown={() => setDismissed(query)}>
          <TagPopup items={items} active={active} onPick={pick} onHover={setActive} />
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
        }}
        onChange={(e) => {
          const next = e.value ?? ''
          onChange(next, tags)
          if (dismissed !== undefined && activeQuery(next) !== dismissed) setDismissed(undefined)
        }}
        // Plain ↵ arrives here, not in onKeyDown: it picks a tag, or allows a waiting ask.
        onSubmit={open ? () => pick(items[active]!) : asking && onAskKey && !value.trim() ? () => onAskKey('allow') : undefined}
        onKeyDown={onKeyDown}
        onFocus={onFocusChange ? () => onFocusChange(true) : undefined}
        onBlur={onFocusChange ? () => onFocusChange(false) : undefined}
      />
      {shell ? <Meta>{keys(`⌘↵ runs this in ${folder ?? 'the folder'}`)}</Meta> : null}
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: -6 }}>
        {asking && !value.trim() ? (
          <div style={{ paddingLeft: 6 }}>
            <Meta color={m.blue}>Claude is waiting on you · ↵ allow · esc deny</Meta>
          </div>
        ) : null}
        <div style={{ flexGrow: 1 }} />
        <ModePill mode={mode} onMode={onMode} />
        <ThinkPill think={think} onThink={onThink} />
      </div>
      {tokenCtx && !shell ? <TokenRow tags={tagsIn(value, tags)} ctx={tokenCtx} testId="draft-chips" /> : null}
    </div>
  )
}

/** The permission mode as plain text with a menu; ⇧⇥ in the composer cycles the common four. */
function ModePill({ mode, onMode }: { mode: PermissionMode; onMode: (mode: PermissionMode) => void }) {
  const m = useM()
  const [open, setOpen] = useState(false)
  const risky = mode === 'bypassPermissions'
  return (
    <div style={{ position: 'relative' }}>
      <Quiet onPress={() => setOpen((v) => !v)} testId="mode-pill" title="Permission mode (⇧⇥)">
        <text style={{ fontSize: 12, lineHeight: 16, fontWeight: 500, color: risky ? m.warning : mode === 'plan' ? m.blue : m.textMuted }}>{modeLabel(mode)}</text>
        <Icon name="chevronDown" size={11} color={m.textFaint} />
      </Quiet>
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        side="top"
        align="end"
        width={300}
        testId="mode-menu"
        items={modes.map((x) => ({ label: x.label, hint: x.hint, checked: x.id === mode, destructive: x.id === 'bypassPermissions', testId: `mode-${x.id}`, onSelect: () => onMode(x.id) }))}
      />
    </div>
  )
}

const thinkNext: Record<Think, Think> = { off: 'on', on: 'max', max: 'off' }

/** Think off, on or max: faint when off, ∴ at max. A click steps through them. */
function ThinkPill({ think, onThink }: { think: Think; onThink: (think: Think) => void }) {
  const m = useM()
  const title = think === 'off' ? 'Thinking off' : think === 'max' ? 'Thinking at max effort' : 'Thinking on'
  return (
    <Quiet onPress={() => onThink(thinkNext[think])} testId="think-pill" title={`${title} · click to change`}>
      <text style={{ fontSize: 12, lineHeight: 16, fontWeight: 500, color: think === 'off' ? m.textFaint : m.textUi }}>{think === 'max' ? 'Think ∴' : 'Think'}</text>
    </Quiet>
  )
}
