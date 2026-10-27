// Agent settings, centred below the note: three fixed segments on one shared surface.
// A single hover wash moves between them; labels stay visible. Everything opens upward.
//
//   shield / pencil / checklist / bolt / ban / lock   mode (⇧⇥ in the composer cycles it)
//   name   model and effort picker, from the CLI's own list
//   ring   context card: used of window, and Compact

import { useState } from 'react'
import { DismissableLayer, type PublicInstance } from '@gpuix/react'
import { motion } from '../components/spring'
import { FloatingLayer } from '@gpuix/react/floating'
import { useRef } from 'react'
import { Button, ButtonGroup, closedByOutsidePress, Label, Menu } from '../components'
import { duration, ease, offset, tween } from '../components/motion'
import { ModelPicker } from '../components/ModelPicker'
import { PopoverBackdrop } from '../components/PopoverBackdrop'
import { type PermissionMode, type Think } from '../core/asks'
import { effortLabel, fallbackModels, formatTokens, shortModel, type ContextUse, type EffortOption, type ModelOption } from '../core/models'
import type { IconName } from './icons'
import { Icon, useM } from './kit'
import { concentric, elevation, font, radiusBase, radiusXl } from './theme'
import { useAgent } from '../components/AgentContext'

export const statusBarHeight = 28

const modeIcon: Record<PermissionMode, IconName> = {
  manual: 'shield',
  acceptEdits: 'pencil',
  plan: 'listChecks',
  auto: 'zap',
  dontAsk: 'ban',
  bypassPermissions: 'unlock',
}

export function StatusBar({
  mode,
  modes,
  onMode,
  think,
  onThink,
  models,
  efforts,
  model,
  resolvedModel,
  onModel,
  context,
  running,
  onCompact,
}: {
  mode: PermissionMode
  /** The modes the note's agent has, in its words (core/agents.ts). */
  modes: { id: PermissionMode; label: string; hint: string }[]
  onMode: (mode: PermissionMode) => void
  think: Think
  onThink: (think: Think) => void
  models?: ModelOption[]
  efforts?: EffortOption[]
  /** The picked `--model` value; undefined is the account default. */
  model?: string
  /** What the CLI said it is running, for the label before a pick. */
  resolvedModel?: string
  onModel: (model: string | undefined) => void
  context?: ContextUse
  running: boolean
  onCompact: () => void
}) {
  const m = useM()
  const agent = useAgent()
  const [menu, setMenu] = useState<'mode' | 'model' | 'context' | null>(null)
  const close = () => setMenu(null)
  // A press on an open menu's own trigger closes it (keyed guard), rather than reopening;
  // closing one menu also doesn't eat the click that moves straight to another pill.
  const toggle = (k: 'mode' | 'model' | 'context') => setMenu((cur) => (cur === k || closedByOutsidePress(k) ? null : k))
  // Claude's list until the agent sends its own; another agent's is empty until then (its default).
  const list = models ?? (agent.id === 'claude' ? fallbackModels : agent.defaultModel ? [agent.defaultModel] : [])
  const effectiveModel = model ?? agent.defaultModel?.value
  const picked = list.find((x) => x.value === (effectiveModel ?? 'default'))
  const modeLabel = modes.find((x) => x.id === mode)?.label ?? mode
  const risky = mode === 'bypassPermissions'
  const modeColor = risky ? m.warning : m.textMuted
  const modelTitle = shortModel(picked, effectiveModel ? undefined : resolvedModel)
  const effort = efforts?.find((option) => option.value === think)?.displayName ?? effortLabel(think)
  const contextTitle = context?.used ? `${formatTokens(context.used)}${context.window ? ` / ${formatTokens(context.window)}` : ' tokens'}` : 'Context empty'

  return (
    <ButtonGroup label="Agent settings" testId="status-bar" items={[
      {
        id: 'mode-pill', label: `Permissions: ${modeLabel}`, shortcut: '⇧⇥', selected: menu === 'mode', onPress: () => toggle('mode'),
        content: <><Icon name={modeIcon[mode]} size={14} color={modeColor} /><Label muted>{modeLabel}</Label></>,
        popover: <Menu open={menu === 'mode'} onClose={close} side="top" align="end" width={360} testId="mode-menu" closeKey="mode" items={modes.map((x) => ({ label: x.label, hint: x.hint, icon: modeIcon[x.id], checked: x.id === mode, destructive: x.id === 'bypassPermissions', testId: `mode-${x.id}`, onSelect: () => onMode(x.id) }))} />,
      },
      {
        id: 'model-pill', label: `Model: ${modelTitle} · Effort: ${effort}`, selected: menu === 'model', onPress: () => toggle('model'),
        content: <><Icon name={agent.id} size={14} color={agent.id === 'claude' ? '#d97757' : m.textMuted} /><Label>{modelTitle}</Label><text style={{ fontSize: 11.5, lineHeight: 16, color: m.textMuted }}>{effort}</text></>,
        popover: menu === 'model' ? <ModelPicker models={list} model={effectiveModel} resolvedModel={resolvedModel} efforts={efforts} think={think} onModel={onModel} onThink={onThink} onClose={close} /> : null,
      },
      {
        id: 'context-pill', label: contextLabel(context), selected: menu === 'context', onPress: () => toggle('context'),
        content: <><Ring fraction={context?.window ? context.used / context.window : 0} /><Label muted>{contextTitle}</Label></>,
        popover: menu === 'context' ? <ContextCard context={context} running={running} onClose={close} onCompact={onCompact} /> : null,
      },
    ]} />
  )
}

