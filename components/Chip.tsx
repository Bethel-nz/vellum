// Inline context references. A tag in your text (`@skill`, `@folder`, `#file`, `#file:42`) reads
// as a link in a document, not a form chip (UI-FIXES §7): its file-type glyph, then the path on a
// 1px dotted blue rule, with `:42` in muted. Skills are violet text on a violet rule.

import { useState, type ReactNode } from 'react'
import { diffInk, font, radiusBase } from '../ui/theme'
import { FileIcon } from './FileIcon'
import { Icon } from './Icon'
import { useM } from './theme'

export type ChipKind = 'file' | 'line' | 'folder' | 'skill'

export function Chip({
  kind,
  children,
  onHover,
  onPress,
  testId,
  path,
}: {
  kind: ChipKind
  children: ReactNode
  /** For file chips: picks the file-type glyph. */
  path?: string
  onHover?: (inside: boolean) => void
  onPress?: () => void
  testId?: string
}) {
  const m = useM()
  const [ruleWidth, setRuleWidth] = useState(0)
  const skill = kind === 'skill'
  const label = String(children)
  // `:42` and `:12-18` read as a suffix of the path, not part of it.
  const line = kind === 'line' ? /:(\d+(?:-\d+)?)$/.exec(label) : null
  const base = line ? label.slice(0, line.index) : label
  const ink = skill ? m.accent : m.text
  const rule = skill ? m.accent + '66' : m.blue + 'aa'
  return (
    <div
      testId={testId}
      onMouseEnter={onHover ? () => onHover(true) : undefined}
      onMouseLeave={onHover ? () => onHover(false) : undefined}
      onClick={onPress}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        height: 20,
        flexShrink: 0,
        cursor: onPress || onHover ? 'pointer' : 'default',
      }}
    >
      {path && (kind === 'file' || kind === 'line') ? (
        <FileIcon path={path} size={11} />
      ) : <Icon name={skill ? 'zap' : 'folder'} size={11} color={skill ? m.accent : m.textMuted} />}
      {/* Native borders don't draw dots. Measured dots keep the reference's rule exact. */}
      <div onLayout={(event) => setRuleWidth(event.width ?? 0)} style={{ position: 'relative', display: 'flex', flexDirection: 'row', paddingBottom: 2 }}>
        <text style={{ fontSize: 12.5, lineHeight: 16, color: ink, fontFamily: skill ? font.sans : font.mono, whiteSpace: 'nowrap' }}>{base}</text>
        {line ? <text style={{ fontSize: 12.5, lineHeight: 16, color: m.textMuted, fontFamily: font.mono, whiteSpace: 'nowrap' }}>{`:${line[1]}`}</text> : null}
        <div aria-hidden style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 1, display: 'flex', flexDirection: 'row', gap: 3, overflow: 'hidden', pointerEvents: 'none' }}>
          {Array.from({ length: Math.ceil(ruleWidth / 4) }, (_, index) => <div key={index} style={{ width: 1, height: 1, flexShrink: 0, borderRadius: 0.5, backgroundColor: rule }} />)}
        </div>
      </div>
    </div>
  )
}

/**
 * A hunk from the Changes sheet, in your writing: a small ± pill, not a wall of diff. File glyph,
 * name, +n −m in the diff colours, and how many lines you commented on. Hover shows the hunk.
 */
/** A hunk in the draft; with `line`, only comments on that file from that line, so no counts. */
export function HunkPill({ path, added, removed, notes = 0, line, onHover, testId }: { path: string; added: number; removed: number; notes?: number; line?: number; onHover?: (inside: boolean) => void; testId?: string }) {
  const m = useM()
  const ink = diffInk(m)
  const name = path.split('/').pop() ?? path
  return (
    <div
      testId={testId}
      onMouseEnter={onHover ? () => onHover(true) : undefined}
      onMouseLeave={onHover ? () => onHover(false) : undefined}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        height: 20,
        paddingLeft: 6,
        paddingRight: 7,
        borderRadius: radiusBase,
        borderWidth: 1,
        borderColor: m.border,
        backgroundColor: m.codeBg,
        flexShrink: 0,
        cursor: onHover ? 'pointer' : 'default',
        hover: onHover ? { borderColor: m.borderFocused } : undefined,
      }}
    >
      <text style={{ fontSize: 12, lineHeight: 16, color: m.textMuted, fontFamily: font.mono }}>±</text>
      <FileIcon path={path} size={11} />
      <text style={{ fontSize: 12, lineHeight: 16, color: m.text, fontFamily: font.mono, whiteSpace: 'nowrap' }}>{line ? `${name}:${line}` : name}</text>
      {line ? null : <text style={{ fontSize: 11.5, lineHeight: 16, color: ink.add, fontFamily: font.mono }}>{`+${added}`}</text>}
      {line ? null : <text style={{ fontSize: 11.5, lineHeight: 16, color: ink.del, fontFamily: font.mono }}>{`−${removed}`}</text>}
      {notes ? (
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 2 }}>
          <Icon name="comment" size={11} color={m.blue} />
          <text style={{ fontSize: 11.5, lineHeight: 16, color: m.blue, fontFamily: font.mono }}>{String(notes)}</text>
        </div>
      ) : null}
    </div>
  )
}
