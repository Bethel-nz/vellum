// Arc's JSON tree, translated to native rows. Animated visuals never own clicks.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useGpuixRequired, type KeyEvent, type PublicInstance } from '@gpuix/react'
import { motion } from './spring'
import { Button as Base } from '@gpuix/react/button'
import { jsonBranch, jsonBranches, jsonCopy, jsonCount, jsonEntries, jsonRows, jsonText, jsonWithin, searchJson, type JsonKind, type JsonRow } from '../core/json'
import { copyText } from '../core/platform'
import { font, radiusBase, radiusXl } from '../ui/theme'
import type { IconName } from '../ui/icons'
import { Button } from './Button'
import { Icon } from './Icon'
import { enter, spring, tween, useReducedMotion } from './motion'
import { useM } from './theme'

export type JsonViewerProps = {
  data: unknown
  rootName?: string
  defaultExpandDepth?: number
  expanded?: string[]
  defaultExpanded?: string[]
  onExpandedChange?: (paths: string[]) => void
  searchable?: boolean
  query?: string
  defaultQuery?: string
  onQueryChange?: (query: string) => void
  pageSize?: number
  copyable?: boolean
  onCopy?: (detail: { kind: 'value' | 'path'; path: string; text: string }) => void
  onSelect?: (detail: { path: string; value: unknown; type: JsonKind }) => void
  showPath?: boolean
  maxHeight?: number
  label?: string
  framed?: boolean
  testId?: string
}

const ROW = 30

