// One component per Block kind. Each renders as a paragraph of the note: no
// bubbles, no avatars, no timestamps. Your text and Claude's replies are both
// editable in place; tool work renders as quiet embeds between them.

import { existsSync } from 'node:fs'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useGpuixRequired, type KeyEvent, type PublicInstance } from '@gpuix/react'
import { forDiff, type Block, type Tag, type ToolCall } from '../core/threads'
import { getTerm } from '../core/term'
import { FileIcon, Icon, Meta, Quiet, useM } from './kit'
import { TerminalBlock } from './TerminalBlock'
import { TokenText, type TokenContext } from './Tokens'
import { tokens } from '../core/tags'
import { splitFences } from '../core/fences'
import type { Identity } from '../core/avatar'
import { formatTokens } from '../core/models'
import { copyText, primary } from '../core/platform'
import { concentric, diffHeaderClip, diffInk, diffTheme, font, nativeTheme, radiusBase, type } from './theme'

const COMMIT_MS = 500

/**
 * A paragraph you can edit: a borderless textarea that grows with its text.
 * Changes are committed after a short pause, on ⌘↵, and on unmount.
 */
function EditableText({
  value,
  onCommit,
  onSend,
  onDone,
  color,
  weight,
  autoFocus,
  focusRequest = 0,
  testId,
}: {
  value: string
  onCommit: (text: string) => void
  onSend: () => void
  onDone?: () => void
  color: string
  weight?: number
  autoFocus?: boolean
  /** Bumped to put the caret in it from outside (the timeline). */
  focusRequest?: number
  testId?: string
}) {
  const m = useM()
  const renderer = useGpuixRequired()
  const field = useRef<PublicInstance>(null)
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
  useEffect(() => {
    if (focusRequest && field.current) renderer.focusElement?.(field.current.id)
  }, [focusRequest, renderer])

  const onKeyDown = (e: KeyEvent) => {
    if (e.key === 'enter' && primary(e.modifiers)) {
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
      ref={field}
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

/** Your paragraph. With tokens in it, it reads with chips and turns into its source on click. */
/**
 * Who wrote a paragraph: your picture, 16px, in the left margin of your paragraphs only. Claude's
 * writing stays unmarked: the note is its page, your lines are the annotations with your face on
 * them. Hovering shows "You · 14:03". No picture on the Mac: a violet monogram.
 */
function Author({ me, at, hover }: { me: Identity; at: string; hover: boolean }) {
  const m = useM()
  const d = new Date(at)
  const time = Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const top = (type.user.lineHeight - AVATAR) / 2
  return (
    <>
      <div testId="author" style={{ position: 'absolute', left: -(AVATAR + 10), top, width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, overflow: 'hidden', backgroundColor: m.skillBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {me.src ? (
          // The wrapper's overflow does not clip an image: it takes its own radius.
          <img src={me.src} objectFit="cover" style={{ width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2 }} />
        ) : (
          <text style={{ fontSize: 9.5, lineHeight: 12, fontWeight: 600, color: m.accent }}>{me.initial}</text>
        )}
      </div>
      {hover ? (
        <div style={{ position: 'absolute', right: 0, top: top - 1 }}>
          <Meta>{time ? `You · ${time}` : 'You'}</Meta>
        </div>
      ) : null}
    </>
  )
}

const AVATAR = 16

function UserBlock({ block, actions }: { block: Extract<Block, { kind: 'user' }>; actions: BlockActions }) {
  const [hover, setHover] = useState(false)
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{ position: 'relative' }}>
      <Author me={actions.me} at={block.at} hover={hover} />
      {block.text ? <UserText block={block} actions={actions} /> : null}
      {block.images?.length ? <PastedImages images={block.images} /> : null}
    </div>
  )
}

/** Images you pasted with a paragraph, under it like photos clipped to a page. */
function PastedImages({ images }: { images: string[] }) {
  const m = useM()
  return (
    <div testId="user-images" style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 8 }}>
      {images.map((src) =>
        existsSync(src) ? (
          <div key={src} style={{ width: 160, height: 120, borderRadius: 10, borderWidth: 1, borderColor: m.border }}>
            <img src={src} objectFit="cover" style={{ width: 158, height: 118, borderRadius: 9 }} />
          </div>
        ) : (
          <div key={src} style={{ width: 160, height: 120, borderRadius: 10, borderWidth: 1, borderColor: m.border, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Meta>Image missing</Meta>
          </div>
        ),
      )}
    </div>
  )
}

/** Your paragraphs on screen, by block id, each able to take the caret (see `editParagraph`). */
const editable = new Map<string, () => void>()

/** Puts the caret in one of your paragraphs. False when it isn't mounted (scrolled out of the list). */
export function editParagraph(blockId: string): boolean {
  const focus = editable.get(blockId)
  focus?.()
  return Boolean(focus)
}

function UserText({ block, actions }: { block: Extract<Block, { kind: 'user' }>; actions: BlockActions }) {
  const m = useM()
  const [editing, setEditing] = useState(false)
  const [focusRequest, setFocusRequest] = useState(0)
  useEffect(() => {
    editable.set(block.id, () => {
      setEditing(true)
      setFocusRequest((n) => n + 1)
    })
    return () => void editable.delete(block.id)
  }, [block.id])
  const hasTokens = block.tags.length > 0 && tokens(block.text, block.tags).some((t) => t.kind === 'tag')
  if (hasTokens && !editing) {
    return <TokenText text={block.text} tags={block.tags} ctx={actions.tokens} color={m.text} testId={`read-${block.id}`} onPress={() => setEditing(true)} />
  }
  return (
    <div onMouseDownOutside={hasTokens ? () => setEditing(false) : undefined}>
      <EditableText
        value={block.text}
        color={m.text}
        weight={500}
        autoFocus={editing}
        focusRequest={focusRequest}
        testId={`para-${block.id}`}
        onCommit={(text) => actions.onEdit(block.id, text)}
        onSend={actions.onSend}
        onDone={hasTokens ? () => setEditing(false) : undefined}
      />
    </div>
  )
}

/** Claude's reply: rendered markdown, which turns into its source while you edit it. */
function AssistantBlock({ block, actions }: { block: Extract<Block, { kind: 'assistant' }>; actions: BlockActions }) {
  const m = useM()
  const [editing, setEditing] = useState(false)
  const parts = useMemo(() => splitFences(block.markdown || ' '), [block.markdown])
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
    <div testId={`reply-${block.id}`} onClick={() => !block.streaming && setEditing(true)} style={{ display: 'flex', flexDirection: 'column', gap: 12, cursor: block.streaming ? 'default' : 'text' }}>
      {parts.map((p, i) =>
        p.kind === 'code' ? (
          <CodeCard key={i} code={p.code} language={p.language} testId={`code-${block.id}-${i}`} />
        ) : (
          <markdown key={i} source={p.text} theme={nativeTheme(m)} style={{ color: m.textUi }} />
        ),
      )}
    </div>
  )
}

/**
 * A fenced block in a reply: highlighted code in a quiet card with no language header.
 * Copy appears on hover, top right, and turns into a tick for a moment after it copies.
 */
function CodeCard({ code, language, testId }: { code: string; language: string; testId?: string }) {
  const m = useM()
  const [hover, setHover] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1200)
    return () => clearTimeout(t)
  }, [copied])
  const copy = () => {
    if (copyText(code)) setCopied(true)
  }
  return (
    <div
      testId={testId}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ position: 'relative', borderRadius: concentric(radiusBase, 2), borderWidth: 1, borderColor: m.border, backgroundColor: m.codeBg, overflow: 'hidden' }}
    >
      <code code={code || ' '} language={language || undefined} theme={nativeTheme(m)} style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 11, paddingBottom: 11, minWidth: 0, color: m.text }} />
      {hover || copied ? (
        <div style={{ position: 'absolute', top: 5, right: 5 }}>
          <Quiet onPress={copy} testId={testId ? `${testId}-copy` : undefined} title="Copy">
            <Icon name={copied ? 'check' : 'copy'} size={13} color={copied ? m.success : m.textMuted} />
          </Quiet>
        </div>
      ) : null}
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
      <Quiet onPress={() => setOpen((v) => !v)} style={{ alignSelf: 'start', marginLeft: -8 }} title={open ? 'Hide tool activity' : 'Show tool activity'}>
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

