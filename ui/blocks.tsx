// One component per Block kind. Each renders as a quiet paragraph of the note:
// no bubbles, no avatars, small grey metadata, everything readable as a document.

import { memo, useState } from 'react'
import { hunksOnly, type Block, type Tag, type ToolCall } from '../core/threads'
import { getTerm } from '../core/term'
import { Icon, Meta, Quiet, useM } from './kit'
import { TerminalBlock } from './TerminalBlock'
import { concentric, font, nativeTheme, radiusBase, type } from './theme'

function time(at: string) {
  const d = new Date(at)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function TagChips({ tags }: { tags: Tag[] }) {
  const m = useM()
  if (!tags.length) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {tags.map((t) => (
        <div
          key={`${t.type}:${t.value}`}
          style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 5, height: 20, paddingLeft: 6, paddingRight: 7, borderRadius: 6, backgroundColor: m.codeBg }}
        >
          <Icon name={t.type === 'skill' ? 'sparkle' : t.type === 'folder' ? 'folder' : 'file'} size={11} />
          <text style={{ ...type.meta, color: m.textMuted, fontFamily: t.type === 'skill' ? font.sans : font.mono }}>{t.value}</text>
        </div>
      ))}
    </div>
  )
}

function UserBlock({ block }: { block: Extract<Block, { kind: 'user' }> }) {
  const m = useM()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Meta>{time(block.at)}</Meta>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {block.text.split('\n').map((line, i) => (
          <text key={i} style={{ ...type.user, color: m.text, fontWeight: 500 }}>
            {line || ' '}
          </text>
        ))}
      </div>
      <TagChips tags={block.tags} />
    </div>
  )
}

function AssistantBlock({ block }: { block: Extract<Block, { kind: 'assistant' }> }) {
  const m = useM()
  return <markdown source={block.markdown || ' '} theme={nativeTheme(m)} style={{ color: m.textMuted }} />
}

function ToolLine({ call }: { call: ToolCall }) {
  const m = useM()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <text style={{ ...type.meta, color: m.textMuted, width: 64, flexShrink: 0 }}>{call.name}</text>
        <text style={{ ...type.meta, color: call.status === 'error' ? m.danger : m.textFaint, fontFamily: font.mono, whiteSpace: 'nowrap', textOverflow: 'ellipsis', minWidth: 0, flexGrow: 1 }}>
          {call.detail}
        </text>
      </div>
      {call.error ? (
        <text style={{ ...type.meta, color: m.danger, paddingLeft: 72, lineClamp: 3 }}>{call.error}</text>
      ) : null}
    </div>
  )
}

