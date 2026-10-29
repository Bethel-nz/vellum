import { expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { accountHome, agentFor, agents, folderConfig } from './agents'
import { profileEnv, type Profile } from './profiles'

const account = (patch: Partial<Profile>): Profile => ({ id: 'a', name: 'A', color: '#000', configDir: null, workspaces: [], ...patch })

test('an account from before there was a choice runs Claude', () => {
  expect(agentFor(account({})).id).toBe('claude')
  expect(agentFor(account({ agent: 'codex' })).id).toBe('codex')
})

test('each agent is pointed at its own home, or its default one', () => {
  const base = { CLAUDE_CONFIG_DIR: '/elsewhere', CODEX_HOME: '/elsewhere' }
  expect(profileEnv(account({ configDir: '/v/claude' }), base).CLAUDE_CONFIG_DIR).toBe('/v/claude')
  expect(profileEnv(account({ configDir: null }), base).CLAUDE_CONFIG_DIR).toBeUndefined()
  expect(profileEnv(account({ agent: 'codex', configDir: '/v/codex' }), base).CODEX_HOME).toBe('/v/codex')
  expect(profileEnv(account({ agent: 'codex', configDir: null }), base).CODEX_HOME).toBeUndefined()
})

test('a new account’s home sits beside the Claude one, named for its agent', () => {
  const claudeDir = path.join('/v', 'profiles', 'work', 'claude')
  expect(accountHome(claudeDir, 'claude')).toBe(claudeDir)
  expect(accountHome(claudeDir, 'codex')).toBe(path.join('/v', 'profiles', 'work', 'codex'))
})

test('OpenCode runs as its own ACP agent; the adapters run under Bun', () => {
  expect(agents.opencode.argv().slice(-1)).toEqual(['acp'])
  expect(agents.codex.argv()[0]).toBe(process.execPath)
  expect(agents.codex.argv()[1]).toContain('codex-acp')
})

test('a folder\'s config that runs its own code is found per agent, folders included', async () => {
  const folder = path.join(tmpdir(), `vellum-trust-${crypto.randomUUID()}`)
  await Bun.write(path.join(folder, '.mcp.json'), '{}')
  await Bun.write(path.join(folder, '.opencode', 'plugin', 'x.ts'), '')
  expect(await folderConfig(folder, agents.claude)).toEqual(['.mcp.json'])
  expect(await folderConfig(folder, agents.opencode)).toEqual(['.opencode'])
  expect(await folderConfig(folder, agents.codex)).toEqual([])
  rmSync(folder, { recursive: true })
})
