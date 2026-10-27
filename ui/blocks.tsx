// One component per Block kind. Each renders as a paragraph of the note: no
// bubbles, no avatars, no timestamps. Your text and Claude's replies are both
// editable in place; tool work renders as quiet embeds between them.

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useGpuixRequired, type KeyEvent, type PublicInstance } from '@gpuix/react'
import { forDiff, summarize, type Block, type Tag, type ToolCall } from '../core/threads'
import type { BrowserSession, SavedCapture } from '../core/capture'
import { CaptureCard } from './Capture'
import { BrowserBlock } from './BrowserBlock'
import { getTerm } from '../core/term'
import { FileIcon, Icon, Meta, Quiet, useM } from './kit'
import { ToolCallGroup } from '../components/ToolCall'
import { AgentMark } from '../components/AgentMark'
import { isSubagentCall, SubagentTasks } from '../components/SubagentTasks'
import { Alert } from '../components/Alert'
import { UsageLimitBanner } from '../components/UsageLimitBanner'
import { usageLimitFromText } from '../core/usage'
import { TerminalBlock } from './TerminalBlock'
import { TokenText, type TokenContext } from './Tokens'
import { tokens } from '../core/tags'
import { splitFences } from '../core/fences'
import type { Identity } from '../core/avatar'
import { useLoaded } from './useLoaded'
import { formatTokens } from '../core/models'
import { copyText, primary } from '../core/platform'
import { concentric, diffHeaderClip, diffInk, diffTheme, font, nativeTheme, radiusBase, replyText, replyTheme, type } from './theme'
import { useAgent } from '../components/AgentContext'

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
      {block.images?.length ? <PastedImages images={block.images} onView={actions.onViewImage} /> : null}
    </div>
  )
}

/** Images you pasted with a paragraph, under it like photos clipped to a page. A click opens one full size. */
function PastedImages({ images, onView }: { images: string[]; onView: (images: string[], index: number) => void }) {
  const m = useM()
  // Until the check lands every image counts as there, so a reply doesn't flash "missing".
  const present = useLoaded(() => Promise.all(images.map((src) => Bun.file(src).exists())), [images.join('\n')])
  const there = (i: number) => present?.[i] ?? true
  const shown = images.filter((_, i) => there(i))
  return (
    <div testId="user-images" style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 8 }}>
      {images.map((src, i) =>
        there(i) ? (
          <div
            key={src}
            testId={`user-image-${shown.indexOf(src)}`}
            onClick={() => onView(shown, shown.indexOf(src))}
            style={{ width: 160, height: 120, borderRadius: 10, borderWidth: 1, borderColor: m.border, cursor: 'pointer', hover: { borderColor: m.textFaint } }}
          >
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
      <div onMouseDownOutside={() => setEditing(false)} style={{ position: 'relative' }}>
        <AgentMark />
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
    <div testId={`reply-${block.id}`} onClick={() => !block.streaming && setEditing(true)} style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 12, cursor: block.streaming ? 'default' : 'text' }}>
      <AgentMark />
      {parts.map((p, i) =>
        p.kind === 'code' ? (
          <CodeCard key={i} code={p.code} language={p.language} testId={`code-${block.id}-${i}`} />
        ) : (
          <markdown key={i} source={p.text} theme={replyTheme(m)} style={{ color: replyText(m) }} />
        ),
      )}
    </div>
  )
}

/**
 * A fenced block in a reply: highlighted code in a quiet card with no language header.
 * Copy appears on hover, top right, and turns into a tick for a moment after it copies.
 * The card is a flex column so the code is held to its width and scrolls sideways; otherwise the
 * code grows to its longest line and the card clips it, with nothing left to scroll.
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
      style={{ position: 'relative', display: 'flex', flexDirection: 'column', borderRadius: concentric(radiusBase, 2), borderWidth: 1, borderColor: m.border, backgroundColor: m.codeBg, overflow: 'hidden' }}
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

function shellCall(block: Extract<Block, { kind: 'shell' }>): ToolCall {
  return {
    id: block.termId,
    name: 'Bash',
    detail: block.command,
    ...block.call,
    input: block.call?.input ?? (block.command ? { command: block.command } : undefined),
    output: block.output,
    exitCode: block.exitCode,
    status: block.exitCode === undefined ? 'running' : block.exitCode === 0 ? 'ok' : 'error',
  }
}

/** Keep the original virtual-list slots so timeline links still address the same rows. */
export function toolActivityGroups(blocks: Block[]) {
  const groups = new Map<string, Extract<Block, { kind: 'activity' }> | null>()
  let current: Extract<Block, { kind: 'activity' }> | undefined
  for (const block of blocks) {
    if (block.kind !== 'activity' && !(block.kind === 'shell' && block.source === 'agent')) { current = undefined; continue }
    const items = block.kind === 'activity' ? block.items : [shellCall(block)]
    const thoughts = block.kind === 'activity' ? block.thoughts : 0
    const thinking = block.kind === 'activity' ? block.thinking : undefined
    if (!current) {
      current = { kind: 'activity', id: block.id, items: [...items], thoughts, thinking, summary: '' }
      groups.set(block.id, current)
    } else {
      current.items.push(...items)
      current.thoughts += thoughts
      current.thinking = [current.thinking, thinking].filter(Boolean).join('\n\n') || undefined
      groups.set(block.id, null)
    }
    current.summary = summarize(current.thoughts, current.items)
  }
  return groups
}

