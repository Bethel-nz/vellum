import { useEffect, useState } from 'react'
import { Button, Field, Label, useM } from '../components'
import { SettingsRow as SheetRow, SettingsSection as SheetSection } from './settings/controls'
import { bridgePairing, onBridgeEvent } from '../core/bridge'
import { readSettings, updateSettings } from '../core/store'

export function BrowserSettings() {
  const m = useM()
  const [pairing, setPairing] = useState(bridgePairing)
  const [savedPort, setSavedPort] = useState(() => readSettings().browserPort)
  const [port, setPort] = useState(() => String(savedPort ?? ''))
  const [error, setError] = useState('')
  const dirty = port.trim() !== String(savedPort ?? '')
  const save = () => {
    const value = port.trim()
    const next = value ? Number(value) : undefined
    if (next !== undefined && (!/^\d{1,5}$/.test(value) || !Number.isInteger(next) || next < 1 || next > 65535)) { setError('Use a port from 1 to 65535, or leave it blank for Automatic.'); return }
    try { updateSettings({ browserPort: next }); setSavedPort(next); setPort(String(next ?? '')); setError('') }
    catch { setError('Could not save the port. Try again.') }
  }
  useEffect(() => onBridgeEvent(() => setPairing(bridgePairing())), [])
  return (
    <SheetSection label="Connection">
      <SheetRow testId="browser-connection" label="Capture extension" detail={pairing ? `Listening on ${new URL(pairing.endpoint).host}.` : 'The local bridge could not start. Choose another port and restart Vellum.'} />
      <SheetRow label="Connection port" detail="Leave blank for Automatic. Use the same custom port in Vellum Snapshot.">
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, width: 190, flexShrink: 0 }}>
          <Field value={port} onChange={(value) => { setPort(value); setError('') }} onSubmit={save} placeholder="Automatic" mono testId="browser-port" />
          <Button onPress={save} disabled={!dirty} testId="browser-port-save"><Label>Save</Label></Button>
        </div>
      </SheetRow>
      <text testId="browser-port-restart" style={{ fontSize: 12, lineHeight: 18, color: m.textMuted }}>Port changes apply after restarting Vellum.</text>
      {error ? <text testId="browser-port-error" style={{ fontSize: 12, lineHeight: 18, color: m.danger }}>{error}</text> : null}
    </SheetSection>
  )
}