export function JsonViewer({ data, rootName = 'root', defaultExpandDepth = 1, expanded, defaultExpanded, onExpandedChange, searchable = true, query: queryProp, defaultQuery = '', onQueryChange, pageSize = 50, copyable = true, onCopy, onSelect, showPath = true, maxHeight = 420, label = 'JSON', framed = true, testId = 'json-viewer' }: JsonViewerProps) {
  const m = useM()
  const reduced = useReducedMotion()
  const renderer = useGpuixRequired()
  const tree = useRef<PublicInstance>(null)
  const input = useRef<PublicInstance>(null)
  const targets = useRef(new Map<string, PublicInstance>())
  const [internalExpanded, setInternalExpanded] = useState(() => defaultExpanded ?? jsonBranches(data, rootName, defaultExpandDepth))
  const base = useMemo(() => new Set(expanded ?? internalExpanded), [expanded, internalExpanded])
  const setExpanded = (next: Set<string>) => { if (expanded === undefined) setInternalExpanded([...next]); onExpandedChange?.([...next]) }
  const [internalQuery, setInternalQuery] = useState(defaultQuery)
  const query = queryProp ?? internalQuery
  const needle = query.trim().toLowerCase()
  const search = useMemo(() => needle ? searchJson(data, rootName, needle) : undefined, [data, rootName, needle])
  const [closed, setClosed] = useState<{ needle: string; paths: Set<string> }>({ needle: '', paths: new Set() })
  const [pages, setPages] = useState<Record<string, number>>({})
  const size = Math.max(1, Math.floor(pageSize) || 50)
  const isOpen = (path: string) => search?.ancestors.has(path) ? !(closed.needle === needle && closed.paths.has(path)) : base.has(path)
  const limitOf = (path: string) => Math.max((pages[path] ?? 1) * size, search?.needed.get(path) ?? 0)
  const rows = jsonRows(data, rootName, isOpen, limitOf)
  const [activeRaw, setActiveRaw] = useState(rootName)
  const active = rows.some((row) => row.path === activeRaw) ? activeRaw : rows.reduce((best, row) => row.hidden === undefined && jsonWithin(row.path, activeRaw) && row.path.length > best.length ? row.path : best, rootName)
  const activeIndex = Math.max(0, rows.findIndex((row) => row.path === active))
  const activeRow = rows[activeIndex]
  const [hovered, setHovered] = useState<string>()
  const [matchIndex, setMatchIndex] = useState(0)
  const matches = search?.matches ?? []
  const matchSet = new Set(matches)
  const matchAt = Math.min(matchIndex, Math.max(0, matches.length - 1))
  const [notice, setNotice] = useState('')
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 1500)
    return () => clearTimeout(timer)
  }, [notice])
  const selected = useRef(onSelect)
  selected.current = onSelect
  const reported = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!activeRow || activeRow.hidden !== undefined || reported.current === activeRow.path) return
    reported.current = activeRow.path
    selected.current?.({ path: activeRow.path, value: activeRow.value, type: activeRow.type })
  }, [activeRow])

  const [navigation, setNavigation] = useState(0)
  const pending = useRef<{ focus: boolean; center: boolean } | null>(null)
  const move = (path: string, focus = true, center = false) => { pending.current = { focus, center }; setActiveRaw(path); setNavigation((value) => value + 1) }
  // biome-ignore lint/correctness/useExhaustiveDependencies: Repeated navigation to the same row must still focus and reveal it.
  useEffect(() => {
    const request = pending.current
    if (!request) return
    pending.current = null
    if (request.focus) {
      const target = targets.current.get(active)
      if (target) renderer.focusElement?.(target.id)
    }
    // GPUIX scroll offsets are negative. Scroll directly once the row heights have settled;
    // scroll position is not one of the renderer's tweenable style properties.
    const timer = setTimeout(() => {
      const node = tree.current
      const bounds = node && renderer.getElementBounds?.(node.id)
      if (!node || !bounds) return
      const now = -(renderer.getScrollOffset?.(node.id)?.[1] ?? 0)
      const top = activeIndex * ROW + 6
      let next = now
      if (request.center) next = top - bounds.height / 2 + ROW / 2
      else if (top < now + 4) next = top - 4
      else if (top + ROW > now + bounds.height - 4) next = top + ROW - bounds.height + 4
      renderer.scrollTo?.(node.id, 0, -Math.max(0, Math.min(next, rows.length * ROW + 12 - bounds.height)))
    }, reduced ? 0 : spring.smooth.duration * 1000)
    return () => clearTimeout(timer)
  }, [active, activeIndex, navigation, reduced, renderer, rows.length])

  const toggle = (path: string, want = !isOpen(path)) => {
    const next = new Set(base)
    if (want) next.add(path); else next.delete(path)
    setExpanded(next)
    if (search?.ancestors.has(path)) {
      const paths = new Set(closed.needle === needle ? closed.paths : [])
      if (want) paths.delete(path); else paths.add(path)
      setClosed({ needle, paths })
    }
  }
  const showMore = (row: JsonRow) => {
    if (!row.parent) return
    const parent = row.parent
    setPages((before) => ({ ...before, [parent]: Math.ceil(limitOf(parent) / size) + 1 }))
  }
  const copy = (row: JsonRow, kind: 'value' | 'path') => {
    try {
      const text = kind === 'path' ? row.path : jsonCopy(row.value)
      if (!copyText(text)) throw new Error('Clipboard unavailable')
      setNotice(kind === 'path' ? 'Path copied' : 'Value copied')
      onCopy?.({ kind, path: row.path, text })
      return true
    } catch { setNotice('Couldn’t copy. Try again.'); return false }
  }
  const setQuery = (next: string) => {
    if (queryProp === undefined) setInternalQuery(next)
    onQueryChange?.(next)
    setClosed({ needle: next.trim().toLowerCase(), paths: new Set() })
    setMatchIndex(0)
    const first = next.trim() ? searchJson(data, rootName, next.trim().toLowerCase()).matches[0] : undefined
    move(first ?? activeRaw, false, Boolean(first))
  }
  const stepMatch = (step: number) => {
    if (!matches.length) return
    const next = (matchAt + step + matches.length) % matches.length
    setMatchIndex(next)
    const path = matches[next]
    if (path) move(path, false, true)
  }
  const key = (event: KeyEvent, index = activeIndex) => {
    const row = rows[index]
    if (event.defaultPrevented || event.modifiers?.alt || !row) return
    const mod = event.modifiers?.cmd || event.modifiers?.ctrl
    if (mod && event.key === 'c') { if (row.hidden === undefined && !renderer.getSelectedText?.()) { event.preventDefault(); event.stopPropagation(); copy(row, event.modifiers?.shift ? 'path' : 'value') }; return }
    if (mod) return
    const go = (index: number) => { event.preventDefault(); const row = rows[Math.max(0, Math.min(rows.length - 1, index))]; if (row) move(row.path) }
    if (['down', 'up', 'home', 'end', 'right', 'left', 'enter', 'space', '/'].includes(event.key ?? '')) event.stopPropagation()
    if (event.key === 'down') go(index + 1)
    else if (event.key === 'up') go(index - 1)
    else if (event.key === 'home') go(0)
    else if (event.key === 'end') go(rows.length - 1)
    else if (event.key === 'right') {
      event.preventDefault()
      if (jsonBranch(row.type)) { if (!row.open) toggle(row.path, true); else if (row.count) go(index + 1) }
    } else if (event.key === 'left') {
      event.preventDefault()
      if (row.open) toggle(row.path, false)
      else if (row.parent) move(row.parent)
    } else if (event.key === 'enter' || event.key === 'space') {
      event.preventDefault()
      if (row.hidden !== undefined) showMore(row)
      else if (jsonBranch(row.type)) toggle(row.path)
      move(row.path)
    } else if (event.key === '/' && searchable) { event.preventDefault(); if (input.current) renderer.focusElement?.(input.current.id) }
  }
  const path = activeRow?.hidden !== undefined ? activeRow.parent : activeRow?.path
  const bulk = rows.length > 400
  return <div testId={testId} style={{ display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden', borderWidth: framed ? 1 : 0, borderColor: m.border, borderRadius: radiusXl, backgroundColor: m.codeBg }}>
    {searchable || rows.length > 1 ? <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 2, padding: 6, borderBottomWidth: 1, borderColor: m.border }}>
      {searchable ? <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 4, flexGrow: 1, minWidth: 0, height: 34, paddingLeft: 10, paddingRight: 4, borderRadius: radiusXl, backgroundColor: m.chipBg }}>
        <Icon name="search" size={15} color={m.textMuted} />
        <input ref={input} testId={`${testId}-search`} aria-label="Search JSON" value={query} placeholder="Search keys and values" onChange={(event) => setQuery(event.value ?? '')} onKeyDown={(event) => {
          if (event.key === 'enter') { event.preventDefault(); stepMatch(event.modifiers?.shift ? -1 : 1) }
          else if (event.key === 'escape' && query) { event.preventDefault(); event.stopPropagation(); setQuery('') }
          else if (event.key === 'down') { event.preventDefault(); move(active) }
        }} style={{ flexGrow: 1, minWidth: 0, height: 34, fontSize: 12, color: m.textUi }} />
        {needle ? <><text testId={`${testId}-matches`} style={{ fontSize: 10.5, lineHeight: 16, color: m.textMuted }}>{matches.length ? `${matchAt + 1}/${matches.length}` : '0/0'}</text><ToolButton name="chevronUp" title="Previous match" disabled={!matches.length} onPress={() => stepMatch(-1)} testId={`${testId}-previous`} small /><ToolButton name="chevronDown" title="Next match" disabled={!matches.length} onPress={() => stepMatch(1)} testId={`${testId}-next`} small /></> : null}
      </div> : <div style={{ flexGrow: 1 }} />}
      <ToolButton name="expandAll" title="Expand all" testId={`${testId}-expand`} onPress={() => { setExpanded(new Set(jsonBranches(data, rootName))); setClosed({ needle, paths: new Set() }); move(active, false) }} />
      <ToolButton name="collapseAll" title="Collapse all" testId={`${testId}-collapse`} onPress={() => { setExpanded(new Set(jsonBranches(data, rootName, 1))); setClosed({ needle, paths: new Set([...(search?.ancestors ?? [])].filter((id) => id !== rootName)) }); setPages({}); move(rootName, false) }} />
    </div> : null}
    <div ref={tree} testId={`${testId}-tree`} role="tree" aria-label={label} onMouseLeave={() => setHovered(undefined)} style={{ minHeight: 0, maxHeight, overflowY: 'scroll', scrollbarColor: m.scrollbar, scrollbarWidth: 6 }}>
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', flexShrink: 0, margin: 6 }}>
        <motion.div initial={false} animate={{ top: activeIndex * ROW + 1 }} transition={tween(reduced || active !== activeRaw ? { duration: 0 } : spring.smooth)} style={{ position: 'absolute', left: 0, right: 0, height: ROW - 2, borderRadius: radiusBase, backgroundColor: m.chipBg, pointerEvents: 'none' }} />
        {rows.map((row, index) => {
          const selected = row.path === active
          const actions = copyable && row.hidden === undefined && (selected || hovered === row.path)
          const branch = jsonBranch(row.type)
          const mark = needle && matchSet.has(row.path) ? { query: needle, caseSensitive: false, color: `${m.warning.slice(0, 7)}${row.path === matches[matchAt] ? '7a' : '38'}` } : undefined
          const caption = row.name === null ? rootName : String(row.name)
          return <div key={row.path} role="presentation" style={{ position: 'relative', flexShrink: 0 }}>
            <motion.div initial={reduced || bulk ? false : { height: 0, opacity: 0 }} animate={{ height: ROW, opacity: 1 }} transition={tween(bulk ? { duration: 0 } : spring.smooth)} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0, paddingLeft: 4 + (row.level - 1) * 16, paddingRight: actions ? 58 : 6, overflow: 'hidden', pointerEvents: 'none' }}>
              {row.hidden !== undefined ? <><text style={{ paddingLeft: 20, fontSize: 12, lineHeight: 18, color: m.textUi }}>{`Show ${Math.min(size, row.hidden)} more`}</text><text style={{ fontSize: 10.5, lineHeight: 16, color: m.textMuted }}>{`${row.hidden} hidden`}</text></> : <>
                <div style={{ width: 14, height: 14, flexShrink: 0 }}>{branch ? <Icon name={row.open ? 'chevronDown' : 'chevronRight'} size={14} color={m.textMuted} /> : null}</div>
                <text highlight={mark} style={{ fontFamily: font.mono, fontSize: 12, lineHeight: 18, flexShrink: 1, maxWidth: '45%', color: typeof row.name === 'number' ? m.textMuted : m.textUi, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{caption}</text>
                {row.name !== null || !branch ? <text style={{ fontFamily: font.mono, fontSize: 12, color: m.textMuted, marginLeft: -5 }}>:</text> : null}
                {branch ? <>
                  {!row.open ? <text style={{ fontFamily: font.mono, fontSize: 12, lineHeight: 18, color: m.textMuted, flexShrink: 1, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{row.type === 'array' ? '[…]' : `{ ${jsonEntries(row.value).slice(0, 3).map(([key]) => key).join(', ')}${row.count > 3 ? ', …' : ''} }`}</text> : null}
                  <text style={{ fontSize: 10.5, lineHeight: 16, color: m.textMuted }}>{jsonCount(row)}</text>
                </> : <text highlight={mark} style={{ fontFamily: font.mono, fontSize: 12, lineHeight: 18, minWidth: 0, flexShrink: 1, whiteSpace: 'nowrap', textOverflow: 'ellipsis', color: row.type === 'string' ? m.success : row.type === 'number' ? m.syntax.number : row.type === 'boolean' ? m.warning : m.textMuted }}>{row.type === 'string' ? JSON.stringify(row.value) : jsonText(row.value)}</text>}
              </>}
            </motion.div>
            <div ref={(node) => { if (node) targets.current.set(row.path, node); else targets.current.delete(row.path) }} testId={`${testId}-row-${row.path}`} role="treeitem" aria-label={row.hidden !== undefined ? `Show ${Math.min(size, row.hidden)} more` : branch ? `${caption}, ${row.type}, ${jsonCount(row)}` : `${caption}: ${jsonText(row.value)}`} aria-description={`${row.position} of ${row.siblings}`} aria-level={row.level} aria-expanded={branch ? row.open : undefined} aria-selected={selected} tabIndex={selected ? 0 : -1} onKeyDown={(event) => key(event, index)} onFocus={() => setActiveRaw(row.path)} onMouseEnter={() => setHovered(row.path)} onClick={() => { if (row.hidden !== undefined) showMore(row); else if (branch) toggle(row.path); move(row.path) }} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: radiusBase, keyboardFocusDim: false, hover: selected ? undefined : { backgroundColor: m.hover }, focusVisible: { outlineWidth: 1, outlineColor: m.focusRing, outlineOffset: -1 } }} />
            {actions ? <div style={{ position: 'absolute', right: 0, top: 2, display: 'flex', flexDirection: 'row', borderRadius: radiusBase }}><CopyAction title="Copy value" name="copy" testId={`${testId}-copy-value-${row.path}`} onCopy={() => copy(row, 'value')} /><CopyAction title="Copy path" name="link" testId={`${testId}-copy-path-${row.path}`} onCopy={() => copy(row, 'path')} /></div> : null}
          </div>
        })}
      </div>
    </div>
    {showPath && activeRow ? <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 14, paddingRight: 6, minHeight: 42, borderTopWidth: 1, borderColor: m.border }}>
      <text testId={`${testId}-path`} style={{ fontFamily: font.mono, fontSize: 10.5, lineHeight: 16, color: m.textMuted, flexGrow: 1, minWidth: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{path}</text>
      <div role="status"><text testId={`${testId}-notice`} style={{ fontSize: 10.5, lineHeight: 16, color: m.textMuted }}>{notice || (activeRow.hidden !== undefined ? 'page' : activeRow.type)}</text></div>
      {copyable && activeRow.hidden === undefined ? <CopyAction key={activeRow.path} title="Copy path" name="copy" testId={`${testId}-copy-path`} onCopy={() => copy(activeRow, 'path')} focusable /> : null}
    </div> : null}
  </div>
}