function contextLabel(c?: ContextUse) {
  if (!c?.used) return 'Context: empty'
  return c.window ? `Context: ${formatTokens(c.used)} of ${formatTokens(c.window)} tokens` : `Context: ${formatTokens(c.used)} tokens`
}

/** How full the context is: a faint track and an arc, as two tinted SVGs (GPUIX tints a whole SVG one colour). */
function Ring({ fraction, size = 14 }: { fraction: number; size?: number }) {
  const m = useM()
  const f = Math.max(0, Math.min(1, fraction))
  const color = f >= 0.9 ? m.danger : f >= 0.7 ? m.warning : m.textMuted
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg source={ring(1)} style={{ position: 'absolute', left: 0, top: 0, width: size, height: size, color: m.border }} />
      {f > 0.005 ? <svg source={ring(f)} style={{ position: 'absolute', left: 0, top: 0, width: size, height: size, color }} /> : null}
    </div>
  )
}

const ringCache = new Map<number, string>()
function ring(fraction: number): string {
  // 2% steps keep the set of distinct sources small.
  const f = Math.round(fraction * 50) / 50
  const hit = ringCache.get(f)
  if (hit) return hit
  const r = 9
  let body: string
  if (f >= 1) body = `<circle cx="12" cy="12" r="${r}"/>`
  else {
    const a = f * 2 * Math.PI
    const x = (12 + r * Math.sin(a)).toFixed(2)
    const y = (12 - r * Math.cos(a)).toFixed(2)
    body = `<path d="M12 3A${r} ${r} 0 ${f > 0.5 ? 1 : 0} 1 ${x} ${y}"/>`
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="3.2" stroke-linecap="round">${body}</svg>`
  ringCache.set(f, svg)
  return svg
}

function ContextCard({ context, running, onClose, onCompact }: { context?: ContextUse; running: boolean; onClose: () => void; onCompact: () => void }) {
  const m = useM()
  const agent = useAgent()
  const panel = useRef<PublicInstance>(null)
  const used = context?.used ?? 0
  const window = context?.window
  const pct = window ? Math.round((used / window) * 100) : undefined
  const pad = 12
  return (
    <DismissableLayer onEscapeKeyDown={onClose} initialFocus={() => panel.current?.id ?? null}>
      <FloatingLayer side="top" align="end" sideOffset={6} style={{ width: 280, borderRadius: radiusXl, backgroundColor: '#00000000' }}>
        <PopoverBackdrop onClose={onClose} testId="context-card-backdrop" />
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: GPUIX needs a focusable panel to receive Escape. */}
        <div ref={panel} testId="context-card" role="dialog" aria-label="Context" tabIndex={0} style={{ position: 'relative', keyboardFocusDim: false }}>
          <motion.div
            initial={{ opacity: 0, top: offset.menu }}
            animate={{ opacity: 1, top: 0 }}
            transition={tween({ duration: duration.fast, ease: ease.enter })}
            style={{
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              padding: pad,
              backgroundColor: m.popup,
              borderRadius: radiusXl,
              borderWidth: 1,
              borderColor: m.border,
              boxShadow: elevation(m, 'popover'),
              pointerEvents: 'none',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, pointerEvents: 'auto' }}>
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
              <text style={{ fontSize: 13, lineHeight: 17, fontWeight: 600, color: m.text }}>Context</text>
              <div style={{ flexGrow: 1 }} />
              <text testId="context-used" style={{ fontSize: 12, lineHeight: 16, color: m.textMuted, fontFamily: font.mono }}>
                {used ? `${formatTokens(used)}${window ? ` / ${formatTokens(window)}` : ''}${pct !== undefined ? ` · ${pct}%` : ''}` : 'empty'}
              </text>
            </div>
            <Bar fraction={window ? used / window : 0} />
            <text style={{ fontSize: 12, lineHeight: 17, color: m.textMuted }}>
              {used
                ? 'Summarize older messages to free up context.'
                : `Context fills as you talk to ${agent.title}.`}
            </text>
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <div style={{ flexGrow: 1 }} />
              <Button
                testId="compact"
                disabled={!used || running}
                title={running ? `Available when ${agent.title} finishes replying` : 'Summarize the conversation so far'}
                onPress={() => {
                  onClose()
                  onCompact()
                }}
                style={{ gap: 6 }}
              >
                <Icon name="fold" size={13} />
                <Label>Compact</Label>
              </Button>
            </div>
            </div>
          </motion.div>
        </div>
      </FloatingLayer>
    </DismissableLayer>
  )
}

function Bar({ fraction }: { fraction: number }) {
  const m = useM()
  const f = Math.max(0, Math.min(1, fraction))
  const color = f >= 0.9 ? m.danger : f >= 0.7 ? m.warning : m.accent
  return (
    <div style={{ height: 4, borderRadius: 2, backgroundColor: m.border, overflow: 'hidden' }}>
      <div style={{ width: `${f * 100}%`, height: 4, borderRadius: concentric(radiusBase, 4), backgroundColor: color }} />
    </div>
  )
}
