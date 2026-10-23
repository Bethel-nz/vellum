// The bottom-right corner of the note: how Claude will work on the next turn, as four small
// controls that stay out of the writing. Permission mode and thinking are icons (their names are
// in the tooltip and the menu), the model is its short name, and context is a ring that fills as
// the conversation grows, with the token count beside it. Everything opens upward, from here.
//
//   shield / pencil / checklist / bolt / ban / lock   mode (⇧⇥ in the composer cycles it)
//   bulb   thinking off, on, max (faint, plain, accent)
//   name   model switcher, from the CLI's own list
//   ring   context card: used of window, and Compact

import { useState } from 'react'
import { DismissableLayer, motion, type PublicInstance } from '@gpuix/react'
import { FloatingLayer } from '@gpuix/react/floating'
import { useRef } from 'react'
import { Button, closedByOutsidePress, Label, markOutsideClose, Menu, Tooltip } from '../components'
import { duration, ease, offset, tween } from '../components/motion'
import { modeLabel, modes, type PermissionMode, type Think } from '../core/asks'
import { fallbackModels, formatTokens, shortModel, type ContextUse, type ModelOption } from '../core/models'
import type { IconName } from './icons'
import { Icon, useM } from './kit'
import { concentric, elevation, font, radiusBase, radiusXl } from './theme'

export const statusBarHeight = 28

const modeIcon: Record<PermissionMode, IconName> = {
  manual: 'shield',
  acceptEdits: 'pencil',
  plan: 'listChecks',
  auto: 'zap',
  dontAsk: 'ban',
  bypassPermissions: 'unlock',
}

const thinkNext: Record<Think, Think> = { off: 'on', on: 'max', max: 'off' }
const thinkTitle: Record<Think, string> = { off: 'Thinking off', on: 'Thinking on', max: 'Thinking at max effort' }
/** What a click on the bulb does next, for its tooltip. */
const thinkHint: Record<Think, string> = { off: 'click to turn on', on: 'click for max effort', max: 'click to turn off' }