/**
 * A frameless diff. The row above it names the file and counts, so the native file and
 * first hunk header rows are clipped off (at height 0 their text would still paint).
 */
export function DiffCard({ patch, maxLines, onShowMore }: { patch: string; maxLines?: number; onShowMore?: () => void }) {
  const m = useM()
  return (
    <div style={{ paddingTop: 6, overflow: 'hidden' }}>
      {/* The clip box starts below the padding, so nothing of the headers shows through it. */}
      <div style={{ overflow: 'hidden' }}>
        <diff patch={forDiff(patch)} wordDiff maxLines={maxLines} onShowMore={onShowMore} theme={diffTheme(m)} style={{ marginTop: -diffHeaderClip }} />
      </div>
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
        <FileIcon path={block.path} size={12} />
        <text style={{ fontSize: 12.5, lineHeight: 18, color: m.text, fontFamily: font.mono }}>{block.path}</text>
        <text style={{ ...type.meta, color: diffInk(m).add, fontFamily: font.mono }}>{`+${block.added}`}</text>
        <text style={{ ...type.meta, color: diffInk(m).del, fontFamily: font.mono }}>{`−${block.removed}`}</text>
        {block.status === 'error' ? <Meta color={m.danger}>failed</Meta> : null}
      </div>
      {block.error ? <text style={{ ...type.meta, color: m.danger, lineClamp: 3 }}>{block.error}</text> : null}
      <DiffCard patch={block.patch} maxLines={open ? undefined : 12} onShowMore={() => setOpen(true)} />
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
  /** Workspace and tag scopes for chips and their slices. */
  tokens: TokenContext
  /** Your picture and name, for the margin beside your paragraphs. */
  me: Identity
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
    case 'approval':
      return <ApprovalLine block={block} />
    case 'compact':
      return <CompactLine block={block} />
    case 'git':
      return block.also.length ? <AlsoChanged block={block} /> : null
  }
})