function ToolButton({ name, title, testId, onPress, disabled, small }: { name: IconName; title: string; testId: string; onPress: () => void; disabled?: boolean; small?: boolean }) {
  return <Button title={title} testId={testId} onPress={onPress} disabled={disabled} style={{ width: small ? 26 : 34, height: small ? 26 : 34, paddingLeft: 0, paddingRight: 0, borderRadius: small ? 9 : radiusXl }}><Icon name={name} size={15} /></Button>
}

function CopyAction({ title, name, testId, onCopy, focusable = false }: { title: string; name: IconName; testId: string; onCopy: () => boolean; focusable?: boolean }) {
  const m = useM()
  const [state, setState] = useState<'idle' | 'done' | 'error'>('idle')
  useEffect(() => {
    if (state === 'idle') return
    const timer = setTimeout(() => setState('idle'), 1500)
    return () => clearTimeout(timer)
  }, [state])
  return <div style={{ position: 'relative', width: 26, height: 26 }}>
    <motion.div key={state} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={enter('fast')} style={{ position: 'absolute', left: 6, top: 6, pointerEvents: 'none' }}><Icon name={state === 'done' ? 'check' : state === 'error' ? 'x' : name} size={14} color={state === 'done' ? m.success : state === 'error' ? m.danger : m.textMuted} /></motion.div>
    <Base testId={testId} aria-label={state === 'done' ? 'Copied' : state === 'error' ? 'Copy failed. Try again' : title} tabIndex={focusable ? 0 : -1} onClick={() => setState(onCopy() ? 'done' : 'error')} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, borderRadius: 8, hover: { backgroundColor: m.hover }, focusVisible: { outlineWidth: 1, outlineColor: m.focusRing } }} />
  </div>
}
