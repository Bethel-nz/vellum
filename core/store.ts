// Where Vellum keeps its files, plus the tiny settings file.
//
//   ~/.vellum/
//     settings.json
//     profiles.json
//     shared/                      settings.json, CLAUDE.md, skills/, agents/, commands/
//     profiles/<id>/claude/        CLAUDE_CONFIG_DIR for that profile
//     threads/<id>.jsonl           raw events, append-only, source of truth
//     threads/<id>.md              readable transcript, rewritten on change

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

export const home = process.env.VELLUM_HOME ?? path.join(homedir(), '.vellum')
export const paths = {
  home,
  settings: path.join(home, 'settings.json'),
  profiles: path.join(home, 'profiles.json'),
  shared: path.join(home, 'shared'),
  profileDir: (id: string) => path.join(home, 'profiles', id, 'claude'),
  threads: path.join(home, 'threads'),
}

for (const dir of [home, paths.shared, paths.threads]) mkdirSync(dir, { recursive: true })

export function readJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

export function writeJson(file: string, value: unknown) {
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
}

export type Settings = {
  /** Manual material override from Cmd+Shift+L. Unset follows macOS. */
  material?: 'smoke' | 'frost'
  lastThreadId?: string
}

export function readSettings(): Settings {
  return readJson<Settings>(paths.settings, {})
}

export function updateSettings(patch: Partial<Settings>) {
  writeJson(paths.settings, { ...readSettings(), ...patch })
}

/** macOS appearance, read once at startup. `defaults` prints "Dark" in dark mode and errors in light mode. */
export function systemAppearance(): 'dark' | 'light' {
  try {
    const out = Bun.spawnSync(['defaults', 'read', '-g', 'AppleInterfaceStyle'], { stderr: 'ignore' })
    return out.stdout.toString().trim() === 'Dark' ? 'dark' : 'light'
  } catch {
    return 'dark'
  }
}
