// Arc's model/effort composition, backed only by the current agent's options.
// Rows have static native click overlays; animated copy never owns a press.
import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react'
import { DismissableLayer, useGpuixRequired, useWindowSize, type KeyEvent, type PublicInstance } from '@gpuix/react'
import { motion } from './spring'
import { Button as Base } from '@gpuix/react/button'
import { FloatingLayer } from '@gpuix/react/floating'
import type { Think } from '../core/asks'
import { effortLabel, fallbackEfforts, shortModel, type EffortOption, type ModelOption } from '../core/models'
import { elevation, radiusXl } from '../ui/theme'
import { useAgent } from './AgentContext'
import { Icon } from './Icon'
import { Button } from './Button'
import { Lifted } from './Lifted'
import { PopoverBackdrop } from './PopoverBackdrop'
import { duration, enter, offset, spring, stagger, tween, useReducedMotion } from './motion'
import { useM } from './theme'

type Props = {
  models: ModelOption[]
  model?: string
  resolvedModel?: string
  efforts?: EffortOption[]
  think: Think
  onModel: (value: string | undefined) => void
  onThink: (value: Think) => void
  onClose: () => void
}
const effortHints: Record<Think, string> = { off: 'Less reasoning', on: 'Agent default', medium: 'Balanced reasoning', high: 'More reasoning', xhigh: 'Extended reasoning', max: 'Most reasoning' }
const modelTitle = (option: ModelOption, resolved?: string) => {
  const name = shortModel(option, option.value === 'default' ? resolved : undefined)
  return /^(Opus|Sonnet|Haiku)\b/.test(name) ? `Claude ${name}` : name
}
const modelDetail = (option: ModelOption) => option.description?.includes(' · ') ? option.description.split(' · ').slice(1).join(' · ') : option.description

