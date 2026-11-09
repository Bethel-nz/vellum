import { expect, test } from 'bun:test'
import { usageLimitFromText, usageLimitTitle } from './usage'

test("Claude's weekly limit, with its reset", () => {
  const limit = usageLimitFromText("Internal error: You've hit your weekly limit · resets Oct 30 at 7pm (Africa/Lagos)")
  expect(limit).toMatchObject({ window: 'weekly', state: 'reached', resetText: 'Resets Oct 30 at 7pm (Africa/Lagos)' })
  expect(usageLimitTitle(limit!)).toBe('Weekly usage limit reached')
})

test("OpenCode's free usage limit reads as a usage limit", () => {
  const limit = usageLimitFromText('Internal error: Free usage limit reached. Free models work in OpenCode (https://opencode.ai); subscribe to OpenCode Go to keep going: https://opencode.ai/go')
  expect(limit).toMatchObject({ window: 'usage', state: 'reached' })
  expect(usageLimitTitle(limit!)).toBe('Usage limit reached')
})

test("Codex's usage limit keeps its try-again time", () => {
  const limit = usageLimitFromText("You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 3:04 PM.")
  expect(limit).toMatchObject({ window: 'usage', state: 'reached', resetText: 'Try again at 3:04 PM' })
})

test("an API key's exhausted quota is a usage limit", () => {
  expect(usageLimitFromText('You exceeded your current quota, please check your plan and billing details.')).toMatchObject({ state: 'reached' })
})

test('throttling and context length stay errors', () => {
  expect(usageLimitFromText('Rate limit exceeded, please retry in 20s')).toBeUndefined()
  expect(usageLimitFromText('Prompt is too long: context length exceeded')).toBeUndefined()
  expect(usageLimitFromText("Can't re-snapshot right now. Try again in a moment.")).toBeUndefined()
})
