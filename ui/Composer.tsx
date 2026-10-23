// The end of the note, where new writing goes: a plain textarea, the last paragraph of the document.
// Enter = newline, Ctrl+Enter = send. "!" runs a shell command, "@" tags files and skills.

import { useEffect, useRef, useState, type RefObject } from 'react'
import { DismissableLayer, type KeyEvent, type PublicInstance } from '@gpuix/react'
import { FloatingLayer } from '@gpuix/react/floating'
import type { Profile } from '../core/profiles'
import { suggest, tagText, type Suggestion } from '../core/tags'
import type { Tag } from '../core/threads'
import { Icon, Meta, useM } from './kit'
import { motion as m_ } from '@gpuix/react'
import { concentric, font, motion, radiusBase, type } from './theme'

/** The "@query" being typed at the end of the draft, if any. */
function activeQuery(text: string): string | undefined {
  const match = /(?:^|\s)@([^\s@]*)$/.exec(text)
  return match ? match[1] : undefined
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
            <Icon name={s.type === 'skill' ? 'sparkle' : s.type === 'folder' ? 'folder' : 'file'} size={13} />
            <text style={{ flexGrow: 1, minWidth: 0, fontSize: 12.5, lineHeight: 16, color: m.text, fontFamily: s.type === 'skill' ? font.sans : font.mono, whiteSpace: 'nowrap', textOverflow: 'ellipsis-start' }}>
              {s.type === 'skill' ? s.value : s.label}
            </text>
            {s.hint ? <Meta>{s.hint}</Meta> : null}
          </div>
        ))}
        <div style={{ display: 'flex', flexDirection: 'row', gap: 10, paddingLeft: 8, paddingTop: 4, paddingBottom: 2 }}>
          <Meta>⌃N ⌃P to move</Meta>
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
  composerRef: RefObject<PublicInstance | null>
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
    suggest(query, workspace, profile).then((found) => {
      if (id !== request.current) return
      setItems(found)
      setActive(0)
    })
  }, [query, workspace, profile])

  const pick = (s: Suggestion) => {
    const tag: Tag = { type: s.type, value: s.value }
    const next = value.replace(/@([^\s@]*)$/, tagText(tag) + ' ')
    onChange(next, [...tags.filter((t) => !(t.type === tag.type && t.value === tag.value)), tag])
    setItems([])
  }

  const onKeyDown = (e: KeyEvent) => {
    const mods = e.modifiers
    if (open) {
      if (e.key === 'tab' || (mods?.ctrl && e.key === 'enter')) {
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
    if (e.key === 'enter' && mods?.ctrl) {
      e.preventDefault()
      onSend()
    }
  }

  const shell = value.startsWith('!')
  const folder = workspace ? workspace.split('/').filter(Boolean).pop() : undefined
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
        onSubmit={open ? () => pick(items[active]!) : undefined}
        onKeyDown={onKeyDown}
        onFocus={onFocusChange ? () => onFocusChange(true) : undefined}
        onBlur={onFocusChange ? () => onFocusChange(false) : undefined}
      />
      {shell ? <Meta>{`Ctrl+Enter runs this in ${folder ?? 'the folder'}`}</Meta> : null}
    </div>
  )
}
