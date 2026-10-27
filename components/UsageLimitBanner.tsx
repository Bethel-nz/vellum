// A single-line quota notice that fits its content and shrinks with the note.
import { useEffect, useState } from 'react'
import { motion } from './spring'
import { usageLimitTitle, usageResetText, type UsageLimit } from '../core/usage'
import { Button } from './Button'
import { Icon } from './Icon'
import { enter, useReducedMotion } from './motion'
import { useM } from './theme'

export function UsageLimitBanner({ limit, onDismiss, hideAfterReset = false, timeZone, testId = 'usage-limit' }: { limit: UsageLimit; onDismiss?: () => void; hideAfterReset?: boolean; timeZone?: string; testId?: string }) {
  const m = useM()
  const reduced = useReducedMotion()
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (limit.resetsAt === undefined) return
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [limit.resetsAt])
  if (hideAfterReset && limit.resetsAt !== undefined && limit.resetsAt <= now) return null
  const reached = limit.state === 'reached'
  const reset = usageResetText(limit, now, timeZone)
  const title = usageLimitTitle(limit)
  return <div testId={testId} role={reached ? 'alert' : 'status'} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', alignSelf: 'start', maxWidth: '100%', minWidth: 0, minHeight: 40, gap: 10, padding: 10, borderRadius: 12, backgroundColor: m.chipBg }}>
    {/* Grows into any spare width, so a stretched banner keeps its ✕ at the far end. */}
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
      <motion.div initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={enter('fast')} style={{ width: 16, height: 19, paddingTop: 2, flexShrink: 0, pointerEvents: 'none' }}><Icon name="gauge" size={16} color={reached ? m.danger : m.textMuted} /></motion.div>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0, flexShrink: 1 }}>
        <text testId={`${testId}-title`} style={{ fontSize: 13.5, lineHeight: 19, color: reached ? m.danger : m.textUi, flexShrink: 1, minWidth: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{title}</text>
        {reset ? <text testId={`${testId}-reset`} style={{ fontSize: 13, lineHeight: 19, color: m.textMuted, flexShrink: 4, minWidth: 0, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{reset}</text> : null}
      </div>
    </div>
    {onDismiss ? <Button testId={`${testId}-dismiss`} title="Dismiss usage warning" onPress={onDismiss} style={{ width: 26, height: 22, paddingLeft: 0, paddingRight: 0 }}><Icon name="x" size={16} color={m.textMuted} /></Button> : null}
  </div>
}
