/** Subscription notices from Claude's reported limit state, not guessed percentages. */
export type UsageLimit = {
  window: 'session' | 'weekly' | 'usage'
  state: 'approaching' | 'reached'
  scope?: string
  /** Epoch milliseconds. */
  resetsAt?: number
  /** Older agent errors may supply only a human-readable reset time. */
  resetText?: string
}

export function usageLimitFromInfo(value: unknown): UsageLimit | undefined {
  if (!value || typeof value !== 'object') return
  const info = value as Record<string, unknown>
  if (info.status !== 'allowed_warning' && info.status !== 'rejected') return
  const type = typeof info.rateLimitType === 'string' ? info.rateLimitType : ''
  const reset = typeof info.resetsAt === 'number' && Number.isFinite(info.resetsAt) && info.resetsAt > 0 ? info.resetsAt * 1000 : undefined
  return {
    window: type === 'five_hour' ? 'session' : type.startsWith('seven_day') ? 'weekly' : 'usage',
    state: info.status === 'rejected' ? 'reached' : 'approaching',
    scope: type === 'seven_day_opus' ? 'Opus' : type === 'seven_day_sonnet' ? 'Sonnet' : undefined,
    resetsAt: reset !== undefined && !Number.isNaN(new Date(reset).getTime()) ? reset : undefined,
  }
}

/**
 * Restricted to known quota-error wording, from every agent: Claude ("You've hit your weekly
 * limit · resets …"), Codex ("You've hit your usage limit … try again at 3:04 PM"), OpenCode
 * ("Free usage limit reached. …"), and an API key's "exceeded your current quota". Context
 * length and API throttling stay errors.
 */
export function usageLimitFromText(text: string, reported?: UsageLimit): UsageLimit | undefined {
  const clean = text.trim().replace(/^Internal error:\s*/i, '').replace(/[’‘]/g, "'")
  const kind = '(?:session|weekly|usage|daily|monthly|message|free)'
  const explicit = new RegExp(`^(?:approaching\\s+(?:your\\s+)?${kind}\\b.*limit|(?:${kind}\\s+)+(?:usage\\s+)?limit\\s+(?:reached|exceeded)|you(?:'ve| have)\\s+(?:hit|reached)\\s+(?:your\\s+)?(?:${kind}\\s+)*(?:limit|usage limit)\\b|you(?:'ve| have)?\\s+exceeded\\s+your\\s+(?:current\\s+)?quota)`, 'i')
  if (!explicit.test(clean)) return
  const reset = clean.match(/\b(?:resets?\b[^·\n]*|try again (?:at|in)\b[^.·\n]*)/i)?.[0]?.trim()
  const notice: UsageLimit = {
    window: /\bweekly\b/i.test(clean) ? 'weekly' : /\bsession\b/i.test(clean) ? 'session' : 'usage',
    state: /^approaching\b/i.test(clean) ? 'approaching' : 'reached',
    resetText: reset ? `${reset[0]!.toUpperCase()}${reset.slice(1)}` : undefined,
  }
  if (reported?.state === 'reached' && (notice.window === 'usage' || notice.window === reported.window)) {
    return { ...reported, state: notice.state, resetText: reported.resetsAt ? undefined : notice.resetText ?? reported.resetText }
  }
  return notice
}

export function usageLimitTitle(limit: UsageLimit) {
  const name = limit.window === 'weekly' ? `weekly${limit.scope ? ` ${limit.scope}` : ''} usage limit` : limit.window === 'session' ? 'session limit' : 'usage limit'
  return limit.state === 'approaching' ? `Approaching ${name}` : `${name[0]?.toUpperCase()}${name.slice(1)} reached`
}

export const usageLimitKey = (limit: UsageLimit) => `${limit.window}:${limit.scope ?? ''}:${limit.state}:${limit.resetsAt ?? limit.resetText ?? ''}`

export function usageResetText(limit: UsageLimit, now = Date.now(), timeZone?: string) {
  if (limit.resetsAt === undefined) return limit.resetText ?? ''
  const remaining = limit.resetsAt - now
  if (limit.window === 'session' && remaining > 0 && remaining <= 60 * 60_000) return `Resets in ${Math.ceil(remaining / 60_000)} min`
  const date = new Intl.DateTimeFormat(undefined, {
    ...(limit.window === 'weekly' || remaining <= 0 ? { weekday: 'short', month: 'short', day: 'numeric' } as const : {}),
    hour: 'numeric', minute: '2-digit', timeZone,
  }).format(limit.resetsAt)
  return `${remaining > 0 ? 'Resets' : 'Reset'}${limit.window === 'session' && remaining > 0 ? ' at' : ''} ${date}`
}
