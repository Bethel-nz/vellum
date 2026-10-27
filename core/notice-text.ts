import type { Notice } from './notify'
import { usageLimitFromText, usageLimitTitle } from './usage'

export function noticeText(text: string, max = 220) {
  const plain = text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\[([^\]]+)\]\([^\s)]+\)/g, '$1')
    .replace(/^\s*```[^\n]*\n?/gm, '').replace(/`([^`]+)`/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}\s+|[-*+]\s+)/gm, '').replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\s+/g, ' ').trim()
  if (plain.length <= max) return plain
  const cut = plain.slice(0, max - 1)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 35)).trimEnd()}…`
}

/** Native banners contain an event and next step; the note keeps the full provider error. */
export function noticeMessage(item: Pick<Notice, 'kind' | 'agent' | 'body'>) {
  const body = noticeText(item.body, 2000).replace(/^(?:Internal error|Error|Provider error):\s*/i, '')
  if (item.kind === 'error') {
    if (/^free (?:model )?usage limit (?:reached|exceeded)/i.test(body)) return { title: `${item.agent} · Free usage limit reached`, body: 'Choose another model or review your provider usage in the note.' }
    const limit = usageLimitFromText(body)
    if (limit) return { title: `${item.agent} · ${usageLimitTitle(limit)}`, body: noticeText([limit.resetText, 'Open the note to review usage or change models.'].filter(Boolean).join(' ')) }
    if (/authentication required|not logged in|not signed in|unauthorized|provider authentication/i.test(body)) return { title: `${item.agent} · Sign-in required`, body: 'Open the note to reconnect the model provider and continue.' }
    return { title: `${item.agent} needs attention`, body: noticeText(body || 'The agent stopped unexpectedly. Open the note for details.') }
  }
  if (item.kind === 'question') return { title: `${item.agent} has a question`, body: noticeText(body || 'Open the note to answer and continue.') }
  if (item.kind === 'approval') return { title: `${item.agent} needs your approval`, body: noticeText(body || 'Open the note to review the request.') }
  return { title: `${item.agent} replied`, body: !body || body === `${item.agent} replied` ? 'Your reply is ready. Open the note to continue.' : noticeText(body) }
}
