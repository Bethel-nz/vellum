import { expect, test } from 'bun:test'
import { applyBrowserEvent, browserVisibleCalls } from './browser-presentation'
import { newThread, reduce } from './threads'
import type { BrowserEvent } from './browser-types'
import type { ToolCall } from './tools'
const key = { noteId: 'note', session: 'vellum-note', generation: 'one' }
const start: BrowserEvent = { type: 'action-start', key, actionId: 'action', title: 'Fill', at: '2026-10-27T12:00:00Z', runId: 'run' }
test('replay is idempotent and generations keep separate stable browser rows', () => {
  let thread = newThread({ id: 'note', title: 'Note', profileId: 'main', workspace: '/tmp', createdAt: start.at })
  for (const event of [start, start, { ...start, key: { ...key, generation: 'two' } }]) thread = reduce(thread, { type: 'vellum/browser-event', event, at: start.at })
  expect(thread.blocks).toHaveLength(2)
  const browser = applyBrowserEvent(undefined, start)
  expect(applyBrowserEvent(browser, start).activities).toHaveLength(1)
  expect(thread.blocks[0]!.id).not.toBe(thread.blocks[1]!.id)
})
test('only trusted browser children disappear; mixed runner siblings and failures stay', () => {
  const browser: ToolCall = { id: 'b', name: 'browser', detail: '', status: 'ok', origin: 'bridge', presentation: { kind: 'browser', session: key.session, generation: key.generation, actionId: 'action' } }
  const bash: ToolCall = { id: 'bash', name: 'Bash', detail: 'echo browser', status: 'ok' }
  expect(browserVisibleCalls([browser, bash])).toEqual([bash])
  const runner: ToolCall = { id: 'runner', name: 'execute', detail: '', status: 'ok', children: [browser, bash] }
  expect(browserVisibleCalls([runner])[0]!.children).toEqual([bash])
  expect(browserVisibleCalls([{ ...runner, status: 'error', children: [browser] }])[0]!.status).toBe('error')
  expect(browserVisibleCalls([{ ...browser, origin: undefined }])).toHaveLength(1)
})
