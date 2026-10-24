// One changes affordance: the measured strip budget chooses text OR the git glyph.
import { useState } from 'react'
import { Button } from './Button'
import { Icon } from './Icon'
import { useM } from './theme'
import { diffInk, font } from '../ui/theme'

export type ChangeSummary = { files: number; added: number; removed: number }

export function ChangeTotals({ added, removed }: Pick<ChangeSummary, 'added' | 'removed'>) {
  const m = useM()
  const ink = diffInk(m)
  return <>
    <text style={{ fontSize: 11.5, lineHeight: 16, fontFamily: font.mono, color: ink.add, whiteSpace: 'nowrap', flexShrink: 0 }}>{`+${added.toLocaleString('en-US')}`}</text>
    <text style={{ fontSize: 11.5, lineHeight: 16, fontFamily: font.mono, color: ink.del, whiteSpace: 'nowrap', flexShrink: 0 }}>{`-${removed.toLocaleString('en-US')}`}</text>
  </>
}

export function ChangesSummary({ summary, availableWidth, onPress }: { summary: ChangeSummary; availableWidth: number; onPress: () => void }) {
  const m = useM()
  const label = `${summary.files} ${summary.files === 1 ? 'file' : 'files'} changed`
  const estimate = (label.length + String(summary.added).length + String(summary.removed).length + 2) * 7 + 36
  const [measured, setMeasured] = useState(0)
  const expanded = availableWidth >= Math.max(estimate, measured)
  return <Button testId="open-changes" title={`${label} · +${summary.added} -${summary.removed} (⇧⌘D)`} onPress={onPress} style={{ height: 26, minHeight: 26, borderRadius: 13, paddingLeft: expanded ? 10 : 6, paddingRight: expanded ? 10 : 6, backgroundColor: m.chipBg, borderWidth: 1, borderColor: m.border }}>
    {expanded ? <div testId="changes-summary-text" onLayout={(event) => { const width = Math.ceil(event.width ?? 0) + 22; setMeasured((previous) => previous === width ? previous : width) }} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <text style={{ fontSize: 11.5, lineHeight: 16, fontFamily: font.mono, color: m.textMuted, whiteSpace: 'nowrap', flexShrink: 0 }}>{label}</text>
      <ChangeTotals added={summary.added} removed={summary.removed} />
    </div> : <div testId="changes-summary-icon"><Icon name="diff" size={14} /></div>}
  </Button>
}