export function ModelPicker({ models, model, resolvedModel, efforts = fallbackEfforts, think, onModel, onThink, onClose }: Props) {
  const m = useM()
  const agent = useAgent()
  const renderer = useGpuixRequired()
  const window = useWindowSize()
  const main = useRef<PublicInstance>(null)
  const search = useRef<PublicInstance>(null)
  const rows = useRef<(PublicInstance | null)[]>([])
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return models.filter((option) => words.every((word) => `${option.displayName} ${option.value} ${option.description ?? ''}`.toLowerCase().includes(word)))
  }, [models, query])
  const child = useRef<PublicInstance>(null)
  // Both lists open on what's chosen now.
  const [active, setActive] = useState(() => Math.max(0, models.findIndex((option) => option.value === (model ?? 'default'))))
  const current = Math.max(0, efforts.findIndex((option) => option.value === think))
  const [sub, setSub] = useState<'effort' | null>(null)
  const [subActive, setSubActive] = useState(current)
  const keyboardNav = useRef(false)
  const pointer = useRef<[number | undefined, number | undefined]>([undefined, undefined])
  const allowHover = (point?: [number | undefined, number | undefined]) => {
    if (point) {
      if (point[0] !== pointer.current[0] || point[1] !== pointer.current[1]) keyboardNav.current = false
      pointer.current = point
    }
    return !keyboardNav.current
  }
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const count = filtered.length + 1
  const keep = () => clearTimeout(leaveTimer.current)
  const leave = () => { if (!keyboardNav.current) leaveTimer.current = setTimeout(() => setSub(null), duration.fast * 1000) }
  useEffect(() => () => clearTimeout(leaveTimer.current), [])
  useEffect(() => {
    const timer = setTimeout(() => { const node = rows.current[active]; if (node && active < filtered.length) renderer.scrollIntoView?.(node.id) }, 16)
    return () => clearTimeout(timer)
  }, [active, filtered, renderer])
  const choose = (option: ModelOption) => { onClose(); onModel(option.value === 'default' ? undefined : option.value) }
  // A level closes the picker as a model does: left open, the menu jumped as the pill's label changed width.
  const chooseEffort = (option: EffortOption) => { onClose(); onThink(option.value) }
  const openSub = (focus = false) => {
    keep()
    setSub('effort')
    setSubActive(current)
    if (focus) setTimeout(() => { if (child.current) renderer.focusElement?.(child.current.id) }, 32)
  }
  const activate = (index: number) => {
    if (filtered[index]) choose(filtered[index])
    else if (!query.trim() || filtered.length) openSub(true)
  }
  const navigate = (event: KeyEvent, nested = false) => {
    if (event.defaultPrevented) return
    keyboardNav.current = true
    const length = nested ? efforts.length : count
    const index = nested ? subActive : active
    const set = nested ? setSubActive : setActive
    if (event.key === 'down' || (event.modifiers?.ctrl && event.key === 'n')) { event.preventDefault(); set((index + 1) % length) }
    else if (event.key === 'up' || (event.modifiers?.ctrl && event.key === 'p')) { event.preventDefault(); set((index + length - 1) % length) }
    else if (event.key === 'enter' || event.key === 'space') {
      event.preventDefault()
      if (!nested) activate(index)
      else if (efforts[index]) chooseEffort(efforts[index])
    } else if (!nested && event.key === 'right' && index === filtered.length) { event.preventDefault(); activate(index) }
    else if (nested && (event.key === 'left' || event.key === 'escape')) { event.preventDefault(); event.stopPropagation(); setSub(null); if (search.current) renderer.focusElement?.(search.current.id) }
  }
  const side = ((main.current && renderer.getElementBounds?.(main.current.id)?.x) ?? window.width) + 336 + 288 <= window.width ? 'right' : 'left'
  const submenu = sub ? (
    <FloatingLayer side={side} align="end" sideOffset={6} style={{ width: 280, borderRadius: radiusXl, backgroundColor: '#00000000' }}>
      <div ref={child} role="menu" tabIndex={0} onKeyDown={(event) => navigate(event, true)} onMouseEnter={keep} onMouseLeave={leave} testId="effort-menu" style={{ position: 'relative', keyboardFocusDim: false, pointerEvents: 'auto' }}>
        <Surface />
        <PopupBody>
          {efforts.map((option, index) => <PickerRow key={option.value} label={option.displayName} description={option.description ?? effortHints[option.value]} checked={think === option.value} selected={subActive === index} onHover={(moved) => { if (allowHover(moved)) setSubActive(index) }} onPress={() => chooseEffort(option)} testId={`effort-${option.value}`} />)}
        </PopupBody>
      </div>
    </FloatingLayer>
  ) : null
  return (
    <DismissableLayer onEscapeKeyDown={() => sub ? setSub(null) : onClose()} initialFocus={() => search.current?.id ?? main.current?.id ?? null}>
      <FloatingLayer side="top" align="end" sideOffset={6} style={{ width: 336, borderRadius: radiusXl, backgroundColor: '#00000000' }}>
        <PopoverBackdrop onClose={onClose} exclude={main} testId="model-menu-backdrop" />
        <div ref={main} role="menu" tabIndex={0} testId="model-menu" onKeyDown={(event) => navigate(event)} onMouseEnter={keep} onMouseMove={(event) => { allowHover([event.x, event.y]) }} onMouseLeave={leave} style={{ position: 'relative', keyboardFocusDim: false, pointerEvents: 'auto' }}>
          <Surface />
          <PopupBody>
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, height: 34, paddingLeft: 10, paddingRight: 6, margin: 4, marginBottom: 8, borderRadius: 8, backgroundColor: m.chipBg, flexShrink: 0 }}>
              <Icon name="search" size={13} color={m.textMuted} />
              <input ref={search} testId="model-search" value={query} placeholder="Search models…" onChange={(event) => { keyboardNav.current = true; setQuery(event.value ?? ''); setActive(0); setSub(null) }} onSubmit={() => activate(active)} onKeyDown={(event) => {
                if (event.key === 'escape') { event.preventDefault(); if (sub) setSub(null); else onClose() }
                else if (['down', 'up', 'right'].includes(event.key) || event.modifiers?.ctrl && ['n', 'p'].includes(event.key)) navigate(event)
                event.stopPropagation()
              }} style={{ flexGrow: 1, minWidth: 0, fontSize: 12.5, color: m.text }} />
              {query ? <Button onPress={() => { keyboardNav.current = true; setQuery(''); setActive(0); if (search.current) renderer.focusElement?.(search.current.id) }} testId="model-search-clear" title="Clear model search" style={{ width: 22, paddingLeft: 0, paddingRight: 0 }}><Icon name="x" size={11} /></Button> : null}
            </div>
            <div testId="model-results" style={{ maxHeight: Math.max(120, Math.min(360, window.height - 190)), minHeight: 0, overflowY: 'scroll', pointerEvents: 'auto', scrollbarColor: m.scrollbar, scrollbarWidth: 5 }}>
              {filtered.length ? filtered.map((option, index) => <PickerRow key={option.value} nodeRef={(node) => { rows.current[index] = node }} label={modelTitle(option, resolvedModel)} description={modelDetail(option)} icon={<Icon name={agent.id} size={18} color={agent.id === 'claude' ? '#d97757' : m.textMuted} />} checked={(model ?? 'default') === option.value} selected={active === index && !sub} index={index} onHover={(moved) => { if (allowHover(moved)) { setActive(index); setSub(null) } }} onPress={() => choose(option)} testId={`model-${option.value}`} />) : <text testId="model-search-empty" style={{ padding: 12, fontSize: 12, lineHeight: 18, color: m.textMuted }}>No matching models.</text>}
            </div>
            <div style={{ height: 1, margin: 8, backgroundColor: m.border }} />
            <PickerRow label="Effort" detail={efforts.find((option) => option.value === think)?.displayName ?? effortLabel(think)} icon={<Icon name="gauge" size={18} />} arrow selected={sub === 'effort' || active === filtered.length} onHover={(moved) => { if (allowHover(moved)) { setActive(filtered.length); openSub() } }} onPress={() => openSub(true)} testId="model-effort" compact>{submenu}</PickerRow>
          </PopupBody>
        </div>
      </FloatingLayer>
    </DismissableLayer>
  )
}