function ActivityBlock({ block }: { block: Extract<Block, { kind: 'activity' }> }) {
  const m = useM()
  const [open, setOpen] = useState(false)
  const failed = block.items.some((i) => i.status === 'error')
  const running = block.items.some((i) => i.status === 'running')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Quiet onPress={() => setOpen((v) => !v)} style={{ alignSelf: 'start', marginLeft: -8 }} title="Show tool activity">
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} color={m.textFaint} />
        <text style={{ fontSize: 13, lineHeight: 18, color: failed ? m.danger : m.textMuted }}>
          {block.summary}
          {running ? '…' : ''}
        </text>
      </Quiet>
      {open && block.items.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 12, borderLeftWidth: 1, borderColor: m.border, marginLeft: 2 }}>
          {block.items.map((c) => (
            <ToolLine key={c.id} call={c} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function EditBlock({ block }: { block: Extract<Block, { kind: 'edit' }> }) {
  const m = useM()
  const [open, setOpen] = useState(false)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <text style={{ fontSize: 13, lineHeight: 18, color: m.textMuted }}>Edit</text>
        <text style={{ fontSize: 12.5, lineHeight: 18, color: m.text, fontFamily: font.mono }}>{block.path}</text>
        <text style={{ ...type.meta, color: m.success, fontFamily: font.mono }}>{`+${block.added}`}</text>
        <text style={{ ...type.meta, color: m.danger, fontFamily: font.mono }}>{`−${block.removed}`}</text>
        {block.status === 'error' ? <Meta color={m.danger}>failed</Meta> : null}
      </div>
      {block.error ? <text style={{ ...type.meta, color: m.danger, lineClamp: 3 }}>{block.error}</text> : null}
      <diff
        patch={hunksOnly(block.patch)}
        wordDiff
        maxLines={open ? undefined : 12}
        onShowMore={() => setOpen(true)}
        theme={nativeTheme(m)}
        style={{ borderRadius: concentric(radiusBase, 0), borderWidth: 1, borderColor: m.border, backgroundColor: m.codeBg, overflow: 'hidden' }}
      />
    </div>
  )
}

function AgentShell({ block }: { block: Extract<Block, { kind: 'shell' }> }) {
  const m = useM()
  const [open, setOpen] = useState(false)
  const output = (block.output ?? '').replace(/\s+$/, '')
  const lines = output ? output.split('\n') : []
  const shown = open ? lines : lines.slice(0, 12)
  const failed = block.exitCode !== undefined && block.exitCode !== 0
  return (
    <div style={{ display: 'flex', flexDirection: 'column', borderRadius: concentric(radiusBase, 0), borderWidth: 1, borderColor: m.border, backgroundColor: m.codeBg, overflow: 'hidden' }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 10, paddingRight: 10, paddingTop: 7, paddingBottom: 7 }}>
        <text style={{ flexGrow: 1, minWidth: 0, color: m.text, fontFamily: font.mono, fontSize: 12, lineHeight: 17, lineClamp: 3 }}>{`$ ${block.command}`}</text>
        {block.exitCode === undefined ? <Meta>running…</Meta> : failed ? <Meta color={m.danger}>failed</Meta> : null}
      </div>
      {shown.length ? (
        <code
          code={shown.join('\n')}
          language="bash"
          theme={nativeTheme(m)}
          style={{ paddingLeft: 10, paddingRight: 10, paddingBottom: 8, minWidth: 0, color: failed ? m.danger : m.termFg }}
        />
      ) : null}
      {lines.length > 12 ? (
        <div style={{ paddingLeft: 2, paddingBottom: 4 }}>
          <Quiet onPress={() => setOpen((v) => !v)}>
            <Meta color={m.textMuted}>{open ? 'Show less' : `Show all ${lines.length} lines`}</Meta>
          </Quiet>
        </div>
      ) : null}
    </div>
  )
}

function UserShell({ block, onSendOutput, onReturnFocus }: { block: Extract<Block, { kind: 'shell' }>; onSendOutput: (cmd: string, out: string) => void; onReturnFocus: () => void }) {
  const session = getTerm(block.termId)
  const frozen = block.grid ? { grid: block.grid, exitCode: block.exitCode ?? 0, output: block.output } : undefined
  if (!session && !frozen) {
    return <AgentShell block={{ ...block, exitCode: block.exitCode ?? -1, output: block.output ?? '(output was not saved)' }} />
  }
  return (
    <TerminalBlock
      session={session}
      frozen={frozen}
      title={`$ ${block.command}`}
      testId={`term-${block.termId}`}
      onReturnFocus={onReturnFocus}
      onSendOutput={(out) => onSendOutput(block.command, out)}
    />
  )
}

function ErrorBlock({ block, onLogin }: { block: Extract<Block, { kind: 'error' }>; onLogin: () => void }) {
  const m = useM()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10, borderRadius: concentric(radiusBase, 0), backgroundColor: m.dangerBg }}>
      <text style={{ fontSize: 13, lineHeight: 19, color: m.danger }}>{block.text}</text>
      {block.login ? (
        <Quiet onPress={onLogin} style={{ alignSelf: 'start', marginLeft: -8 }}>
          <Icon name="login" size={12} color={m.text} />
          <text style={{ fontSize: 12.5, lineHeight: 16, color: m.text }}>Log in to this account</text>
        </Quiet>
      ) : null}
    </div>
  )
}

export type BlockActions = {
  onLogin: () => void
  onSendOutput: (command: string, output: string) => void
  onReturnFocus: () => void
}

export const BlockView = memo(function BlockView({ block, actions }: { block: Block; actions: BlockActions }) {
  switch (block.kind) {
    case 'user':
      return <UserBlock block={block} />
    case 'assistant':
      return <AssistantBlock block={block} />
    case 'activity':
      return <ActivityBlock block={block} />
    case 'edit':
      return <EditBlock block={block} />
    case 'shell':
      return block.source === 'agent' ? (
        <AgentShell block={block} />
      ) : (
        <UserShell block={block} onSendOutput={actions.onSendOutput} onReturnFocus={actions.onReturnFocus} />
      )
    case 'error':
      return <ErrorBlock block={block} onLogin={actions.onLogin} />
  }
})
