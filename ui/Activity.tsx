import path from 'node:path'
import { useState, useSyncExternalStore } from 'react'
import { Segmented, Switch } from '../components'
import { activity, dayKey, projectTimes, timeLabel } from '../core/activity'
import { readSettings, updateSettings } from '../core/store'
import { useM } from './kit'
import { SettingsSection as SheetSection } from './settings/controls'
import { font } from './theme'

export function Activity() {
  const m = useM()
  const data = useSyncExternalStore(activity.subscribe, activity.getSnapshot, activity.getSnapshot)
  const [period, setPeriod] = useState<'today' | 'week' | 'all'>('today')
  const [enabled, setEnabled] = useState(readSettings().activityTracking !== false)
  const today = new Date()
  const week = Array.from({ length: 7 }, (_, index) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7) + index))
  const days = period === 'today' ? [dayKey(today)] : period === 'week' ? week.map((date) => dayKey(date)) : undefined
  const projects = projectTimes(data, days)
  const active = projects.reduce((sum, project) => sum + project.activeMs, 0)
  const agent = projects.reduce((sum, project) => sum + project.agentMs, 0)
  const trackedDays = Math.max(1, period === 'today' ? 1 : period === 'week' ? 7 : Object.keys(data.days).length)
  const capacity = trackedDays * 24 * 60 * 60_000
  return <SheetSection label="Project time" hint="Saved on this device. Active time pauses after 5 idle minutes. Agent time pauses while waiting for you.">
    <div style={{ display: 'flex', flexDirection: 'column' }}>
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 10 }}>
      <text style={{ fontSize: 12, lineHeight: 17, color: m.textMuted, flexGrow: 1 }}>Track project time</text>
      <Switch testId="activity-tracking" label="Track project time" checked={enabled} onChange={(value) => { setEnabled(value); updateSettings({ activityTracking: value }); activity.setEnabled(value) }} />
    </div>
    <Segmented testId="activity-period" value={period} onChange={setPeriod} width={90} options={[{ value: 'today', label: 'Today' }, { value: 'week', label: 'This week' }, { value: 'all', label: 'All time' }]} />
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 24, paddingTop: 18, paddingBottom: 18 }}>
      <div style={{ width: 164, height: 164, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <TimeRings active={active / capacity} agent={agent / capacity} size={164} />
        <div style={{ position: 'absolute', left: 32, right: 32, top: 64, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}><text testId="activity-active-total" style={{ fontSize: 21, lineHeight: 26, color: m.text, fontWeight: 500 }}>{timeLabel(active)}</text><text style={{ fontSize: 10.5, lineHeight: 15, color: m.textMuted }}>active time</text></div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, flexGrow: 1, minWidth: 0 }}>
        <Metric label="Active time" value={timeLabel(active)} color={m.blue} />
        <Metric label="Agent time" value={timeLabel(agent)} color={m.appearance === 'light' ? m.ansi[5] : m.accent} testId="activity-agent-total" />
        <text style={{ fontSize: 10.5, lineHeight: 15, color: m.textFaint }}>{`Rings represent ${trackedDays === 1 ? 'a 24-hour day' : `${trackedDays} days`}.`}</text>
      </div>
    </div>
    <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 18 }}>
      {week.map((date) => {
        const totals = projectTimes(data, [dayKey(date)])
        return <div key={dayKey(date)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}><TimeRings active={totals.reduce((sum, project) => sum + project.activeMs, 0) / 86_400_000} agent={totals.reduce((sum, project) => sum + project.agentMs, 0) / 86_400_000} size={28} /><text style={{ fontSize: 10, lineHeight: 14, color: dayKey(date) === dayKey(today) ? m.textUi : m.textFaint }}>{date.toLocaleDateString(undefined, { weekday: 'short' })}</text></div>
      })}
    </div>
    <div style={{ display: 'flex', flexDirection: 'row', gap: 12, paddingBottom: 7, borderBottomWidth: 1, borderColor: m.border }}><text style={{ flexGrow: 1, fontSize: 11, lineHeight: 16, color: m.textMuted }}>Project</text><text style={{ width: 76, fontSize: 11, lineHeight: 16, color: m.textMuted }}>You</text><text style={{ width: 76, fontSize: 11, lineHeight: 16, color: m.textMuted }}>Agent</text></div>
    {!projects.length ? <text style={{ paddingTop: 12, paddingBottom: 12, fontSize: 12, lineHeight: 18, color: m.textMuted }}>{enabled ? 'Time appears here as you work in a project.' : 'Turn on tracking to record project time.'}</text> : null}
    {projects.map((project) => <div key={project.workspace} testId={`activity-project-${project.workspace}`} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 10, paddingBottom: 10, borderBottomWidth: 1, borderColor: m.border }}><div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexGrow: 1, minWidth: 0 }}><text style={{ fontSize: 12.5, lineHeight: 18, color: m.textUi }}>{path.basename(project.workspace)}</text><text style={{ fontSize: 10, lineHeight: 15, color: m.textFaint, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{project.workspace}</text></div><text style={{ width: 76, fontFamily: font.mono, fontSize: 11.5, lineHeight: 16, color: m.textMuted }}>{timeLabel(project.activeMs)}</text><text style={{ width: 76, fontFamily: font.mono, fontSize: 11.5, lineHeight: 16, color: m.textMuted }}>{timeLabel(project.agentMs)}</text></div>)}
    </div>
  </SheetSection>
}

function Metric({ label, value, color, testId }: { label: string; value: string; color: string; testId?: string }) {
  const m = useM()
  return <div style={{ display: 'flex', flexDirection: 'row', gap: 10 }}><div style={{ width: 2, borderRadius: 1, backgroundColor: color }} /><div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}><text style={{ fontSize: 12, lineHeight: 17, color: m.textUi }}>{label}</text><text testId={testId} style={{ fontSize: 13, lineHeight: 18, color: m.textMuted }}>{value}</text></div></div>
}

function TimeRings({ active, agent, size }: { active: number; agent: number; size: number }) {
  const m = useM()
  const ticks = size > 100 ? 96 : 36
  const source = (radius: number, amount: number) => {
    const paths = Array.from({ length: ticks }, (_, index) => {
      const fraction = Math.max(0, Math.min(1, amount * ticks - index))
      if (!fraction) return ''
      const angle = (index / ticks) * Math.PI * 2 - Math.PI / 2
      return `<path opacity="${fraction}" d="M${82 + Math.cos(angle) * radius} ${82 + Math.sin(angle) * radius}L${82 + Math.cos(angle) * (radius - 8)} ${82 + Math.sin(angle) * (radius - 8)}"/>`
    }).join('')
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 164 164" fill="none" stroke="black" stroke-width="${size > 100 ? 2 : 6}" stroke-linecap="round">${paths}</svg>`
  }
  return <div style={{ position: 'relative', width: size, height: size }}>
    <svg source={source(76, 1)} style={{ position: 'absolute', width: size, height: size, color: m.borderFocused }} />
    <svg source={source(61, 1)} style={{ position: 'absolute', width: size, height: size, color: m.borderFocused }} />
    <svg source={source(76, active)} style={{ position: 'absolute', width: size, height: size, color: m.blue }} />
    <svg source={source(61, agent)} style={{ position: 'absolute', width: size, height: size, color: m.appearance === 'light' ? m.ansi[5] : m.accent }} />
  </div>
}
