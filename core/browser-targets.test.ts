import { expect, test } from 'bun:test'
import { recordToolbarPresence, listToolbarTargets } from './browser-targets'
test('toolbar identities stay distinct for duplicate URLs and expire after 45 seconds', () => {
  const at = Date.now()
  const base = { installationId: 'install', toolbarId: 'toolbar', tabId: 1, windowId: 2, targetId: 'ABC', url: 'https://example.com', title: 'Example', open: true }
  recordToolbarPresence(base, at)
  recordToolbarPresence({ ...base, installationId: 'second', targetId: 'DEF' }, at)
  const targets = listToolbarTargets(at)
  expect(targets).toHaveLength(2)
  expect(targets[0]!.key).not.toBe(targets[1]!.key)
  expect(listToolbarTargets(at + 45_001)).toHaveLength(0)
  recordToolbarPresence(base, at)
  recordToolbarPresence({ ...base, open: false }, at + 1)
  expect(listToolbarTargets(at + 2)).toHaveLength(0)
})
