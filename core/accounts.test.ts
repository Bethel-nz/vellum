// The link check and the MCP merge, on scratch folders: a hub standing in for ~/.claude and an
// account's config dir.
import { beforeEach, expect, test } from 'bun:test'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// VELLUM_HOME is a scratch folder already (core/test-setup.ts, preloaded).
const root = mkdtempSync(path.join(tmpdir(), 'vellum-accounts-'))
let hub = ''
let acct = ''
const { linkAccount, mergeJson, mergeMcpServers } = await import('./accounts')

let n = 0
beforeEach(() => {
  const base = path.join(root, `case-${n++}`)
  hub = path.join(base, 'home', '.claude')
  acct = path.join(base, 'work', 'claude')
  process.env.VELLUM_CLAUDE_HOME = hub
  mkdirSync(path.join(hub, 'skills', 'review'), { recursive: true })
  writeFileSync(path.join(hub, 'skills', 'review', 'SKILL.md'), '# review\n')
  writeFileSync(path.join(hub, 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(git status)'] }, theme: 'dark' }))
  writeFileSync(path.join(hub, 'CLAUDE.md'), 'Be brief.\n')
  mkdirSync(path.join(hub, 'projects'), { recursive: true })
})

const isLinkTo = (link: string, target: string) => lstatSync(link).isSymbolicLink() && realpathSync(link) === realpathSync(target)

test('a new account links every shared entry to ~/.claude', () => {
  const did = linkAccount('work', acct)
  expect(isLinkTo(path.join(acct, 'skills'), path.join(hub, 'skills'))).toBe(true)
  expect(isLinkTo(path.join(acct, 'settings.json'), path.join(hub, 'settings.json'))).toBe(true)
  expect(isLinkTo(path.join(acct, 'projects'), path.join(hub, 'projects'))).toBe(true)
  expect(readFileSync(path.join(acct, 'skills', 'review', 'SKILL.md'), 'utf8')).toBe('# review\n')
  // A file ~/.claude doesn't have yet isn't linked (nothing to link to).
  expect(existsSync(path.join(acct, 'settings.local.json'))).toBe(false)
  expect(did.every((a) => a.did === 'linked')).toBe(true)
})

test('running it again changes nothing', () => {
  linkAccount('work', acct)
  expect(linkAccount('work', acct)).toEqual([])
})

test('a link to the old ~/.vellum/shared moves over, its contents merged and the old folder untouched', () => {
  const old = path.join(root, `old-shared-${n}`)
  mkdirSync(path.join(old, 'skills', 'mine'), { recursive: true })
  writeFileSync(path.join(old, 'skills', 'mine', 'SKILL.md'), '# mine\n')
  mkdirSync(acct, { recursive: true })
  symlinkSync(path.join(old, 'skills'), path.join(acct, 'skills'))
  const did = linkAccount('work', acct)
  expect(did.find((a) => a.name === 'skills')?.did).toBe('relinked')
  expect(isLinkTo(path.join(acct, 'skills'), path.join(hub, 'skills'))).toBe(true)
  expect(readdirSync(path.join(hub, 'skills')).sort()).toEqual(['mine', 'review'])
  expect(existsSync(path.join(old, 'skills', 'mine', 'SKILL.md'))).toBe(true)
})

test('a settings.json that became a real file is merged back: rules from both, a backup kept', () => {
  linkAccount('work', acct)
  const link = path.join(acct, 'settings.json')
  require('node:fs').rmSync(link)
  writeFileSync(link, JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, theme: 'light' }))
  const past = new Date(Date.now() - 60_000)
  utimesSync(link, past, past) // older than the hub: the hub's theme stays
  const did = linkAccount('work', acct)
  const merged = JSON.parse(readFileSync(path.join(hub, 'settings.json'), 'utf8'))
  expect(merged.permissions.allow).toEqual(['Bash(git status)', 'Bash(ls)'])
  expect(merged.theme).toBe('dark')
  expect(isLinkTo(link, path.join(hub, 'settings.json'))).toBe(true)
  const backup = did.find((a) => a.name === 'settings.json')?.backup
  expect(backup && JSON.parse(readFileSync(backup, 'utf8')).theme).toBe('light')
})