export function StatusBar({
  mode,
  onMode,
  think,
  onThink,
  models,
  model,
  resolvedModel,
  onModel,
  context,
  running,
  onCompact,
}: {
  mode: PermissionMode
  onMode: (mode: PermissionMode) => void
  think: Think
  onThink: (think: Think) => void
  models?: ModelOption[]
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
  const [menu, setMenu] = useState<'mode' | 'model' | 'context' | null>(null)
  const close = () => setMenu(null)
  // A press on an open menu's own trigger closes it (closedByOutsidePress), rather than reopening.
  const toggle = (k: 'mode' | 'model' | 'context') => setMenu((cur) => (cur === k || closedByOutsidePress() ? null : k))
  const list = models ?? fallbackModels
  const picked = list.find((x) => x.value === (model ?? 'default'))
  const risky = mode === 'bypassPermissions'
  const modeColor = risky ? m.warning : mode === 'plan' ? m.blue : m.textMuted

  return (
    <div testId="status-bar" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 2, height: statusBarHeight }}>
      <div style={{ position: 'relative' }}>
        <Tooltip label={`Permissions: ${modeLabel(mode)}`} shortcut="⇧⇥" side="top">
          <Button onPress={() => toggle('mode')} selected={menu === 'mode'} testId="mode-pill" title={`Change permissions (now ${modeLabel(mode)})`} style={iconButton}>
            <Icon name={modeIcon[mode]} size={14} color={modeColor} />
          </Button>
        </Tooltip>
        <Menu
          open={menu === 'mode'}
          onClose={close}
          side="top"
          align="end"
          width={360}
          testId="mode-menu"
          items={modes.map((x) => ({ label: x.label, hint: x.hint, icon: modeIcon[x.id], checked: x.id === mode, destructive: x.id === 'bypassPermissions', testId: `mode-${x.id}`, onSelect: () => onMode(x.id) }))}
        />
      </div>

      <Tooltip label={`${thinkTitle[think]} · ${thinkHint[think]}`} side="top">
        <Button onPress={() => onThink(thinkNext[think])} testId="think-pill" title={`${thinkTitle[think]}. Change thinking`} style={iconButton}>
          <Icon name="bulb" size={14} color={think === 'off' ? m.textFaint : think === 'max' ? m.accent : m.textMuted} />
          {think === 'max' ? <div style={{ position: 'absolute', top: 4, right: 5, width: 4, height: 4, borderRadius: 2, backgroundColor: m.accent }} /> : null}
        </Button>
      </Tooltip>

      <div style={{ position: 'relative' }}>
        <Tooltip label="Model for this note" side="top">
          <Button onPress={() => toggle('model')} selected={menu === 'model'} testId="model-pill" title="Change model" style={{ paddingLeft: 7, paddingRight: 7, height: 24, minHeight: 24 }}>
            <text style={{ fontSize: 12, lineHeight: 16, fontWeight: 500, color: m.textMuted, whiteSpace: 'nowrap' }}>{shortModel(picked, model ? undefined : resolvedModel)}</text>
          </Button>
        </Tooltip>
        <Menu
          open={menu === 'model'}
          onClose={close}
          side="top"
          align="end"
          width={320}
          testId="model-menu"
          items={[
            { kind: 'label' as const, label: models ? 'Model for this note' : 'Model for this note · more after the first reply' },
            ...list.map((x) => ({
              label: x.displayName,
              hint: x.description?.split(' · ')[0],
              checked: x.value === (model ?? 'default'),
              testId: `model-${x.value}`,
              onSelect: () => onModel(x.value === 'default' ? undefined : x.value),
            })),
          ]}
        />
      </div>

      <div style={{ position: 'relative' }}>
        <Tooltip label={contextLabel(context)} side="top">
          <Button onPress={() => toggle('context')} selected={menu === 'context'} testId="context-pill" title="Show context" style={{ gap: 6, paddingLeft: 6, paddingRight: 7, height: 24, minHeight: 24 }}>
            <Ring fraction={context?.window ? context.used / context.window : 0} />
            {context?.used ? <text style={{ fontSize: 11.5, lineHeight: 15, color: m.textFaint, fontFamily: font.mono }}>{formatTokens(context.used)}</text> : null}
          </Button>
        </Tooltip>
        {menu === 'context' ? <ContextCard context={context} running={running} onClose={close} onCompact={onCompact} /> : null}
      </div>
    </div>
  )
}

function contextLabel(c?: ContextUse) {
  if (!c?.used) return 'Context: empty'
  return c.window ? `Context: ${formatTokens(c.used)} of ${formatTokens(c.window)} tokens` : `Context: ${formatTokens(c.used)} tokens`
}

const iconButton = { width: 26, height: 24, minHeight: 24, paddingLeft: 0, paddingRight: 0, position: 'relative' as const }

/** How full the context is: a faint track and an arc, as two tinted SVGs (GPUIX tints a whole SVG one colour). */
function Ring({ fraction, size = 13 }: { fraction: number; size?: number }) {
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
  const panel = useRef<PublicInstance>(null)
  const used = context?.used ?? 0
  const window = context?.window
  const pct = window ? Math.round((used / window) * 100) : undefined
  const pad = 12
  return (
    <DismissableLayer onEscapeKeyDown={onClose} initialFocus={() => panel.current?.id ?? null}>
      <FloatingLayer side="top" align="end" sideOffset={6} style={{ width: 280 }}>
        <div ref={panel} testId="context-card" tabIndex={0} onMouseDownOutside={() => {
            markOutsideClose()
            onClose()
          }} style={{ keyboardFocusDim: false }}>
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
            }}
          >
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
                ? 'Everything Claude is holding for this note: your paragraphs, its replies, files it read and tool output. Compacting replaces the older part with a summary.'
                : 'Nothing yet. It fills as you and Claude write.'}
            </text>
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <div style={{ flexGrow: 1 }} />
              <Button
                testId="compact"
                disabled={!used || running}
                title={running ? 'Available when Claude finishes replying' : 'Summarize the conversation so far'}
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
