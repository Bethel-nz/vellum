import { expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = mkdtempSync(path.join(tmpdir(), 'vellum-opener-'))
process.env.VELLUM_HOME = path.join(root, 'home')
const { fileArgs, handOff, takeInbox, watchInbox } = await import('./opener')
const { paths } = await import('./store')

const note = path.join(root, 'a.vel')
writeFileSync(note, '{}')

test('only existing files on the command line count', () => {
  expect(fileArgs(['--agent', note, path.join(root, 'missing.txt'), root])).toEqual([note])
})

test('with no Vellum running the launch keeps its files and stays', () => {
  expect(handOff([note])).toBe(false)
  expect(takeInbox()).toEqual([note])
  expect(takeInbox()).toEqual([])
})

test('a running Vellum takes a later launch’s files', async () => {
  const seen: string[] = []
  const stop = watchInbox((files) => seen.push(...files))
  // Another launch: the pid file names a live process that isn't this one.
  writeFileSync(path.join(paths.home, 'run', 'app.pid'), String(process.ppid))
  expect(handOff([note])).toBe(true)
  for (let i = 0; i < 40 && !seen.length; i++) await Bun.sleep(25)
  stop()
  expect(seen).toEqual([note])
})