function ActivityBlock({ block, onInspect }: { block: Extract<Block, { kind: 'activity' }>; onInspect?: () => void }) {
  const m = useM()
  const captures = block.items.filter((call) => /(?:^|__)vellum_(pending|get_capture|watch|resolve|dismiss|reply)$/.test(call.name))
  if (captures.length) {
    const other = block.items.filter((call) => !captures.includes(call))
    const labels: Record<string, string> = { pending: 'Checking pending captures', get_capture: 'Reading capture', watch: 'Waiting for a capture', resolve: 'Resolved capture', dismiss: 'Dismissed capture', reply: 'Replied to capture' }
    return <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {other.length || block.thoughts ? <ActivityBlock block={{ ...block, items: other, summary: summarize(block.thoughts, other) }} onInspect={onInspect} /> : null}
      {captures.map((call) => <div key={call.id} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Icon name={call.status === 'error' ? 'info' : 'check'} size={12} color={call.status === 'error' ? m.danger : m.textMuted} />
        <text style={{ fontSize: 12, lineHeight: 18, color: call.status === 'error' ? m.danger : m.textMuted }}>{call.status === 'error' ? 'Capture tool failed' : labels[call.name.split('vellum_').at(-1)!] || 'Capture'}</text>
      </div>)}
    </div>
  }
  const agents = block.items.filter(isSubagentCall)
  if (!agents.length) return <ToolCallGroup testId={`tool-group-${block.id}`} summary={block.summary} items={block.items} thinking={block.thinking} onInspect={onInspect} />
  const tools = block.items.filter((call) => !isSubagentCall(call))
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    {tools.length || block.thoughts ? <ToolCallGroup testId={`tool-group-${block.id}`} summary={summarize(block.thoughts, tools)} items={tools} thinking={block.thinking} onInspect={onInspect} /> : null}
    <SubagentTasks items={agents} />
  </div>
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
  return <ToolCallGroup summary="" items={[shellCall(block)]} />
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
      testId={`term-${block.termId}`}
      onReturnFocus={onReturnFocus}
      onSendOutput={(out) => onSendOutput(block.command, out)}
    />
  )
}

function ErrorBlock({ block, onLogin }: { block: Extract<Block, { kind: 'error' }>; onLogin: () => void }) {
  const m = useM()
  const limit = block.usageLimit ?? usageLimitFromText(block.text)
  // Once the limit has reset, the notice is history: the note drops it.
  if (limit) return <UsageLimitBanner limit={limit} hideAfterReset testId={`error-${block.id}`} />
  return <Alert tone="danger" title={block.text} icon={block.login ? 'shieldX' : undefined} singleLine={block.login} testId={`error-${block.id}`} action={block.login ? <Quiet onPress={onLogin} testId={`error-login-${block.id}`}><text style={{ fontSize: 12.5, lineHeight: 16, color: m.text, whiteSpace: 'nowrap' }}>Log in</text></Quiet> : undefined} />
}

export type BlockActions = {
  showThoughts?: boolean
  onInspectTools?: () => void
  onViewCapture: (saved: SavedCapture) => void
  onViewBrowser: (browser: BrowserSession) => void
  /** Workspace and tag scopes for chips and their slices. */
  tokens: TokenContext
  /** Your picture and name, for the margin beside your paragraphs. */
  me: Identity
  onEdit: (blockId: string, text: string) => void
  onSend: () => void
  onLogin: () => void
  onSendOutput: (command: string, output: string) => void
  onReturnFocus: () => void
  /** Opens a pasted image full size, among the paragraph's others (ui/ImageViewer.tsx). */
  onViewImage: (images: string[], index: number) => void
}

export const BlockView = memo(function BlockView({ block, actions }: { block: Block; actions: BlockActions }) {
  switch (block.kind) {
    case 'capture':
      return <CaptureCard saved={block.saved} onOpen={() => actions.onViewCapture(block.saved)} />
    case 'browser':
      return <BrowserBlock browser={block.browser} onOpen={() => actions.onViewBrowser(block.browser)} />
    case 'user':
      return <UserBlock block={block} actions={actions} />
    case 'assistant':
      return <AssistantBlock block={block} actions={actions} />
    case 'activity':
      return !actions.showThoughts && !block.items.length ? null : <ActivityBlock block={actions.showThoughts ? block : { ...block, thoughts: 0, thinking: undefined, summary: summarize(0, block.items) }} onInspect={actions.onInspectTools} />
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
    case 'moved':
      return <MovedLine block={block} />
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
  const agent = useAgent()
  const at = new Date(block.at)
  const time = Number.isNaN(at.getTime()) ? '' : ` · ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  const what = block.trigger === 'auto' ? `Context was full, so ${agent.title} summarized everything above` : `${agent.title} summarized everything above`
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

/** Where the note moved to another account: Claude carries on there in a new session. */
function MovedLine({ block }: { block: Extract<Block, { kind: 'moved' }> }) {
  const m = useM()
  const at = new Date(block.at)
  const time = Number.isNaN(at.getTime()) ? '' : ` · ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  return (
    <div testId={`moved-${block.id}`} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 6, paddingBottom: 6 }}>
      <div style={{ flexGrow: 1, height: 1, backgroundColor: m.border }} />
      <Icon name="user" size={12} color={m.textFaint} />
      <text style={{ ...type.meta, color: m.textMuted, flexShrink: 0 }}>{`Moved from ${block.from} to ${block.to}; the agent there reads the note above${time}`}</text>
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
