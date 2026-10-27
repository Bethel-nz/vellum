import { useEffect, useMemo, useRef, useState } from 'react'
import { useGpuixRequired, type PublicInstance } from '@gpuix/react'
import { record, valueText } from '../core/tool-display'
import { font, nativeTheme } from '../ui/theme'
import { ToolValue, ToolResultRow } from './ToolValue'
import { useM } from './theme'

const EMPTY_ATTACHMENTS: string[] = []

type Row = { kind: 'value'; value: unknown; schema?: unknown; result?: boolean } | { kind: 'text'; text: string; language?: string; path?: string } | { kind: 'label'; text: string }
const textRows = (text: string, language?: string, path?: string): Row[] => {
  const lines = text.split('\n'), rows: Row[] = []
  for (let i = 0; i < lines.length; i += 20) rows.push({ kind: 'text', text: lines.slice(i, i + 20).join('\n'), language, path })
  return rows
}

// GPUIX's virtual-list stops reporting visible ranges after a jump beyond its mounted
// children. Follow the ordinary scroll host's offset with measured spacer windows instead.
/** A bounded virtual list for records, plain text and raw output. */
export function ToolOutput({ value, raw, schema, title, extra, attachments = EMPTY_ATTACHMENTS, path, testId }: { value: unknown; raw?: boolean; schema?: unknown; title?: string; extra?: string; attachments?: string[]; path?: string; testId: string }) {
  const m = useM()
  const rows = useMemo(() => {
    const out: Row[] = title ? [{ kind: 'label', text: title }] : []
    if (raw || typeof value === 'string') out.push(...textRows(typeof value === 'string' ? value : valueText(value), raw ? 'json' : undefined, path))
    else if (Array.isArray(value)) out.push(...value.map(item => ({ kind: 'value' as const, value: item, result: record(item), schema: record(schema) ? schema.items : undefined })))
    else if (record(value)) for (const [key, item] of Object.entries(value)) {
      const fieldSchema = record(schema) && record(schema.properties) ? schema.properties[key] : undefined
      if (Array.isArray(item) && (item.length > 12 || item.some(value => record(value) || Array.isArray(value)))) {
        out.push({ kind: 'label', text: key })
        out.push(...item.map(value => ({ kind: 'value' as const, value, result: record(value), schema: record(fieldSchema) ? fieldSchema.items : undefined })))
        if (!item.length) out.push({ kind: 'label', text: 'No results' })
      } else if (typeof item === 'string' && item.includes('\n')) {
        out.push({ kind: 'label', text: key }, ...textRows(item))
      } else out.push({ kind: 'value', value: { [key]: item }, schema })
    }
    else if (value !== undefined) out.push({ kind: 'value', value })
    if (extra) out.push(...textRows(extra))
    out.push(...attachments.map(text => ({ kind: 'label' as const, text })))
    if (!out.length) out.push({ kind: 'label', text: Array.isArray(value) ? 'No results' : 'No output recorded' })
    return out
  }, [value, raw, schema, title, extra, attachments, path])
  const renderer = useGpuixRequired(), scroller = useRef<PublicInstance>(null)
  const [wanted, setWanted] = useState(0), [revision, setRevision] = useState(0)
  const sizes = useMemo(() => new Map<number, number>(), [value, raw])
  const offsets = useMemo(() => {
    const out = [0]
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!
      const estimate = row.kind === 'text' ? row.text.split('\n').length * 18 + 12 : row.kind === 'value' && row.result ? 36 : 30
      out.push(out[i]! + (sizes.get(i) ?? estimate))
    }
    return out
  }, [rows, sizes, revision])
  const span = 16, start = Math.max(0, Math.min(wanted, rows.length - span)), end = Math.min(rows.length, start + span)
  useEffect(() => { setWanted(0); if (scroller.current) renderer.scrollTo?.(scroller.current.id, 0, 0) }, [value, raw, renderer])
  return <div ref={scroller} testId={testId} role="list" onScrollChange={event => {
    const offset = Math.max(0, -(event.scrollY ?? 0))
    let low = 0, high = rows.length
    while (low < high) { const mid = Math.floor((low + high) / 2); if (offsets[mid + 1]! <= offset) low = mid + 1; else high = mid }
    setWanted(Math.max(0, low - 4))
  }} style={{ width: '100%', height: Math.min(260, Math.max(36, offsets.at(-1) ?? 36)), minHeight: 0, flexShrink: 0, overflowY: 'scroll', pointerEvents: 'auto', scrollbarColor: m.scrollbar, scrollbarWidth: 6 }}>
    <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
    <div style={{ height: offsets[start] ?? 0, flexShrink: 0 }} />
    {rows.slice(start, end).map((row, offset) => <div key={start + offset} onLayout={event => { if (event.height && Math.abs((sizes.get(start + offset) ?? 0) - event.height) > 0.5) { sizes.set(start + offset, event.height); setRevision(value => value + 1) } }} testId={`${testId}-row-${start + offset}`} role="listitem" style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, paddingLeft: 12, paddingRight: 14, paddingTop: 6, paddingBottom: 6 }}>
      {row.kind === 'text' ? <code code={row.text || ' '} language={row.language} path={row.path} theme={nativeTheme(m)} style={{ minWidth: 0, color: m.textUi, fontFamily: font.mono }} /> : row.kind === 'label' ? <text style={{ fontSize: 12, lineHeight: 18, color: m.textMuted }}>{row.text}</text> : row.result && record(row.value) ? <ToolResultRow value={row.value} schema={row.schema} depth={0} /> : <ToolValue value={row.value} schema={row.schema} />}
    </div>)}
    <div style={{ height: (offsets.at(-1) ?? 0) - (offsets[end] ?? 0), flexShrink: 0 }} />
    </div>
  </div>
}
