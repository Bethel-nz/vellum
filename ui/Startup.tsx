import { useEffect, useState } from 'react'
import { motion } from '@gpuix/react'
import { Button, Label, useM } from '../components'
import { tween, useReducedMotion } from '../components/motion'
import { font } from './theme'

const messages = [
  'Setting things up…',
  'Making room for your ideas…',
  'Getting your workspace ready…',
  'A fresh page is on its way…',
  'Gathering the essentials…',
  'Getting everything in place…',
]

/** A quiet first frame while notes, drafts, fonts and your account picture load. */
export function StartupScreen({ error, onRetry }: { error?: string; onRetry: () => void }) {
  const m = useM()
  const reduced = useReducedMotion()
  const [message, setMessage] = useState(() => Math.floor(Math.random() * messages.length))
  const [atEnd, setAtEnd] = useState(false)
  useEffect(() => {
    if (error) return
    const timer = setInterval(() => setMessage((current) => (current + 1 + Math.floor(Math.random() * (messages.length - 1))) % messages.length), 2200)
    return () => clearInterval(timer)
  }, [error])
  useEffect(() => {
    if (reduced || error) return
    setAtEnd(true)
    const timer = setInterval(() => setAtEnd((value) => !value), 1250)
    return () => clearInterval(timer)
  }, [reduced, error])

  return <div testId="startup" style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: m.rootTint, fontFamily: font.sans, color: m.text }}>
    <div style={{ width: '100%', maxWidth: 400, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <text aria-hidden style={{ fontSize: 44, lineHeight: 54, fontWeight: 600, color: m.text, marginBottom: 23 }}>V</text>
      <text style={{ fontSize: 21, lineHeight: 28, fontWeight: 600, color: m.text, textAlign: 'center', marginBottom: 9 }}>{error ? 'Couldn’t open Vellum' : 'Opening Vellum'}</text>
      <text style={{ fontSize: 13.5, lineHeight: 21, color: m.textMuted, textAlign: 'center', marginBottom: 24 }}>Your notes stay saved on this computer.</text>
      {error ? <>
        <div role="alert" style={{ marginBottom: 18 }}><text style={{ fontSize: 12.5, lineHeight: 19, color: m.textMuted, textAlign: 'center' }}>{error}</text></div>
        <Button testId="startup-retry" onPress={onRetry} style={{ height: 32, paddingLeft: 14, paddingRight: 14, borderRadius: 9, borderWidth: 1, borderColor: m.border }}><Label>Try again</Label></Button>
      </> : <>
        <div role="progressbar" aria-label="Opening Vellum" style={{ position: 'relative', width: 280, height: 4, borderRadius: 2, backgroundColor: m.selected, overflow: 'hidden' }}>
          <motion.div initial={false} animate={{ left: reduced ? 98 : atEnd ? 196 : 0 }} transition={tween({ duration: 1.2, ease: 'easeInOut' })} style={{ position: 'absolute', top: 0, width: 84, height: 4, borderRadius: 2, backgroundColor: m.text }} />
        </div>
        {/* biome-ignore lint/a11y/useSemanticElements: GPUIX exposes native div status nodes, not HTML output elements. */}
        <div role="status" aria-live="polite" style={{ marginTop: 12, minHeight: 20 }}><text testId="startup-message" style={{ fontSize: 12.5, lineHeight: 20, color: m.textMuted, textAlign: 'center' }}>{messages[message]}</text></div>
      </>}
    </div>
  </div>
}
