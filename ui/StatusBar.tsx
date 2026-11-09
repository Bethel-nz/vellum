// Agent settings as one sentence under the composer, after design/status-sentence.html:
//   [agent] on [account], [mode], [model at effort] · [% of context used]
// Every bracketed phrase is a button opening its own menu above the phrase.
// Hovering a menu option previews it in the sentence (accent, solid underline);
// leaving it restores the sentence. Nothing applies until you pick it. The mode
// rows carry number shortcuts, and digits pick while the mode menu is open.
//
// Translations of the reference: the underlined words sit on a dashed 1px bottom
// border in `textFaint` (solid accent while previewing, `textUi` on hover);
// menus enter with
// opacity + a 4px rise on `ease.enter` (no scale); the model/effort flyout and
// the context card stay the shared `Menu` / `ModelPicker` surfaces.

import { createContext, useContext, useRef, useState, type ReactNode } from 'react'
import { Button as Base } from '@gpuix/react/button'
import { DismissableLayer, type KeyEvent, type PublicInstance } from '@gpuix/react'
import { motion } from '../components/spring'
import { FloatingLayer } from '@gpuix/react/floating'
import { Button, closedByOutsidePress, Label, Menu, type MenuItem } from '../components'
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

type MenuKey = 'agent' | 'account' | 'mode' | 'model' | 'context'

