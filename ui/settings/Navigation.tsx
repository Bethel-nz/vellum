import { useWindowSize } from '@gpuix/react'
import { Button, Icon, Label, useM } from '../../components'
import { navigation, pageInfo, slug, type SettingsPage } from './catalog'

export function SettingsNavigation({ page, query, shown, onQuery, onOpen, onBack }: { page: SettingsPage; query: string; shown: (page: SettingsPage) => boolean; onQuery: (query: string) => void; onOpen: (page: SettingsPage) => void; onBack: () => void }) {
  const m = useM()
  // Below 900 the navigation yields room to the page being edited.
  const narrow = useWindowSize().width < 900
  const visible = navigation.map((group) => group.filter(shown)).filter((group) => group.length)
  return <div testId="settings-navigation" style={{ display: 'flex', flexDirection: 'column', width: narrow ? 200 : 248, flexShrink: 0, paddingTop: 24, paddingLeft: 10, paddingRight: 10, paddingBottom: 10 }}>
    <Button onPress={onBack} testId="settings-done" title="Back to note (esc)" style={{ justifyContent: 'flex-start', height: 30, paddingLeft: 6, paddingRight: 6 }}><Icon name="chevronLeft" size={15} /><Label muted>Back to note</Label></Button>
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, height: 32, flexShrink: 0, marginTop: 8, paddingLeft: 10, paddingRight: 10, borderWidth: 1, borderColor: m.border, borderRadius: 10, backgroundColor: m.pane }}>
      <Icon name="search" size={14} color={m.textMuted} />
      <input testId="settings-search" aria-label="Search settings" value={query} placeholder="Search settings…" onChange={(event) => onQuery(event.value ?? '')} style={{ flexGrow: 1, minWidth: 0, fontSize: 12.5, color: m.text }} />
      {query ? <Button onPress={() => onQuery('')} testId="settings-search-clear" title="Clear settings search" style={{ width: 18, paddingLeft: 0, paddingRight: 0 }}><Icon name="x" size={11} /></Button> : null}
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14, flexGrow: 1, minHeight: 0, overflowY: 'scroll', pointerEvents: 'auto' }}>
      {visible.map((group) => <div key={group.join()} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{group.map((item) => <Button key={item} onPress={() => onOpen(item)} selected={!query.trim() && page === item} testId={`settings-go-${slug(item)}`} title={item} style={{ justifyContent: 'flex-start', gap: 10, height: 32, paddingLeft: 10, paddingRight: 10, borderRadius: 8 }}><Icon name={pageInfo[item].icon} size={16} color={!query.trim() && page === item ? m.text : m.textMuted} /><Label muted={Boolean(query.trim()) || page !== item}>{item}</Label></Button>)}</div>)}
      {!visible.length ? <text style={{ paddingLeft: 10, fontSize: 12.5, lineHeight: 18, color: m.textMuted }}>No matching settings</text> : null}
    </div>
  </div>
}
