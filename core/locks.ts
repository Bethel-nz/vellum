// One writer per session. Accounts share Claude's session history, so two processes (two accounts,
// or Vellum and a terminal) could append to the same session file at once and tangle it. Before a
// session is resumed, nothing else may hold it:
//
//   1. Claude's own registry: every live claude process writes <config>/sessions/<pid>.json with
//      its sessionId and procStart (seen on 2.1.296–2.1.309: CLI, SDK, Claude Desktop). A record
//      counts only while its pid is alive and started when the record says, so a reused pid is
//      not mistaken for the old process.
//   2. Vellum's lock, ~/.vellum/locks/<sessionId>, created exclusively and naming the Vellum pid,
//      so two Vellum windows can't both drive one session.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { paths } from './store'

export type Holder = { pid: number; where: string }

const lockDir = () => path.join(paths.home, 'locks')
const lockFile = (sessionId: string) => path.join(lockDir(), `${sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')}`)

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e: any) {
    return e?.code === 'EPERM'
  }
}

/** When `pid` started, as `ps -o lstart=` prints it (the format Claude stores as procStart). */
function startedAt(pid: number): string | undefined {
  if (process.platform === 'win32') return
  const out = Bun.spawnSync(['ps', '-o', 'lstart=', '-p', String(pid)]).stdout.toString().trim()
  return out ? out.replace(/\s+/g, ' ') : undefined
}

function describeEntry(e: any): string {
  const by: Record<string, string> = { cli: 'a terminal', 'sdk-cli': 'an SDK host', 'sdk-ts': 'an SDK host', 'claude-desktop': 'Claude Desktop', 'claude-vscode': 'VS Code' }
  return by[String(e?.entrypoint)] ?? (e?.entrypoint ? String(e.entrypoint) : 'another Claude process')
}

/**
 * A live process other than `except` that has `sessionId` open, looking in every config dir's
 * registry (an account's own and ~/.claude).
 */
export function liveHolder(sessionId: string, configDirs: (string | null)[], except: Set<number> = new Set()): Holder | undefined {
  const dirs = new Set(configDirs.map((d) => d ?? path.join(homedir(), '.claude')))
  for (const dir of dirs) {
    const reg = path.join(dir, 'sessions')
    if (!existsSync(reg)) continue
    for (const f of readdirSync(reg)) {
      if (!f.endsWith('.json')) continue
      let e: any
      try {
        e = JSON.parse(readFileSync(path.join(reg, f), 'utf8'))
      } catch {
        continue
      }
      if (e?.sessionId !== sessionId || typeof e.pid !== 'number' || except.has(e.pid) || !alive(e.pid)) continue
      const started = startedAt(e.pid)
      if (e.procStart && started && started !== String(e.procStart).replace(/\s+/g, ' ')) continue
      return { pid: e.pid, where: describeEntry(e) }
    }
  }
  const lock = readLock(sessionId)
  if (lock && lock.pid !== process.pid && alive(lock.pid)) return { pid: lock.pid, where: 'another Vellum window' }
}

function readLock(sessionId: string): { pid: number } | undefined {
  try {
    return JSON.parse(readFileSync(lockFile(sessionId), 'utf8'))
  } catch {
    return
  }
}

/** Take Vellum's lock on a session. False if another live Vellum holds it. */
export function acquire(sessionId: string, owner: { threadId: string; profileId: string }): boolean {
  mkdirSync(lockDir(), { recursive: true })
  const file = lockFile(sessionId)
  const body = JSON.stringify({ pid: process.pid, ...owner, at: new Date().toISOString() })
  try {
    writeFileSync(file, body, { flag: 'wx' })
    return true
  } catch {
    const held = readLock(sessionId)
    // Ours already, or left behind by a Vellum that is gone: take it over.
    if (!held || held.pid === process.pid || !alive(held.pid)) {
      writeFileSync(file, body)
      return true
    }
    return false
  }
}

export function release(sessionId: string) {
  const held = readLock(sessionId)
  if (held?.pid === process.pid) rmSync(lockFile(sessionId), { force: true })
}
