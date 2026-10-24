// Models and context. The list is the agent's `model` config option (what this account can use,
// Fable only with usage credits), cached per profile so the switcher has it before a session
// starts. Until then the four stable aliases stand in. "default" is the account's own default.
//
// Context is how full the conversation is: the agent's `usage_update` (used of size). Older notes,
// from before ACP, count it from the last assistant message's usage against the result's window.

import { paths, readJson, writeJson } from './store'
import path from 'node:path'
import type { Think } from './asks'

export type ModelOption = { value: string; displayName: string; description?: string; resolvedModel?: string }
export type EffortOption = { value: Think; displayName: string; description?: string }
export const effortValue = (value: string): Think | undefined => ({ low: 'off', default: 'on', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' } as Record<string, Think>)[value]
export const effortLabel = (value: Think) => ({ off: 'Low', on: 'Default', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' })[value]
export const fallbackEfforts: EffortOption[] = ['off', 'on', 'max'].map((value) => ({ value: value as Think, displayName: effortLabel(value as Think) }))

export const fallbackModels: ModelOption[] = [
  { value: 'default', displayName: 'Default (recommended)' },
  { value: 'opus', displayName: 'Opus' },
  { value: 'sonnet', displayName: 'Sonnet' },
  { value: 'haiku', displayName: 'Haiku' },
]

export type ContextUse = { used: number; window?: number }

const cacheFile = () => path.join(paths.home, 'models.json')

export function cachedModels(): Record<string, ModelOption[]> {
  return readJson<Record<string, ModelOption[]>>(cacheFile(), {})
}

export function cacheModels(profileId: string, list: ModelOption[]) {
  writeJson(cacheFile(), { ...cachedModels(), [profileId]: list })
}

/** "claude-opus-5-5" → "Opus 5.5", "claude-haiku-5-5[1m]" → "Haiku 5.5". */
export function modelName(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(id.replace(/\[.*\]$/, ''))
  if (!m) return id
  const family = m[1]![0]!.toUpperCase() + m[1]!.slice(1)
  return m[3] && m[3].length <= 2 ? `${family} ${m[2]}.${m[3]}` : `${family} ${m[2]}`
}

/** A short name for the switcher: the description's first part ("Opus 5.5 · …"), else the model id. */
export function shortModel(option: ModelOption | undefined, resolved?: string): string {
  const lead = option?.description?.split(' · ')[0]?.trim()
  if (lead && lead.length <= 16) return lead
  if (option?.resolvedModel) return modelName(option.resolvedModel)
  if (resolved) return modelName(resolved)
  return !option || option.value === 'default' ? 'Default' : option.displayName
}

/** Tokens the conversation now takes, from an assistant message's usage. */
export function contextFromUsage(u: any): number | undefined {
  if (!u || typeof u !== 'object') return
  const n = (k: string) => (typeof u[k] === 'number' ? u[k] : 0)
  const used = n('input_tokens') + n('cache_creation_input_tokens') + n('cache_read_input_tokens') + n('output_tokens')
  return used > 0 ? used : undefined
}

/** The context window the result reports for `model` (or the largest, if it isn't listed). */
export function windowFromResult(modelUsage: any, model?: string): number | undefined {
  if (!modelUsage || typeof modelUsage !== 'object') return
  const of = (k: string) => (typeof modelUsage[k]?.contextWindow === 'number' ? modelUsage[k].contextWindow : undefined)
  if (model && of(model)) return of(model)
  const all = Object.keys(modelUsage).map(of).filter((x): x is number => Boolean(x))
  return all.length ? Math.max(...all) : undefined
}

/** 842 → "842", 24_310 → "24.3k", 1_000_000 → "1M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${n < 10_000 ? (n / 1000).toFixed(1) : Math.round(n / 1000)}k`.replace('.0k', 'k')
  return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`
}
