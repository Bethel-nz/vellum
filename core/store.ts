// Where Vellum keeps its files, plus the tiny settings file.
//
//   ~/.vellum/
//     settings.json
//     profiles.json
//     profiles/<id>/claude/        CLAUDE_CONFIG_DIR for that profile (links into ~/.claude)
//     backups/<id>/                whatever a link replaced, before it was merged into ~/.claude
//     locks/<sessionId>            which Vellum window drives a session
//     threads/<id>.jsonl           raw events, append-only, source of truth
//     threads/<id>.md              readable transcript, rewritten on change

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import type { PermissionMode, Think } from './asks'

export const home = process.env.VELLUM_HOME ?? path.join(homedir(), '.vellum')
export const paths = {
  home,
  settings: path.join(home, 'settings.json'),
  profiles: path.join(home, 'profiles.json'),
  profileDir: (id: string) => path.join(home, 'profiles', id, 'claude'),
  threads: path.join(home, 'threads'),
  /** Unsent writing at the end of each note, so a quit (⌘Q, ⌘W) loses nothing. */
  drafts: path.join(home, 'drafts.json'),
  /** Images pasted into notes; a note's records point at them. */
  images: path.join(home, 'images'),
}

for (const dir of [home, paths.threads]) mkdirSync(dir, { recursive: true })

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
  /** dark (default) or light. Older files say groknight, smoke or frost (ui/theme.ts materialNamed). */
  material?: 'dark' | 'light' | 'groknight' | 'smoke' | 'frost'
  /** Tab strip: always shown, collapsed while writing, or hidden (⌘⇧T reveals). */
  tabs?: 'pinned' | 'auto' | 'hidden'
  /** Reduce motion: follow macOS, always reduce, or always animate. */
  motion?: 'system' | 'reduce' | 'full'
  /** The app "Open in" opens a note's folder in by default (core/openin.ts ids). */
  openIn?: string
  /** The file pane shows the folder's tree beside the file (⇧⌘E). */
  fileTree?: boolean
  /** What a new note starts with; unset is Edits and the agent's own effort. */
  newNoteMode?: PermissionMode
  newNoteThink?: Think
  /** The account the New note dialog starts on; unset is the open note's. A folder's own account still wins. */
  newNoteProfile?: string
  /** At launch: the note you had open, or a new one. */
  atLaunch?: 'last' | 'new'
  /** Your own words for Claude, after what Vellum tells it (core/prompt.ts). */
  instructions?: string
  /** macOS notifications while Vellum is in the background: none, when Claude needs you, or also when it's done. */
  notify?: 'off' | 'asks' | 'all'
  lastThreadId?: string
  /** Thread ids open as tabs, in order. */
  openTabs?: string[]
}

export function readSettings(): Settings {
  return readJson<Settings>(paths.settings, {})
}

export function updateSettings(patch: Partial<Settings>) {
  writeJson(paths.settings, { ...readSettings(), ...patch })
}

/** Light or dark, read once at startup (core/platform.ts asks each OS its own way). */
export { systemAppearance } from './platform'
