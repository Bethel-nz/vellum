// Local project time, starting when this tracker is installed. No inferred past usage.
// Active time pauses in the background, in Settings, or after five minutes without input.
// Agent time is wall-clock time per project: parallel turns in one project count once.
import path from 'node:path'
import { renameSync } from 'node:fs'
import { loadJson, paths, writeJson } from './store'

export type ProjectTime = { activeMs: number; agentMs: number }
export type ActivityData = { version: 1; startedAt: string; days: Record<string, Record<string, ProjectTime>> }
export type ActivityContext = { workspace?: string; foreground: boolean; agents: string[]; enabled: boolean }
const IDLE_MS = 5 * 60_000
const MAX_GAP_MS = 60_000
const file = path.join(paths.home, 'activity.json')
export const dayKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

export class ActivityLedger {
  #data: ActivityData
  #context?: ActivityContext
  #at?: number
  #input: number
  #dirty = false
  #listeners = new Set<() => void>()
  constructor(data?: ActivityData, now = Date.now()) {
    this.#data = data?.version === 1 ? data : { version: 1, startedAt: new Date(now).toISOString(), days: {} }
    this.#input = now
  }
  getSnapshot = () => this.#data
  subscribe = (listener: () => void) => { this.#listeners.add(listener); return () => { this.#listeners.delete(listener) } }
  touch = (now = Date.now()) => {
    if (now - this.#input >= IDLE_MS && this.#context) this.sample(this.#context, now)
    this.#input = now
  }
  setEnabled(enabled: boolean, now = Date.now()) {
    if (this.#context) this.sample({ ...this.#context, enabled }, now)
    this.flush()
  }
  sample(context: ActivityContext, now = Date.now()) {
    const previous = this.#context
    const from = this.#at
    this.#context = { ...context, agents: [...new Set(context.agents)] }
    this.#at = now
    // A sleep, clock jump or stopped process isn't active work.
    if (from === undefined || !previous?.enabled || now <= from || now - from > MAX_GAP_MS) return
    let days = this.#data.days
    let changed = false
    const add = (workspace: string, field: keyof ProjectTime, start: number, end: number) => {
      while (start < end) {
        const date = new Date(start)
        const day = dayKey(date)
        const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime()
        const until = Math.min(end, midnight)
        const values = days[day] ?? {}
        const project = values[workspace] ?? { activeMs: 0, agentMs: 0 }
        days = { ...days, [day]: { ...values, [workspace]: { ...project, [field]: project[field] + until - start } } }
        start = until
        changed = true
      }
    }
    if (previous.foreground && previous.workspace) add(previous.workspace, 'activeMs', from, Math.min(now, this.#input + IDLE_MS))
    for (const workspace of previous.agents) add(workspace, 'agentMs', from, now)
    if (changed) {
      this.#data = { ...this.#data, days }
      this.#dirty = true
      for (const listener of this.#listeners) listener()
    }
  }
  flush(destination = file) {
    if (!this.#dirty) return
    const temporary = `${destination}.${process.pid}.tmp`
    writeJson(temporary, this.#data)
    renameSync(temporary, destination)
    this.#dirty = false
  }
}

export const activity = new ActivityLedger(await loadJson<ActivityData | undefined>(file, undefined))

export function projectTimes(data: ActivityData, days?: string[]) {
  const totals = new Map<string, ProjectTime>()
  for (const [day, projects] of Object.entries(data.days)) {
    if (days && !days.includes(day)) continue
    for (const [workspace, values] of Object.entries(projects)) {
      const previous = totals.get(workspace) ?? { activeMs: 0, agentMs: 0 }
      totals.set(workspace, { activeMs: previous.activeMs + values.activeMs, agentMs: previous.agentMs + values.agentMs })
    }
  }
  return [...totals].map(([workspace, values]) => ({ workspace, ...values })).sort((a, b) => b.activeMs + b.agentMs - a.activeMs - a.agentMs)
}

export function timeLabel(milliseconds: number) {
  if (milliseconds <= 0) return '0m'
  if (milliseconds < 60_000) return '<1m'
  const minutes = Math.floor(milliseconds / 60_000)
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`
}
