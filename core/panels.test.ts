import { describe, expect, test } from 'bun:test'
import { clampFloating, initialPanel, placeFloating, placeInline, reducePanel } from './panels'

describe('panel state', () => {
  test('draft survives inline<->floating transitions', () => {
    let s = initialPanel()
    s = reducePanel(s, { type: 'SET_DRAFT', draft: 'hello' })
    s = reducePanel(s, { type: 'OPEN_INLINE', anchorId: 'a' })
    s = reducePanel(s, { type: 'OPEN_FLOATING' })
    expect(s.mode).toBe('floating')
    expect(s.draft).toBe('hello')
    s = reducePanel(s, { type: 'DOCK' })
    expect(s.mode).toBe('inline')
    expect(s.draft).toBe('hello')
  })

  test('inline closes on outside/escape/blur, floating does not close on outside', () => {
    let s = reducePanel(initialPanel(), { type: 'OPEN_INLINE' })
    s = reducePanel(s, { type: 'OUTSIDE' })
    expect(s.mode).toBe('closed')
    s = reducePanel(initialPanel(), { type: 'OPEN_FLOATING' })
    s = reducePanel(s, { type: 'OUTSIDE' })
    expect(s.mode).toBe('floating')
    s = reducePanel(s, { type: 'ESCAPE' })
    expect(s.mode).toBe('closed')
  })

  test('expanded floating collapses on first Escape', () => {
    let s = reducePanel(initialPanel(), { type: 'OPEN_FLOATING' })
    s = reducePanel(s, { type: 'EXPAND' })
    expect(s.expanded).toBe(true)
    s = reducePanel(s, { type: 'ESCAPE' })
    expect(s.mode).toBe('floating')
    expect(s.expanded).toBe(false)
  })

  test('streaming pins the panel open', () => {
    let s = reducePanel(initialPanel(), { type: 'OPEN_INLINE' })
    s = reducePanel(s, { type: 'STREAM_START' })
    s = reducePanel(s, { type: 'OUTSIDE' })
    expect(s.mode).toBe('inline')
    s = reducePanel(s, { type: 'STREAM_END' })
    s = reducePanel(s, { type: 'OUTSIDE' })
    expect(s.mode).toBe('closed')
  })

  test('rapid repeated open is idempotent', () => {
    let s = initialPanel()
    for (let i = 0; i < 10; i++) s = reducePanel(s, { type: i % 2 ? 'CLOSE' : 'OPEN_INLINE' })
    expect(s.mode).toBe('closed')
    s = reducePanel(s, { type: 'OPEN_INLINE', anchorId: 'a' })
    s = reducePanel(s, { type: 'OPEN_INLINE', anchorId: 'a' })
    expect(s.mode).toBe('inline')
  })
})

describe('panel geometry', () => {
  test('inline picks the roomier side and clamps horizontally', () => {
    const view = { width: 1000, height: 700 }
    const low = placeInline({ x: 100, y: 600, width: 40, height: 20 }, view)
    expect(low.side).toBe('top')
    expect(low.y).toBeLessThan(600)
    const high = placeInline({ x: 100, y: 80, width: 40, height: 20 }, view)
    expect(high.side).toBe('bottom')
    const edge = placeInline({ x: 940, y: 80, width: 40, height: 20 }, view)
    expect(edge.x + edge.width).toBeLessThanOrEqual(1000 - 8)
  })

  test('inline caps to available room, never below 120', () => {
    const tight = placeInline({ x: 10, y: 330, width: 10, height: 10 }, { width: 400, height: 360 })
    expect(tight.maxHeight).toBeGreaterThanOrEqual(120)
    expect(tight.maxHeight).toBeLessThanOrEqual(420)
  })

  test('floating centers and clamps to the window', () => {
    const p = placeFloating({ width: 1200, height: 800 })
    expect(p.x).toBe(Math.round((1200 - 400) / 2))
    const small = placeFloating({ width: 300, height: 200 })
    expect(small.width).toBeLessThanOrEqual(300 - 24)
    const dragged = clampFloating({ x: -500, y: -500, width: 400, height: 480 }, { width: 1000, height: 700 })
    expect(dragged.x).toBe(12)
    expect(dragged.y).toBe(12)
  })
})
