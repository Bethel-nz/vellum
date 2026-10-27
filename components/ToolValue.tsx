// Structured tool values use records and result rows, not an expandable JSON tree.
import { useState } from 'react'
import { record, valueText } from '../core/tool-display'
import { font, nativeTheme } from '../ui/theme'
import { useM } from './theme'
import { Button } from './Button'
import { Icon } from './Icon'

const PAGE = 12
const schemaTitle = (schema: unknown, key: string) => {
  if (!record(schema) || !record(schema.properties)) return key
  const property = schema.properties[key]
  return record(property) && typeof property.title === 'string' ? property.title : key
}

export function ToolValue({ value, schema, depth = 0, testId }: { value: unknown; schema?: unknown; depth?: number; testId?: string }) {
  const m = useM()
  const [shown, setShown] = useState(PAGE)
  if (depth >= 4 && value !== null && typeof value === 'object') return <code code={valueText(value)} language="json" theme={nativeTheme(m)} />
  if (depth > 0 && Array.isArray(value) && value.length <= PAGE && value.every(item => item === null || ['string', 'number', 'boolean'].includes(typeof item))) return <code testId={testId} code={JSON.stringify(value)} language="json" theme={nativeTheme(m)} style={{ minWidth: 0, fontFamily: font.mono }} />
  if (Array.isArray(value)) return <div testId={testId} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    {!value.length ? <text style={{ fontSize: 12, color: m.textMuted }}>No results</text> : value.slice(0, shown).map((item, index) => <div key={index} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {record(item) ? <ToolResultRow value={item} depth={depth} schema={record(schema) ? schema.items : undefined} /> : <ToolValue value={item} depth={depth + 1} />}
    </div>)}
    {value.length > shown ? <Button onPress={() => setShown(count => count + PAGE)} style={{ alignSelf: 'start', paddingLeft: 0 }}><Icon name="chevronDown" size={12} /><text style={{ fontSize: 11.5, color: m.textMuted }}>{`Show ${Math.min(PAGE, value.length - shown)} more results`}</text></Button> : null}
  </div>
  if (record(value)) {
    const entries = Object.entries(value)
    return <div testId={testId} style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      {!entries.length ? <text style={{ fontSize: 12, color: m.textMuted }}>No fields</text> : entries.slice(0, shown).map(([key, item]) => <div key={key} style={{ display: 'flex', flexDirection: 'row', alignItems: 'start', gap: 12 }}>
        <text style={{ width: 88, flexShrink: 0, fontSize: 11.5, lineHeight: 18, color: m.textMuted, fontFamily: font.mono }}>{schemaTitle(schema, key)}</text>
        <div style={{ flexGrow: 1, minWidth: 0 }}>{typeof item === 'string' && ['code', 'script', 'command', 'cmd'].includes(key) ? <code code={item || ' '} language={key === 'command' || key === 'cmd' ? 'bash' : typeof value.language === 'string' ? value.language : 'typescript'} theme={nativeTheme(m)} style={{ minWidth: 0, fontFamily: font.mono }} /> : <ToolValue value={item} depth={depth + 1} schema={record(schema) && record(schema.properties) ? schema.properties[key] : undefined} />}</div>
      </div>)}
      {entries.length > shown ? <Button onPress={() => setShown(count => count + PAGE)} style={{ alignSelf: 'start', paddingLeft: 0 }}><text style={{ fontSize: 11.5, color: m.textMuted }}>{`Show ${Math.min(PAGE, entries.length - shown)} more fields`}</text></Button> : null}
    </div>
  }
  const color = value === undefined ? m.textMuted : value === null ? m.syntax.constant : typeof value === 'number' || typeof value === 'boolean' ? m.syntax.number : m.syntax.string
  return <text testId={testId} style={{ fontSize: 12, lineHeight: 18, color, fontFamily: font.mono }}>{value === undefined ? 'Not provided' : value === null ? 'null' : String(value)}</text>
}

export function ToolResultRow({ value, schema, depth }: { value: Record<string, unknown>; schema?: unknown; depth: number }) {
  const m = useM(), [open, setOpen] = useState(false)
  const titleKey = ['title', 'name', 'label', 'text', 'message', 'path', 'url'].find(key => typeof value[key] === 'string' && value[key])
  if (!titleKey) return <ToolValue value={value} schema={schema} depth={depth + 1} />
  const idKey = ['number', 'ref', 'id', 'key'].find(key => typeof value[key] === 'string' || typeof value[key] === 'number')
  const tagKey = ['labels', 'category', 'status', 'state', 'role', 'type'].find(key => value[key] !== undefined)
  const tag = tagKey ? value[tagKey] : undefined
  const label = Array.isArray(tag) ? tag.flatMap(item => typeof item === 'string' ? [item] : record(item) && typeof item.name === 'string' ? [item.name] : []).join(', ') : typeof tag === 'string' ? tag : ''
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
    <Button onPress={() => setOpen(value => !value)} title={open ? 'Hide result fields' : 'Show result fields'} style={{ height: undefined, minHeight: 24, alignItems: 'start', justifyContent: 'flex-start', paddingLeft: 0, paddingRight: 0, gap: 10 }}>
      {idKey ? <text style={{ maxWidth: 90, flexShrink: 0, fontSize: 11.5, lineHeight: 18, fontFamily: font.mono, color: m.textMuted, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{`${idKey === 'number' ? '#' : ''}${String(value[idKey])}`}</text> : null}
      <text style={{ flexGrow: 1, minWidth: 0, fontSize: 12.5, lineHeight: 18, color: m.textUi }}>{String(value[titleKey])}</text>
      {label ? <text style={{ maxWidth: 130, fontSize: 11.5, lineHeight: 18, color: m.textMuted, lineClamp: 2 }}>{label}</text> : null}
      <Icon name={open ? 'chevronUp' : 'chevronDown'} size={11} color={m.textFaint} />
    </Button>
    {open ? <div style={{ paddingLeft: 12, borderLeftWidth: 1, borderColor: m.border }}><ToolValue value={value} depth={depth + 1} schema={schema} /></div> : null}
  </div>
}