function Surface() {
  const m = useM()
  const reduced = useReducedMotion()
  return <Lifted initial={reduced ? false : { opacity: 0, top: offset.menu }} animate={{ opacity: 1, top: 0 }} transition={tween(spring.snappy)} shadow={elevation(m, 'popover')} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, borderRadius: radiusXl, borderWidth: 1, borderColor: m.border, backgroundColor: m.popup, pointerEvents: 'none' }} />
}

function PopupBody({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion()
  return <motion.div initial={reduced ? false : { opacity: 0, top: offset.menu }} animate={{ opacity: 1, top: 0 }} transition={tween(spring.snappy)} style={{ position: 'relative', pointerEvents: 'none' }}><div style={{ padding: 8, display: 'flex', flexDirection: 'column', pointerEvents: 'auto' }}>{children}</div></motion.div>
}

function PickerRow({ nodeRef, label, description, detail, icon, checked, selected, arrow, compact, index = 0, onPress, onHover, testId, children }: { nodeRef?: Ref<PublicInstance>; label: string; description?: string; detail?: string; icon?: ReactNode; checked?: boolean; selected?: boolean; arrow?: boolean; compact?: boolean; index?: number; onPress: () => void; onHover: (point?: [number | undefined, number | undefined]) => void; testId: string; children?: ReactNode }) {
  const m = useM()
  const reduced = useReducedMotion()
  return <div ref={nodeRef} style={{ position: 'relative', height: compact || !description ? 40 : 56 }}>
    <motion.div initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={enter('fast', Math.min(index, stagger.maxItems - 1) * stagger.item)} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, paddingLeft: 12, paddingRight: 12, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: radiusXl - 6, backgroundColor: selected ? m.hover : '#00000000', pointerEvents: 'none' }}>
      {icon ? <div style={{ width: 20, height: 20, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</div> : null}
      <div style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}><text style={{ fontSize: 13, lineHeight: 18, color: m.textUi, fontWeight: 500, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{label}</text>{description ? <text style={{ fontSize: 11.5, lineHeight: 16, color: m.textMuted, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{description}</text> : null}</div>
      {detail ? <text style={{ fontSize: 12, color: m.textMuted }}>{detail}</text> : null}
      {arrow ? <Icon name="chevronRight" size={13} /> : checked ? <Icon name="check" size={15} color={m.textUi} /> : null}
    </motion.div>
    <Base testId={testId} aria-label={description ? `${label}. ${description}` : label} aria-selected={checked} onClick={onPress} onMouseEnter={() => onHover()} onMouseMove={(event) => onHover([event.x, event.y])} onKeyDown={(event) => { if (event.key === 'enter' || event.key === 'space') event.stopPropagation() }} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, borderRadius: radiusXl - 4, focusVisible: { outlineWidth: 2, outlineColor: m.focusRing, outlineOffset: -2 } }} />
    {children}
  </div>
}
