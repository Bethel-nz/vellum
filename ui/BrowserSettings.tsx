import { useEffect, useState } from 'react'
import { Button, Field, Label, useM } from '../components'
import { SettingsRow as SheetRow, SettingsSection as SheetSection } from './settings/controls'
import { bridgePairing, onBridgeEvent } from '../core/bridge'
import { browserSession, moveBrowserTarget } from '../core/browser-runtime'
import { browserTargetOwner, listToolbarTargets, subscribeToolbarTargets } from '../core/browser-targets'
import type { ToolbarTarget } from '../core/browser-types'
import { readSettings, updateSettings } from '../core/store'

export function BrowserSettings({ noteId }: { noteId?: string }) {
  const m = useM()
  const [pairing, setPairing] = useState(bridgePairing)
  const [savedPort, setSavedPort] = useState(() => readSettings().browserPort)
  const [port, setPort] = useState(() => String(savedPort ?? ''))
  const [error, setError] = useState('')
  const [targets, setTargets] = useState<ToolbarTarget[]>(listToolbarTargets)
  const [connecting, setConnecting] = useState(false)
  const [cdpPorts, setCdpPorts] = useState(() => (readSettings().browserCdpPorts ?? []).join(', '))
  const connectTarget = async (targetKey?: string, move = false) => {
    if (!noteId) return
    setConnecting(true); setError('')
    try { if (move && targetKey) await moveBrowserTarget(noteId, targetKey); else await browserSession(noteId, { action: 'connect', mode: targetKey ? 'toolbar' : 'managed', targetKey }) } catch (e) { setError(String((e as Error).message)) } finally { setConnecting(false) }
  }
  useEffect(() => { const update = () => setTargets(listToolbarTargets()); const off = subscribeToolbarTargets(update); const timer = setInterval(update, 5000); return () => { off(); clearInterval(timer) } }, [])
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
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
    <SheetSection label="Agent browser">
      <SheetRow label="Managed browser" detail="A separate browser for this note, shown in Agent Screen."><Button disabled={!noteId || connecting} onPress={() => void connectTarget()}><Label>{connecting ? 'Connecting…' : 'Connect'}</Label></Button></SheetRow>
      <SheetRow label="Chrome debugging ports" detail="Explicit local CDP ports, separated by commas. Snapshot presence alone does not enable browser control.">
        <Field value={cdpPorts} onChange={setCdpPorts} placeholder="9222" onSubmit={() => { const ports = cdpPorts.split(',').map(value => value.trim()).filter(Boolean).map(Number); if (ports.some(port => !Number.isInteger(port) || port < 1 || port > 65535)) { setError('Use local ports from 1 to 65535'); return } updateSettings({ browserCdpPorts: ports }); setError('') }} />
      </SheetRow>
      <text style={{ fontSize: 12, color: m.textMuted }}>Open Snapshot on a page to choose that exact Chrome tab. Attached tabs share Chrome’s cookies. If Chrome has no debugging endpoint, use a managed browser.</text>
      {targets.map(target => { const owner = browserTargetOwner(target.key); return <SheetRow key={target.key} label={target.title || 'Chrome tab'} detail={`${target.url} · Window ${target.windowId} · Tab ${target.tabId}`}><Button disabled={!noteId || connecting || !target.targetId} onPress={() => void connectTarget(target.key, Boolean(owner && owner !== noteId))}><Label>{owner && owner !== noteId ? 'Move here' : 'Use this tab'}</Label></Button></SheetRow> })}
    </SheetSection>
    </div>
  )
}
