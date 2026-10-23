// Inline context tokens. A tag in your text (`@skill`, `@folder`, `#file`, `#file:42`) renders as
// a chip: radius 5, chip wash, hairline, mono 11.5. Skills are violet (Claude's `skill` colour);
// a line-scoped file chip carries a violet left edge; files lead with their file-type glyph.

import type { ReactNode } from 'react'
import { font } from '../ui/theme'
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
        paddingLeft: kind === 'line' ? 6 : 5,
        paddingRight: 6,
        borderRadius: 5,
        backgroundColor: skill ? m.skillBg : m.chipBg,
        borderWidth: 1,
        borderColor: m.border,
        position: 'relative',
        overflow: 'hidden',
        flexShrink: 0,
        cursor: onPress || onHover ? 'pointer' : 'default',
        hover: onHover ? { borderColor: m.borderFocused } : undefined,
      }}
    >
      {/* GPUIX borders take one colour for all sides, so the violet edge is its own bar. */}
      {kind === 'line' ? <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 2, backgroundColor: m.accent }} /> : null}
      {path && (kind === 'file' || kind === 'line') ? (
        <FileIcon path={path} size={11} />
      ) : (
        <Icon name={skill ? 'sparkle' : kind === 'folder' ? 'folder' : 'file'} size={11} color={skill ? m.accent : m.textMuted} />
      )}
      <text style={{ fontSize: 11.5, lineHeight: 15, color: skill ? m.accent : m.textUi, fontFamily: skill ? font.sans : font.mono, whiteSpace: 'nowrap' }}>{children}</text>
    </div>
  )
}
