// Models and context. The list comes from the CLI's `initialize` response (what this account can
// use, Fable only with usage credits), cached per profile so the switcher has it before the first
// turn of a session. Until then the four stable aliases stand in. `value` is what `--model` and
// the `set_model` control request take; "default" means no flag at all.
//
// Context is how full the conversation is: the last top-level assistant message's input, cache
// and output tokens, against the window the result's `modelUsage` reports for that model
// (spikes/models-usage.ts).

import { paths, readJson, writeJson } from './store'
import path from 'node:path'

export type ModelOption = { value: string; displayName: string; description?: string; resolvedModel?: string }

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

/** The `models` array of an initialize response, keeping only the fields Vellum shows. */
export function modelsFromInit(response: any): ModelOption[] | undefined {
  const list = response?.models
  if (!Array.isArray(list)) return
  const out = list
    .filter((x: any) => typeof x?.value === 'string' && typeof x?.displayName === 'string')
    .map((x: any): ModelOption => ({ value: x.value, displayName: x.displayName, description: typeof x.description === 'string' ? x.description : undefined, resolvedModel: typeof x.resolvedModel === 'string' ? x.resolvedModel : undefined }))
  return out.length ? out : undefined
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
