import { Children, createContext, isValidElement, useContext, type ReactNode } from 'react'
import { Button as Base } from '@gpuix/react/button'
import { Button, Icon, Label, useM } from '../../components'
import { dark, light, radiusXl, type MaterialName } from '../theme'

export const SettingsResultLink = createContext<{ page: string; open: () => void } | undefined>(undefined)

export function SettingsSection({ label, hint, children }: { label?: string; hint?: string; children: ReactNode }) {
  const m = useM()
  const link = useContext(SettingsResultLink)
  return <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 26, flexShrink: 0 }}>
    {label || link ? <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 4, paddingRight: 4, paddingBottom: 8 }}>
      {label ? <text style={{ fontSize: 12.5, lineHeight: 18, fontWeight: 500, color: m.textMuted }}>{label}</text> : null}
      {link ? <Button onPress={link.open} title={`Open ${link.page} settings`}><text style={{ fontSize: 12, color: m.blue }}>{link.page}</text><Icon name="chevronRight" size={11} color={m.blue} /></Button> : null}
    </div> : null}
    <div style={{ display: 'flex', flexDirection: 'column', borderRadius: radiusXl, backgroundColor: m.appearance === 'dark' ? m.codeBg : m.panel }}>
      {Children.toArray(children).map((child, index) => <div key={isValidElement(child) ? child.key ?? index : index} style={{ display: 'flex', flexDirection: 'column' }}>
        {index ? <div style={{ height: 1, marginLeft: 18, marginRight: 18, backgroundColor: m.border }} /> : null}
        {isValidElement(child) && child.type === SettingsRow ? child : <div style={{ padding: 18 }}>{child}</div>}
      </div>)}
    </div>
    {hint ? <text style={{ marginTop: 8, marginLeft: 4, marginRight: 4, fontSize: 12, lineHeight: 18, color: m.textMuted }}>{hint}</text> : null}
  </div>
}

export function SettingsRow({ label, detail, children, testId }: { label: string; detail?: string; children?: ReactNode; testId?: string }) {
  const m = useM()
  return <div testId={testId} style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 14, minHeight: 64, paddingTop: 12, paddingBottom: 12, paddingLeft: 18, paddingRight: 18 }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, flexShrink: 1, flexBasis: 200, minWidth: 0 }}>
      <text style={{ fontSize: 13.5, lineHeight: 20, color: m.text }}>{label}</text>
      {detail ? <text style={{ fontSize: 12.5, lineHeight: 18, color: m.textMuted }}>{detail}</text> : null}
    </div>
    {children ? <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>{children}</div> : null}
  </div>
}

export function ThemeCards({ value, onChange }: { value: MaterialName; onChange: (value: MaterialName) => void }) {
  const m = useM()
  return <div testId="set-material" role="radiogroup" aria-label="Theme" style={{ display: 'flex', flexDirection: 'row', gap: 12, marginBottom: 26 }}>
    {[dark, light].map((theme) => <Base key={theme.name} testId={`set-material-${theme.name}`} aria-label={`${theme.name === 'dark' ? 'Dark' : 'Light'} theme`} aria-selected={value === theme.name} onClick={() => onChange(theme.name)} style={{ display: 'flex', flexDirection: 'column', gap: 10, flexGrow: 1, flexBasis: 0, minWidth: 0, padding: 8, paddingBottom: 10, borderRadius: radiusXl, borderWidth: 1.5, borderColor: value === theme.name ? m.blue : m.border, backgroundColor: value === theme.name ? m.hover : '#00000000', cursor: 'pointer', focusVisible: { outlineWidth: 2, outlineColor: m.focusRing, outlineOffset: 2 } }}>
      <div style={{ display: 'flex', flexDirection: 'row', gap: 6, height: 84, width: '100%', padding: 8, borderRadius: 9, backgroundColor: theme.rootTint, pointerEvents: 'none' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, width: '28%', paddingTop: 4, pointerEvents: 'none' }}>{[80, 60, 70].map((width) => <div key={width} style={{ height: 5, width: `${width}%`, borderRadius: 3, backgroundColor: theme.textFaint, pointerEvents: 'none' }} />)}</div>
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, gap: 5, padding: 8, borderRadius: 6, backgroundColor: theme.pane, pointerEvents: 'none' }}>
          <div style={{ height: 5, width: '50%', borderRadius: 3, backgroundColor: theme.text, pointerEvents: 'none' }} />
          <div style={{ height: 5, width: '75%', borderRadius: 3, backgroundColor: theme.textMuted, pointerEvents: 'none' }} />
          <div style={{ height: 5, width: '40%', borderRadius: 3, backgroundColor: theme.accent, pointerEvents: 'none' }} />
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, width: '100%', paddingLeft: 4, paddingRight: 4, pointerEvents: 'none' }}><Label>{theme.name === 'dark' ? 'Dark' : 'Light'}</Label>{value === theme.name ? <Icon name="check" size={13} color={m.blue} /> : null}</div>
    </Base>)}
  </div>
}
