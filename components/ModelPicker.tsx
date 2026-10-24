// Arc's model/effort composition, backed only by the current agent's options.
// Rows have static native click overlays; animated copy never owns a press.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { DismissableLayer, motion, useGpuixRequired, useWindowSize, type KeyEvent, type PublicInstance } from '@gpuix/react'
import { Button as Base } from '@gpuix/react/button'
import { FloatingLayer } from '@gpuix/react/floating'
import type { Think } from '../core/asks'
import { effortLabel, fallbackEfforts, shortModel, type EffortOption, type ModelOption } from '../core/models'
import { elevation, radiusXl } from '../ui/theme'
import { Icon } from './Icon'
import { Lifted } from './Lifted'
import { PopoverBackdrop } from './PopoverBackdrop'
import { duration, enter, offset, stagger, useReducedMotion } from './motion'
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
  const renderer = useGpuixRequired()
  const window = useWindowSize()
  const main = useRef<PublicInstance>(null)
  const child = useRef<PublicInstance>(null)
  const [active, setActive] = useState(0)
  const [sub, setSub] = useState<'effort' | null>(null)
  const [subActive, setSubActive] = useState(0)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const count = models.length + 1
  const keep = () => clearTimeout(leaveTimer.current)
  const leave = () => { leaveTimer.current = setTimeout(() => setSub(null), duration.fast * 1000) }
  useEffect(() => () => clearTimeout(leaveTimer.current), [])
  const choose = (option: ModelOption) => { onClose(); onModel(option.value === 'default' ? undefined : option.value) }
  const openSub = (focus = false) => {
    keep()
    setSub('effort')
    setSubActive(0)
    if (focus) setTimeout(() => { if (child.current) renderer.focusElement?.(child.current.id) }, 32)
  }
  const activate = (index: number) => {
    if (models[index]) choose(models[index])
    else openSub(true)
  }
  const navigate = (event: KeyEvent, nested = false) => {
    if (event.defaultPrevented) return
    const length = nested ? efforts.length : count
    const index = nested ? subActive : active
    const set = nested ? setSubActive : setActive
    if (event.key === 'down' || (event.modifiers?.ctrl && event.key === 'n')) { event.preventDefault(); set((index + 1) % length) }
    else if (event.key === 'up' || (event.modifiers?.ctrl && event.key === 'p')) { event.preventDefault(); set((index + length - 1) % length) }
    else if (event.key === 'enter' || event.key === 'space') {
      event.preventDefault()
      if (!nested) activate(index)
      else if (efforts[index]) { onThink(efforts[index].value); setSub(null); if (main.current) renderer.focusElement?.(main.current.id) }
    } else if (!nested && event.key === 'right' && index === models.length) { event.preventDefault(); activate(index) }
    else if (nested && (event.key === 'left' || event.key === 'escape')) { event.preventDefault(); event.stopPropagation(); setSub(null); if (main.current) renderer.focusElement?.(main.current.id) }
  }
  const side = ((main.current && renderer.getElementBounds?.(main.current.id)?.x) ?? window.width) + 336 + 288 <= window.width ? 'right' : 'left'
  const submenu = sub ? (
    <FloatingLayer side={side} align="end" sideOffset={6} style={{ width: 280, borderRadius: radiusXl, backgroundColor: '#00000000' }}>
      <div ref={child} role="menu" tabIndex={0} onKeyDown={(event) => navigate(event, true)} onMouseEnter={keep} onMouseLeave={leave} testId="effort-menu" style={{ position: 'relative', keyboardFocusDim: false }}>
        <Surface />
        <div style={{ position: 'relative', padding: 6, display: 'flex', flexDirection: 'column' }}>
          {efforts.map((option, index) => <PickerRow key={option.value} label={option.displayName} description={option.description ?? effortHints[option.value]} checked={think === option.value} selected={subActive === index} onHover={() => setSubActive(index)} onPress={() => { onThink(option.value); setSub(null) }} testId={`effort-${option.value}`} />)}
        </div>
      </div>
    </FloatingLayer>
  ) : null
  return (
    <DismissableLayer onEscapeKeyDown={() => sub ? setSub(null) : onClose()} initialFocus={() => main.current?.id ?? null}>
      <FloatingLayer side="top" align="end" sideOffset={6} style={{ width: 336, borderRadius: radiusXl, backgroundColor: '#00000000' }}>
        <PopoverBackdrop onClose={onClose} testId="model-menu-backdrop" />
        <div ref={main} role="menu" tabIndex={0} testId="model-menu" onKeyDown={(event) => navigate(event)} onMouseEnter={keep} onMouseLeave={leave} style={{ position: 'relative', keyboardFocusDim: false }}>
          <Surface />
          <div style={{ position: 'relative', padding: 6, display: 'flex', flexDirection: 'column' }}>
            {models.map((option, index) => <PickerRow key={option.value} label={modelTitle(option, resolvedModel)} description={modelDetail(option)} icon={<Icon name="claude" size={20} color="#d97757" />} checked={(model ?? 'default') === option.value} selected={active === index && !sub} index={index} onHover={() => { setActive(index); setSub(null) }} onPress={() => choose(option)} testId={`model-${option.value}`} />)}
            <div style={{ height: 1, margin: 6, backgroundColor: m.border }} />
            <PickerRow label="Effort" detail={efforts.find((option) => option.value === think)?.displayName ?? effortLabel(think)} icon={<Icon name="gauge" size={18} />} arrow selected={sub === 'effort' || active === models.length} onHover={() => { setActive(models.length); openSub() }} onPress={() => openSub(true)} testId="model-effort" compact>{submenu}</PickerRow>
          </div>
        </div>
      </FloatingLayer>
    </DismissableLayer>
  )
}

