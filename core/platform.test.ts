import { expect, test } from 'bun:test'
import { keys, os } from './platform'

test.skipIf(os !== 'mac')('macOS labels stay as written', () => {
  expect(keys('⇧⌘W')).toBe('⇧⌘W')
})

test.skipIf(os === 'mac')('labels use Ctrl, Alt and Shift off macOS', () => {
  expect(keys('⇧⌘W')).toBe('Ctrl+Shift+W')
  expect(keys('⌘↵ asks Claude')).toBe('Ctrl+Enter asks Claude')
  expect(keys('⌃N ⌃P to move')).toBe('Ctrl+N Ctrl+P to move')
  expect(keys('running · ⌘Esc to leave')).toBe('running · Ctrl+` to leave')
  expect(keys('Stop ⌘.')).toBe('Stop Ctrl+.')
})