/** Files the turn changed on disk that no edit of it shows (a shell command's work): one quiet line. */
function AlsoChanged({ block }: { block: Extract<Block, { kind: 'git' }> }) {
  const m = useM()
  const files = block.files.filter((f) => block.also.includes(f.path))
  const added = files.reduce((n, f) => n + f.added, 0)
  const removed = files.reduce((n, f) => n + f.removed, 0)
  return (
    <div testId="also-changed" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <Icon name="diff" size={12} color={m.textFaint} />
      <text style={{ ...type.meta, color: m.textMuted, flexShrink: 0 }}>Also changed</text>
      <text style={{ ...type.meta, color: m.text, fontFamily: font.mono, whiteSpace: 'nowrap', textOverflow: 'ellipsis', minWidth: 0, flexShrink: 1 }}>{block.also.join(', ')}</text>
      <text style={{ ...type.meta, color: diffInk(m).add, fontFamily: font.mono, flexShrink: 0 }}>{`+${added}`}</text>
      <text style={{ ...type.meta, color: diffInk(m).del, fontFamily: font.mono, flexShrink: 0 }}>{`−${removed}`}</text>
    </div>
  )
}

/** Where the CLI summarized everything above: a hairline across the page, like a fold. */
function CompactLine({ block }: { block: Extract<Block, { kind: 'compact' }> }) {
  const m = useM()
  const at = new Date(block.at)
  const time = Number.isNaN(at.getTime()) ? '' : ` · ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  const what = block.trigger === 'auto' ? 'Context was full, so Claude summarized everything above' : 'Claude summarized everything above'
  const from = block.preTokens ? ` · ${formatTokens(block.preTokens)} tokens before` : ''
  return (
    <div testId={`compact-${block.id}`} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 6, paddingBottom: 6 }}>
      <div style={{ flexGrow: 1, height: 1, backgroundColor: m.border }} />
      <Icon name="fold" size={12} color={m.textFaint} />
      <text style={{ ...type.meta, color: m.textMuted, flexShrink: 0 }}>{`${what}${from}${time}`}</text>
      <div style={{ flexGrow: 1, height: 1, backgroundColor: m.border }} />
    </div>
  )
}

/** An answered ask, kept in the note as one quiet line: what was asked, what you said, and when. */
function ApprovalLine({ block }: { block: Extract<Block, { kind: 'approval' }> }) {
  const m = useM()
  const denied = block.decision === 'denied'
  const verb = denied ? 'Denied' : block.decision === 'always' ? 'Always allowed' : 'Allowed'
  const at = new Date(block.at)
  const time = Number.isNaN(at.getTime()) ? '' : `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <Icon name={denied ? 'x' : 'check'} size={12} color={denied ? m.danger : m.textFaint} />
        <text style={{ ...type.meta, color: m.textMuted, flexShrink: 0 }}>{`${verb} · ${block.title}`}</text>
        {block.tool === 'Bash' && block.detail ? (
          <text style={{ ...type.meta, color: m.textFaint, fontFamily: font.mono, whiteSpace: 'nowrap', textOverflow: 'ellipsis', minWidth: 0, flexShrink: 1 }}>{block.detail}</text>
        ) : null}
        <div style={{ flexGrow: 1 }} />
        <Meta>{time}</Meta>
      </div>
      {block.message ? <text style={{ ...type.meta, color: m.textMuted, paddingLeft: 20, lineClamp: 3 }}>{`“${block.message}”`}</text> : null}
    </div>
  )
}
