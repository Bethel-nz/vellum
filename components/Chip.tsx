// Inline context references. A tag in your text (`@skill`, `@folder`, `#file`, `#file:42`) reads
// as a link in a document, not a form chip (UI-FIXES §7): its file-type glyph, then the path on a
// 1px dashed blue rule, with `:42` in muted. Skills are violet text on a violet rule.

import type { ReactNode } from 'react'
import { diffInk, font } from '../ui/theme'
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
  const skill = kind === 'skill'
  const label = String(children)
  // `:42` reads as a suffix of the path, not part of it.
  const line = kind === 'line' ? /:(\d+)$/.exec(label) : null
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
      ) : skill ? null : <Icon name="folder" size={11} color={m.textMuted} />}
      {/* A reference, not a form field: text on a 1px rule. GPUIX has no dotted border; dashed is closest. */}
      <div style={{ display: 'flex', flexDirection: 'row', borderBottomWidth: 1, borderStyle: 'dashed', borderColor: rule, paddingBottom: 1, hover: onHover ? { borderColor: skill ? m.accent : m.blue } : undefined }}>
        <text style={{ fontSize: 12.5, lineHeight: 16, color: ink, fontFamily: skill ? font.sans : font.mono, whiteSpace: 'nowrap' }}>{base}</text>
        {line ? <text style={{ fontSize: 12.5, lineHeight: 16, color: m.textMuted, fontFamily: font.mono, whiteSpace: 'nowrap' }}>{`:${line[1]}`}</text> : null}
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
        borderRadius: 10,
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
