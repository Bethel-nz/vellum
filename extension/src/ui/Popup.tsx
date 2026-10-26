import { useEffect, useState } from 'react'
import { IconTarget2 } from '@central-icons-react/round-outlined-radius-2-stroke-2/IconTarget2'
import { IconSquareArrowTopRight } from '@central-icons-react/round-outlined-radius-2-stroke-2/IconSquareArrowTopRight'
import { IconArrowRotateClockwise } from '@central-icons-react/round-outlined-radius-2-stroke-2/IconArrowRotateClockwise'
import { Button } from '../arc/button/button'
import SegmentedControl from '../arc/segmented-control/segmented-control'
import { worker, type CaptureSettings, type Note } from '../messages'
import { setAppearance, type Appearance } from './appearance'
import { Panel } from './Panel'

type NotesState = { status: 'loading' | 'ready' | 'offline'; notes: Note[]; error?: string }
export function Popup() {
  const [state, setState] = useState<NotesState>({ status: 'loading', notes: [] })
  const [settings, setSettings] = useState<CaptureSettings>({ target: 'active', mode: 'send', url: 'http://127.0.0.1', port: 47470 })
  const [error, setError] = useState('')
  const [selecting, setSelecting] = useState(false)
  useEffect(() => {
    let current = true
    let busy = false
    const refresh = async () => {
      if (busy) return
      busy = true
      try {
        const [saved, response, appearance] = await Promise.all([
          worker<CaptureSettings>({ type: 'settings' }), worker<Note[] | { notes: Note[] }>({ type: 'notes' }), worker<{ material: Appearance }>({ type: 'appearance' }),
        ])
        if (!current) return
        const notes = Array.isArray(response) ? response : response.notes
        const target = saved.target === 'active' || notes.some((note) => note.id === saved.target) ? saved.target : 'active'
        setSettings({ ...saved, target })
        setState({ status: 'ready', notes })
        setAppearance(document.documentElement, appearance.material || 'dark')
      } catch (failure) {
        if (current) setState({ status: 'offline', notes: [], error: (failure as Error).message })
      } finally { busy = false }
    }
    void refresh()
    const retry = setInterval(refresh, 3000)
    return () => { current = false; clearInterval(retry) }
  }, [])
  const save = async (next: CaptureSettings) => {
    setSettings(next)
    try { await worker({ type: 'target', ...next }); setError('') } catch (failure) { setError(`${(failure as Error).message} Try choosing the note again.`) }
  }
  const select = async () => {
    setSelecting(true)
    setError('')
    try { await worker({ type: 'target', ...settings }); await worker({ type: 'toggle' }); window.close() }
    catch (failure) { setError((failure as Error).message) }
    finally { setSelecting(false) }
  }
  const ready = state.status === 'ready'
  const selectedNote = state.notes.find((note) => settings.target === 'active' ? note.active : note.id === settings.target)
  return <Panel title="Vellum Snapshot" popup>
    <div className="vellum-popup-content">
      <p id="connection" className={`vellum-connection${ready ? ' connected' : ''}`} role="status"><span className="vellum-connection-dot" aria-hidden="true" />{ready ? 'Connected to Vellum' : state.status === 'loading' ? 'Looking for Vellum…' : 'Vellum is unavailable'}</p>
      {ready ? state.notes.length ? <section id="capture-section" aria-label="Send a capture">
        <div className="vellum-field"><label htmlFor="note">Note</label><select id="note" name="note" value={settings.target} onChange={(event) => void save({ ...settings, target: event.target.value })}>
          <option value="active">Active note</option>{state.notes.map((note) => <option key={note.id} value={note.id}>{note.title || 'Untitled note'}</option>)}
        </select>{selectedNote ? <p className="vellum-meta">{selectedNote.title || 'Untitled note'}</p> : null}</div>
        <div className="vellum-delivery"><span className="vellum-label" id="delivery-label">Delivery</span><SegmentedControl label="Capture delivery" className="vellum-segments" options={[{ value: 'send', label: 'Send to agent' }, { value: 'queue', label: 'Save annotation' }]} value={settings.mode} onValueChange={(mode) => void save({ ...settings, mode: mode === 'queue' ? 'queue' : 'send' })} /><p className="vellum-meta">{settings.mode === 'queue' ? 'Keep the annotation for your next turn.' : 'Send when the agent is ready.'}</p></div>
        <Button id="select" className="vellum-select-button" size="md" loading={selecting} onClick={select}><IconTarget2 size={15} aria-hidden="true" />Select elements</Button>
        <p className="vellum-popup-help">Select an element, add an instruction, and send.</p>
      </section> : <div className="vellum-empty"><IconSquareArrowTopRight size={19} aria-hidden="true" /><h2>Open a note in Vellum</h2><p>Your open notes will appear here.</p></div> : <div className="vellum-empty"><IconArrowRotateClockwise size={19} aria-hidden="true" /><h2>{state.status === 'loading' ? 'Connecting to the desktop app' : 'Open Vellum to capture'}</h2><p>{state.status === 'loading' ? 'Your open notes will appear here.' : 'The extension connects automatically.'}</p></div>}
      <p className="vellum-error" role="alert">{error}</p>
    </div>
    <footer className="vellum-popup-footer"><span>Select on this page</span><kbd>⌥ ⇧ V</kbd></footer>
  </Panel>
}