test('a real projects folder keeps every session line from both sides', () => {
  const session = path.join('-ws', 's1.jsonl')
  mkdirSync(path.join(hub, 'projects', '-ws'), { recursive: true })
  writeFileSync(path.join(hub, 'projects', session), '{"a":1}\n')
  mkdirSync(path.join(acct, 'projects', '-ws'), { recursive: true })
  writeFileSync(path.join(acct, 'projects', session), '{"a":1}\n{"b":2}\n')
  writeFileSync(path.join(acct, 'projects', '-ws', 's2.jsonl'), '{"c":3}\n')
  linkAccount('work', acct)
  expect(readFileSync(path.join(hub, 'projects', session), 'utf8')).toBe('{"a":1}\n{"b":2}\n')
  expect(readFileSync(path.join(hub, 'projects', '-ws', 's2.jsonl'), 'utf8')).toBe('{"c":3}\n')
  expect(isLinkTo(path.join(acct, 'projects'), path.join(hub, 'projects'))).toBe(true)
})

test('mergeJson: objects deep, lists combined, the newer side wins a clash', () => {
  expect(mergeJson({ a: 1, l: [1], o: { x: 1 } }, { a: 2, l: [1, 2], o: { y: 2 } }, true)).toEqual({ a: 2, l: [1, 2], o: { x: 1, y: 2 } })
  expect(mergeJson({ a: 1 }, { a: 2 }, false)).toEqual({ a: 1 })
})

test('MCP servers from other accounts come in; only mcpServers changes; the newer file wins a clash', () => {
  const dir = path.join(root, `mcp-${n}`)
  mkdirSync(dir, { recursive: true })
  const target = path.join(dir, 'work.json')
  const home = path.join(dir, 'home.json')
  writeFileSync(target, JSON.stringify({ oauthAccount: { email: 'w@x' }, mcpServers: { db: { command: 'old' } } }))
  const past = new Date(Date.now() - 60_000)
  utimesSync(target, past, past)
  writeFileSync(home, JSON.stringify({ oauthAccount: { email: 'me@x' }, mcpServers: { db: { command: 'new' }, docs: { url: 'https://d' } } }))
  const r = mergeMcpServers(target, [home, target])
  expect(r).toEqual({ added: ['docs'], conflicts: ['db'] })
  const after = JSON.parse(readFileSync(target, 'utf8'))
  expect(after.oauthAccount.email).toBe('w@x')
  expect(after.mcpServers).toEqual({ db: { command: 'new' }, docs: { url: 'https://d' } })
  expect(mergeMcpServers(target, [home])).toEqual({ added: [], conflicts: [] })
})

test('merging adds nothing → the hub file is left exactly as it was, not even reformatted', () => {
  const old = path.join(root, `old-empty-${n}`)
  mkdirSync(old, { recursive: true })
  writeFileSync(path.join(old, 'settings.json'), '{}\n')
  const original = '{"theme":"dark",\n   "permissions":{"allow":["Bash(git status)"]}}'
  writeFileSync(path.join(hub, 'settings.json'), original)
  mkdirSync(acct, { recursive: true })
  symlinkSync(path.join(old, 'settings.json'), path.join(acct, 'settings.json'))
  linkAccount('work', acct)
  expect(readFileSync(path.join(hub, 'settings.json'), 'utf8')).toBe(original)
})

test('nothing is created in ~/.claude ahead of time; a folder only the account has moves there', () => {
  linkAccount('work', acct)
  expect(existsSync(path.join(hub, 'todos'))).toBe(false)
  expect(existsSync(path.join(acct, 'todos'))).toBe(false)
  // The account's claude makes todos/ first, as a real folder.
  mkdirSync(path.join(acct, 'todos'))
  writeFileSync(path.join(acct, 'todos', 't.json'), '[]')
  linkAccount('work', acct)
  expect(readFileSync(path.join(hub, 'todos', 't.json'), 'utf8')).toBe('[]')
  expect(isLinkTo(path.join(acct, 'todos'), path.join(hub, 'todos'))).toBe(true)
})

test('no hub, or a relative one: nothing happens to the account', () => {
  linkAccount('work', acct)
  const before = readdirSync(acct).sort()
  process.env.VELLUM_CLAUDE_HOME = path.join(root, 'missing-hub')
  expect(linkAccount('work', acct)).toEqual([])
  expect(readdirSync(acct).sort()).toEqual(before)
  expect(isLinkTo(path.join(acct, 'skills'), path.join(hub, 'skills'))).toBe(true)
  process.env.VELLUM_CLAUDE_HOME = 'undefined/claude-home'
  expect(() => linkAccount('work', acct)).toThrow('absolute')
})