export function StatusBar({
  accountLabel,
  accountColor,
  accounts,
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
  accountLabel: string
  /** The account's dot, so the account phrase keeps its colour in the sentence. */
  accountColor?: string
  accounts: MenuItem[]
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
  const [menu, setMenu] = useState<MenuKey | null>(null)
  const [preview, setPreview] = useState<{ kind: 'mode'; id: string } | null>(null)
  const close = () => {
    setMenu(null)
    setPreview(null)
  }
  // A press on an open menu's own trigger closes it (keyed guard), rather than reopening;
  // closing one menu also doesn't eat the click that moves straight to another phrase.
  const toggle = (k: MenuKey) => {
    setPreview(null)
    setMenu((cur) => (cur === k || closedByOutsidePress(k) ? null : k))
  }
  // Claude's list until the agent sends its own; another agent's is empty until then (its default).
  const list = models ?? (agent.id === 'claude' ? fallbackModels : agent.defaultModel ? [agent.defaultModel] : [])
  // What the sentence shows: the pick, or the hovered mode while its menu is open.
  // The model phrase never previews: it changes only when you pick.
  const shownMode = preview?.kind === 'mode' ? (preview.id as PermissionMode) : mode
  const effectiveModel = model ?? agent.defaultModel?.value
  const picked = list.find((x) => x.value === (effectiveModel ?? 'default'))
  const previewingMode = preview?.kind === 'mode'
  const modeLabel = modes.find((x) => x.id === shownMode)?.label ?? shownMode
  const risky = shownMode === 'bypassPermissions'
  const modelTitle = shortModel(picked, effectiveModel ? undefined : resolvedModel)
  const effortName = efforts?.find((option) => option.value === think)?.displayName ?? effortLabel(think)
  const effort = effortName.slice(0, 1).toLowerCase() + effortName.slice(1)
  // Amber at 70%+, red at 90%+, in the phrase, the card and the bar alike.
  const fraction = context?.window ? context.used / context.window : 0
  const pct = context?.window ? Math.round(fraction * 100) : undefined
  const ctxTone = fraction >= 0.9 ? m.danger : fraction >= 0.7 ? m.warning : m.textUi

  const modeItems: MenuItem[] = modes.map((x, i) => ({
    label: x.label,
    hint: x.hint,
    icon: modeIcon[x.id],
    shortcut: String(i + 1),
    checked: x.id === mode,
    destructive: x.id === 'bypassPermissions',
    testId: `mode-${x.id}`,
    onSelect: () => onMode(x.id),
  }))
  // Digits pick while the mode menu is open; the rows show their number.
  const modeKeys = (e: KeyEvent) => {
    if (menu !== 'mode' || e.modifiers?.ctrl || !e.key) return
    const next = /^[1-9]$/.test(e.key) ? modes[Number(e.key) - 1] : undefined
    if (!next) return
    e.preventDefault()
    onMode(next.id)
    close()
  }

  return (
    <div testId="status-bar" role="toolbar" aria-label="Agent settings" style={{ position: 'relative', display: 'flex', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', rowGap: 2, minHeight: statusBarHeight }}>
      <div style={{ position: 'relative', display: 'flex', flexShrink: 0 }}>
        <Phrase testId="agent-pill" label={`Agent: ${agent.title}`} open={menu === 'agent'} onPress={() => toggle('agent')}>
          <Icon name={agent.id} size={14} />
          <Words>{agent.title}</Words>
        </Phrase>
        <Menu open={menu === 'agent'} onClose={close} side="top" align="start" width={280} testId="agent-menu" closeKey="agent" items={accounts} />
      </div>
      <Glue>·</Glue>
      <div style={{ position: 'relative', display: 'flex', flexShrink: 0 }}>
        <Phrase testId="account-pill" label={`Account: ${accountLabel}`} open={menu === 'account'} onPress={() => toggle('account')}>
          <div style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: accountColor ?? m.textMuted, flexShrink: 0 }} />
          <Words>{accountLabel}</Words>
        </Phrase>
        <Menu open={menu === 'account'} onClose={close} side="top" align="start" width={280} testId="account-menu" closeKey="account" items={accounts} />
      </div>
      <Glue>·</Glue>
      <div onKeyDown={modeKeys} style={{ position: 'relative', display: 'flex', flexShrink: 0 }}>
        <Phrase testId="mode-pill" label={`Permissions: ${modeLabel}`} open={menu === 'mode'} previewing={previewingMode} onPress={() => toggle('mode')}>
          <Words tone={previewingMode ? m.accent : risky ? m.warning : undefined}>{modeLabel}</Words>
        </Phrase>
        <Menu
          open={menu === 'mode'}
          onClose={close}
          side="top"
          align="end"
          width={360}
          testId="mode-menu"
          closeKey="mode"
          items={modeItems}
          onActiveChange={(i) => {
            const id = modes[i]?.id
            setPreview((prev) => {
              const next = id ? { kind: 'mode' as const, id } : null
              return next && prev?.kind === 'mode' && prev.id === next.id ? prev : next
            })
          }}
        />
      </div>
      <Glue>·</Glue>
      <div style={{ position: 'relative', display: 'flex', flexShrink: 0 }}>
        <Phrase testId="model-pill" label={`Model: ${modelTitle} · Effort: ${effort}`} open={menu === 'model'} onPress={() => toggle('model')}>
          <Words>{effort === 'default' ? modelTitle : `${modelTitle}, ${effort} effort`}</Words>
        </Phrase>
        {menu === 'model' ? (
          <ModelPicker
            models={list}
            model={effectiveModel}
            resolvedModel={resolvedModel}
            efforts={efforts}
            think={think}
            onModel={onModel}
            onThink={onThink}
            onClose={close}
          />
        ) : null}
      </div>
      <Glue>·</Glue>
      <div style={{ position: 'relative', display: 'flex', flexShrink: 0 }}>
        <Phrase testId="context-pill" label={contextLabel(context)} open={menu === 'context'} onPress={() => toggle('context')}>
          {context?.used ? (
            <Words tone={ctxTone} labelTone={m.textMuted} figure={pct !== undefined ? `${pct}%` : formatTokens(context.used)}>
              {pct !== undefined ? 'of context used' : 'tokens'}
            </Words>
          ) : (
            <Words tone={m.textMuted}>Context empty</Words>
          )}
        </Phrase>
        {menu === 'context' ? <ContextCard context={context} running={running} onClose={close} onCompact={onCompact} /> : null}
      </div>
    </div>
  )
}

/** A phrase in the sentence: quiet at rest, its words on a dashed underline marking it as a control. */
function Phrase({ testId, label, open, previewing, onPress, children }: {
  testId?: string
  label: string
  open: boolean
  previewing?: boolean
  onPress: () => void
  children: ReactNode
}) {
  const m = useM()
  const [hovered, setHovered] = useState(false)
  const [pressed, setPressed] = useState(false)
  const line = previewing ? 'preview' : hovered || open ? 'hover' : 'rest'
  const wash = pressed ? m.pressed : open ? m.selected : hovered ? m.hover : '#00000000'
  return (
    <Base
      testId={testId}
      aria-label={label}
      aria-expanded={open}
      onClick={onPress}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false)
        setPressed(false)
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        height: 22,
        cursor: 'pointer',
        flexShrink: 0,
        focusVisible: { outlineWidth: 2, outlineColor: m.focusRing, outlineOffset: 1 },
      }}
    >
      {/* The wash reaches 3px past the words so punctuation can sit flush (negative margins collapse the row). */}
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: -3, right: -3, borderRadius: 5, backgroundColor: wash, pointerEvents: 'none' }} />
      <Underline.Provider value={line}>{children}</Underline.Provider>
    </Base>
  )
}

