// Scrolling the terminal back: the viewport moves into the scrollback and returns to the bottom.
import { expect, test } from 'bun:test'
import { VtTerminal, type Grid } from './ghostty'

const lines = (g: Grid) => g.rows.map((r) => r.map((run) => run.text).join('').trim())

function filled() {
  const vt = new VtTerminal(20, 5, () => {})
  for (let i = 1; i <= 30; i++) vt.feed(`line ${i}\r\n`)
  return vt
}

test('scrolling up shows earlier lines, and the scrollbar says how far back it is', () => {
  const vt = filled()
  expect(lines(vt.snapshot())).toContain('line 30')
  expect(vt.scrollbar().atBottom).toBe(true)
  vt.scroll(-10)
  const shown = lines(vt.snapshot())
  expect(shown).toContain('line 20')
  expect(shown).not.toContain('line 30')
  expect(vt.scrollbar().atBottom).toBe(false)
  vt.dispose()
})

test('it stops at the top, and scrolling to the bottom brings the newest lines back', () => {
  const vt = filled()
  vt.scroll(-1000)
  expect(lines(vt.snapshot())).toContain('line 1')
  vt.scrollToBottom()
  expect(lines(vt.snapshot())).toContain('line 30')
  expect(vt.scrollbar().atBottom).toBe(true)
  vt.dispose()
})
