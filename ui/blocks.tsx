// One component per Block kind. Each renders as a paragraph of the note: no
// bubbles, no avatars, no timestamps. Your text and Claude's replies are both
// editable in place; tool work renders as quiet embeds between them.

import { memo, useEffect, useRef, useState } from 'react'
import type { KeyEvent } from '@gpuix/react'
import { hunksOnly, type Block, type Tag, type ToolCall } from '../core/threads'
import { getTerm } from '../core/term'
import { Icon, Meta, Quiet, useM } from './kit'
import { TerminalBlock } from './TerminalBlock'
import { concentric, font, nativeTheme, radiusBase, type } from './theme'

const COMMIT_MS = 500

/**
 * A paragraph you can edit: a borderless textarea that grows with its text.
 * Changes are committed after a short pause, on Ctrl+Enter, and on unmount.
 */
function EditableText({
  value,
  onCommit,
  onSend,
  onDone,
  color,
  weight,
  autoFocus,
  testId,
}: {
  value: string
  onCommit: (text: string) => void
  onSend: () => void
  onDone?: () => void
  color: string
  weight?: number
  autoFocus?: boolean
  testId?: string
}) {
  const m = useM()
  const [text, setText] = useState(value)
  const pending = useRef<string | undefined>(undefined)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const commitRef = useRef(onCommit)
  commitRef.current = onCommit

  const flush = () => {
    clearTimeout(timer.current)
    if (pending.current === undefined) return
    const next = pending.current
    pending.current = undefined
    commitRef.current(next)
  }
  // Follow the block when it changes from outside (replay, streaming finished).
  useEffect(() => {
    if (pending.current === undefined) setText(value)
  }, [value])
  useEffect(() => flush, [])

  const onKeyDown = (e: KeyEvent) => {
    if (e.key === 'enter' && e.modifiers?.ctrl) {
      e.preventDefault()
      flush()
      onSend()
    } else if (e.key === 'escape' && onDone) {
      e.preventDefault()
      flush()
      onDone()
    }
  }

  return (
    <textarea
      testId={testId}
      value={text}
      minRows={1}
      maxRows={10000}
      autoFocus={autoFocus}
      theme={{ caret: m.appearance === 'dark' ? m.text : m.accent, textFaint: m.textFaint }}
      style={{ width: '100%', minWidth: 0, fontFamily: font.sans, ...type.user, fontWeight: weight, color, backgroundColor: '#00000000', borderWidth: 0, padding: 0 }}
      onChange={(e) => {
        const next = e.value ?? ''
        setText(next)
        pending.current = next
        clearTimeout(timer.current)
        timer.current = setTimeout(flush, COMMIT_MS)
      }}
      onKeyDown={onKeyDown}
    />
  )
}

function UserBlock({ block, actions }: { block: Extract<Block, { kind: 'user' }>; actions: BlockActions }) {
  const m = useM()
  return (
    <EditableText
      value={block.text}
      color={m.text}
      weight={500}
      testId={`para-${block.id}`}
      onCommit={(text) => actions.onEdit(block.id, text)}
      onSend={actions.onSend}
    />
  )
}

/** Claude's reply: rendered markdown, which turns into its source while you edit it. */
function AssistantBlock({ block, actions }: { block: Extract<Block, { kind: 'assistant' }>; actions: BlockActions }) {
  const m = useM()
  const [editing, setEditing] = useState(false)
  if (editing && !block.streaming) {
    return (
      <div onMouseDownOutside={() => setEditing(false)}>
        <EditableText
          value={block.markdown}
          color={m.textMuted}
          autoFocus
          testId={`para-${block.id}`}
          onCommit={(text) => actions.onEdit(block.id, text)}
          onSend={actions.onSend}
          onDone={() => {
            setEditing(false)
            actions.onReturnFocus()
          }}
        />
      </div>
    )
  }
  return (
    <div testId={`reply-${block.id}`} onClick={() => !block.streaming && setEditing(true)} style={{ cursor: block.streaming ? 'default' : 'text' }}>
      <markdown source={block.markdown || ' '} theme={nativeTheme(m)} style={{ color: m.textMuted }} />
    </div>
  )
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
  onEdit: (blockId: string, text: string) => void
  onSend: () => void
  onLogin: () => void
  onSendOutput: (command: string, output: string) => void
  onReturnFocus: () => void
}

export const BlockView = memo(function BlockView({ block, actions }: { block: Block; actions: BlockActions }) {
  switch (block.kind) {
    case 'user':
      return <UserBlock block={block} actions={actions} />
    case 'assistant':
      return <AssistantBlock block={block} actions={actions} />
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