const Underline = createContext<'rest' | 'hover' | 'preview'>('rest')

/** The sentence's own words between phrases; a comma hugs the phrase before it. */
function Glue({ tight, children }: { tight?: boolean; children: ReactNode }) {
  const m = useM()
  return <text style={{ fontSize: 12.5, lineHeight: 16, color: m.textMuted, whiteSpace: 'nowrap', paddingLeft: tight ? 0 : 4, paddingRight: 4 }}>{children}</text>
}

/** A phrase's label on its underline; `figure` leads in mono so changing digits hold their width. */
function Words({ tone, labelTone, figure, children }: { tone?: string; labelTone?: string; figure?: string; children: ReactNode }) {
  const m = useM()
  const line = useContext(Underline)
  // Quiet at rest, so the footer doesn't compete with the note; the line shows when you reach for it.
  const color = tone ?? (line === 'rest' ? m.textMuted : m.textUi)
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 4,
        paddingTop: 1,
        borderBottomWidth: 1,
        borderColor: line === 'preview' ? m.accent : line === 'hover' ? color : '#00000000',
      }}
    >
      {figure ? <text style={{ fontSize: 12.5, lineHeight: 16, fontFamily: font.mono, color, whiteSpace: 'nowrap' }}>{figure}</text> : null}
      <text style={{ fontSize: 12.5, lineHeight: 16, fontWeight: 500, color: labelTone ?? color, whiteSpace: 'nowrap' }}>{children}</text>
    </div>
  )
}

function contextLabel(c?: ContextUse) {
  if (!c?.used) return 'Context: empty'
  return c.window ? `Context: ${formatTokens(c.used)} of ${formatTokens(c.window)} tokens` : `Context: ${formatTokens(c.used)} tokens`
}

function ContextCard({ context, running, onClose, onCompact }: { context?: ContextUse; running: boolean; onClose: () => void; onCompact: () => void }) {
  const m = useM()
  const agent = useAgent()
  const panel = useRef<PublicInstance>(null)
  const used = context?.used ?? 0
  const window = context?.window
  const pct = window ? Math.round((used / window) * 100) : undefined
  const fraction = window ? used / window : 0
  const tone = fraction >= 0.9 ? m.danger : fraction >= 0.7 ? m.warning : m.textMuted
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
              <text testId="context-used" style={{ fontSize: 12, lineHeight: 16, color: tone, fontFamily: font.mono }}>
                {used ? `${formatTokens(used)}${window ? ` / ${formatTokens(window)}` : ''}${pct !== undefined ? ` · ${pct}%` : ''}` : 'empty'}
              </text>
            </div>
            <Bar fraction={fraction} />
            <text style={{ fontSize: 12, lineHeight: 17, color: m.textMuted }}>
              {used
                ? 'Summarize older messages to free up context.'
                : `Context fills as you talk to ${agent.title}.`}
            </text>
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <div style={{ flexGrow: 1 }} />
              <Button
                testId="context-not-now"
                title="Close the context card"
                onPress={onClose}
                style={{ gap: 6 }}
              >
                <Label muted>Not now</Label>
              </Button>
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