function Surface() {
  const m = useM()
  const reduced = useReducedMotion()
  return <Lifted initial={reduced ? false : { opacity: 0, top: offset.menu }} animate={{ opacity: 1, top: 0 }} transition={enter('fast')} shadow={elevation(m, 'popover')} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, borderRadius: radiusXl, borderWidth: 1, borderColor: m.border, backgroundColor: m.popup, pointerEvents: 'none' }} />
}

function PickerRow({ label, description, detail, icon, checked, selected, arrow, compact, index = 0, onPress, onHover, testId, children }: { label: string; description?: string; detail?: string; icon?: ReactNode; checked?: boolean; selected?: boolean; arrow?: boolean; compact?: boolean; index?: number; onPress: () => void; onHover: () => void; testId: string; children?: ReactNode }) {
  const m = useM()
  const reduced = useReducedMotion()
  return <div style={{ position: 'relative', height: compact ? 40 : 54 }}>
    <motion.div initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={enter('fast', Math.min(index, stagger.maxItems - 1) * stagger.item)} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, paddingLeft: 12, paddingRight: 12, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: radiusXl - 4, backgroundColor: selected ? m.hover : '#00000000', pointerEvents: 'none' }}>
      {icon}
      <div style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}><text style={{ fontSize: 13, lineHeight: 18, color: m.textUi, fontWeight: 500, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{label}</text>{description ? <text style={{ fontSize: 11.5, lineHeight: 16, color: m.textMuted, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{description}</text> : null}</div>
      {detail ? <text style={{ fontSize: 12, color: m.textMuted }}>{detail}</text> : null}
      {arrow ? <Icon name="chevronRight" size={13} /> : checked ? <Icon name="check" size={15} color={m.textUi} /> : null}
    </motion.div>
    <Base testId={testId} aria-label={description ? `${label}. ${description}` : label} aria-selected={checked} onClick={onPress} onMouseEnter={onHover} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, borderRadius: radiusXl - 4, focusVisible: { outlineWidth: 2, outlineColor: m.focusRing, outlineOffset: -2 } }} />
    {children}
  </div>
}
