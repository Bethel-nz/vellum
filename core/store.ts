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

// Reading is Bun.file's. Folders are node:fs's, and so is writing state: Bun.write is async only,
// and a quit right after a change (⌘Q with a draft half written) must not lose it.
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
  queues: path.join(home, 'queues.json'),
  /** Images pasted into notes; a note's records point at them. */
  images: path.join(home, 'images'),
  captures: path.join(home, 'captures'),
  bridge: path.join(home, 'bridge.json'),
}

for (const dir of [home, paths.threads]) mkdirSync(dir, { recursive: true })

/** A JSON file's value, or `fallback` when it's missing or unreadable. */
export async function loadJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return (await Bun.file(file).json()) as T
  } catch {
    return fallback
  }
}

/** loadJson for the few callers that still can't wait (core/captures.ts, core/bridge.ts). */
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
  /** First-run setup was completed or explicitly skipped. */
  onboardingComplete?: boolean
  /** Project folders whose hooks, MCP servers or plugins you've let run (core/agents.ts `projectConfig`). */
  trustedFolders?: string[]
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
  /** One mobile pane and selected simulator shared by every note. */
  mobileView?: boolean
  mobileDevice?: string
  /** Snapshot bridge port; unset discovers a free port in the default range. Applies at launch. */
  browserPort?: number
  /** Advanced launch options, read only when starting the next browser generation. */
  browserLaunch?: { proxy?: string; initScripts?: string[]; enable?: string[]; webgpu?: boolean }
  /** Explicit local CDP discovery ports. Never accepted from model arguments. */
  browserCdpPorts?: number[]
  /** Include model-provided thinking in the note. Off keeps tool activity concise. */
  showThoughts?: boolean
  /** The mobile pane's width once dragged (unset follows the window). */
  mobileWidth?: number
  /** The file pane's file side and its tree, once dragged wider or narrower. */
  previewWidth?: number
  fileTreeWidth?: number
  /** What a new note starts with; unset is Edits and the agent's own effort. */
  newNoteMode?: PermissionMode
  newNoteThink?: Think
  /** The default account for new notes; unset follows the current note or the project's account. */
  newNoteProfile?: string
  /** At launch: the note you had open, or a new one. */
  atLaunch?: 'last' | 'new'
  /** The Help note has opened once, at the first launch (core/help.ts). */
  helpShown?: boolean
  /** Your own words for Claude, after what Vellum tells it (core/prompt.ts). */
  instructions?: string
  /** Desktop alerts while the window is unfocused: none, requests/errors, or also replies. */
  notify?: 'off' | 'asks' | 'all'
  /** Local active-time and agent-runtime counters, paused when false. */
  activityTracking?: boolean
  lastThreadId?: string
  /** Project shown when no note is open, and the last active note in each project. */
  lastProject?: string
  lastProjectNotes?: Record<string, string>
  /** Thread ids open as tabs, in order. */
  openTabs?: string[]
}

// Read once, before anything renders; Vellum is the only writer while it runs.
let settings = await loadJson<Settings>(paths.settings, {})

export function readSettings(): Settings {
  return { ...settings }
}

export function updateSettings(patch: Partial<Settings>) {
  settings = { ...settings, ...patch }
  writeJson(paths.settings, settings)
}

/** Light or dark, read once at startup (core/platform.ts asks each OS its own way). */
export { systemAppearance } from './platform'
