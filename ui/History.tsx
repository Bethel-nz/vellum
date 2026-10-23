// Past notes, as a sidebar from the left (⌘Y, or the clock in the strip). Tabs stop at nine, so
// this is where everything else lives: every note, newest first, grouped by day, with a filter
// that has focus as it opens. ↑↓ or ⌃N ⌃P move, ↩ opens, esc closes. ⌘K stays the quick jump.

import { useMemo, useRef, useState } from 'react'
import type { KeyEvent, PublicInstance } from '@gpuix/react'
import { Button, Scroll, SidePanel } from '../components'
import { keys, primary } from '../core/platform'
import type { Profile } from '../core/profiles'
import type { Thread } from '../core/threads'
import { ago, Row } from './dialogs'
import { Dot, Icon, Kbd, Meta, useM } from './kit'
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
}: {
  open: boolean
  onClose: () => void
  threads: Thread[]
  profiles: Profile[]
  activeId?: string
  openIds: string[]
  onPick: (id: string) => void
}) {
  const m = useM()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<PublicInstance>(null)
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = threads
      .filter((t) => !q || t.title.toLowerCase().includes(q) || t.workspace.toLowerCase().includes(q))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    const out: [string, Thread[]][] = []
    for (const t of list) {
      const g = dayGroup(t.updatedAt)
      if (out.at(-1)?.[0] === g) out.at(-1)![1].push(t)
      else out.push([g, [t]])
    }
    return out
  }, [threads, query])
  const flat = groups.flatMap(([, ts]) => ts)
  const pick = (t?: Thread) => t && onPick(t.id)

  const onKeyDown = (e: KeyEvent) => {
    const step = (d: number) => {
      e.preventDefault()
      setActive((a) => (flat.length ? (a + d + flat.length) % flat.length : 0))
    }
    if (e.key === 'escape' || (primary(e.modifiers) && e.key === 'y')) {
      e.preventDefault()
      onClose()
    } else if ((e.modifiers?.ctrl && e.key === 'n') || e.key === 'down') step(1)
    else if ((e.modifiers?.ctrl && e.key === 'p') || e.key === 'up') step(-1)
  }

  return (
    <SidePanel open={open} onClose={onClose} side="left" width={340} initialFocus={inputRef} testId="history">
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, height: 46, paddingLeft: 16, paddingRight: 12, borderBottomWidth: 1, borderColor: m.border, flexShrink: 0 }}>
        <Icon name="search" size={14} />
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
        <Kbd>⌘Y</Kbd>
        <Button onPress={onClose} testId="history-close" title="Close (esc)" style={{ width: 24, paddingLeft: 0, paddingRight: 0 }}>
          <Icon name="x" size={13} />
        </Button>
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
      </div>
    </SidePanel>
  )
}
