import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { relPath } from './threads'

test('workspace names beginning with two dots remain relative, while parent paths stay absolute', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'vellum-thread-path-'))
  const workspace = path.join(root, 'workspace')
  const file = path.join(workspace, '..visible.ts')
  const outside = path.join(root, 'outside.ts')
  mkdirSync(workspace)
  writeFileSync(file, '')
  writeFileSync(outside, '')

  expect(relPath(workspace, file)).toBe('..visible.ts')
  expect(relPath(workspace, outside)).toBe(outside)
})
