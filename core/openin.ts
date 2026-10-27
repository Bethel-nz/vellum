// "Open in": the apps on this Mac that can open a note's folder (Finder, editors, terminals, git
// clients), each with its own icon, and how to open the folder in each.
//
// Apps are found by bundle name in the usual folders, not through Spotlight, so a machine with
// indexing off still finds them. Icons come from each bundle's .icns, converted once with sips and
// kept under ~/.vellum/cache/app-icons. macOS only for now; elsewhere there is only the file manager.

// App bundles and the icon folder are folders, and the log appends: node:fs's work. Files are Bun.file's.
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { os, revealFolder, revealLabel } from './platform'
import { paths } from './store'

export type OpenTarget = {
  id: string
  name: string
  kind: 'files' | 'editor' | 'terminal' | 'git'
  /** The .app, when it's an app. */
  app?: string
}

type Known = { id: string; name: string; kind: OpenTarget['kind']; bundle: string; args?: (dir: string) => string[] }

// Order is the menu's order within each kind.
const KNOWN: Known[] = [
  { id: 'finder', name: 'Finder', kind: 'files', bundle: 'Finder.app' },
  { id: 'zed', name: 'Zed', kind: 'editor', bundle: 'Zed.app' },
  { id: 'zed-preview', name: 'Zed Preview', kind: 'editor', bundle: 'Zed Preview.app' },
  { id: 'cursor', name: 'Cursor', kind: 'editor', bundle: 'Cursor.app' },
  { id: 'vscode', name: 'VS Code', kind: 'editor', bundle: 'Visual Studio Code.app' },
  { id: 'windsurf', name: 'Windsurf', kind: 'editor', bundle: 'Windsurf.app' },
  { id: 'sublime', name: 'Sublime Text', kind: 'editor', bundle: 'Sublime Text.app' },
  { id: 'nova', name: 'Nova', kind: 'editor', bundle: 'Nova.app' },
  { id: 'xcode', name: 'Xcode', kind: 'editor', bundle: 'Xcode.app' },
  { id: 'intellij', name: 'IntelliJ IDEA', kind: 'editor', bundle: 'IntelliJ IDEA.app' },
  { id: 'intellij-ce', name: 'IntelliJ IDEA CE', kind: 'editor', bundle: 'IntelliJ IDEA CE.app' },
  { id: 'webstorm', name: 'WebStorm', kind: 'editor', bundle: 'WebStorm.app' },
  { id: 'pycharm', name: 'PyCharm', kind: 'editor', bundle: 'PyCharm.app' },
  { id: 'goland', name: 'GoLand', kind: 'editor', bundle: 'GoLand.app' },
  { id: 'rustrover', name: 'RustRover', kind: 'editor', bundle: 'RustRover.app' },
  { id: 'datagrip', name: 'DataGrip', kind: 'editor', bundle: 'DataGrip.app' },
  { id: 'android-studio', name: 'Android Studio', kind: 'editor', bundle: 'Android Studio.app' },
  { id: 'terminal', name: 'Terminal', kind: 'terminal', bundle: 'Terminal.app' },
  { id: 'iterm', name: 'iTerm', kind: 'terminal', bundle: 'iTerm.app' },
  { id: 'ghostty', name: 'Ghostty', kind: 'terminal', bundle: 'Ghostty.app' },
  { id: 'warp', name: 'Warp', kind: 'terminal', bundle: 'Warp.app' },
  // These don't take a folder from `open`; they're told the directory instead.
  { id: 'wezterm', name: 'WezTerm', kind: 'terminal', bundle: 'WezTerm.app', args: (dir) => ['start', '--cwd', dir] },
  { id: 'kitty', name: 'kitty', kind: 'terminal', bundle: 'kitty.app', args: (dir) => ['--directory', dir] },
  { id: 'alacritty', name: 'Alacritty', kind: 'terminal', bundle: 'Alacritty.app', args: (dir) => ['--working-directory', dir] },
  { id: 'tower', name: 'Tower', kind: 'git', bundle: 'Tower.app' },
  { id: 'fork', name: 'Fork', kind: 'git', bundle: 'Fork.app' },
  { id: 'github-desktop', name: 'GitHub Desktop', kind: 'git', bundle: 'GitHub Desktop.app' },
]

const SEARCH = [
  '/Applications',
  path.join(homedir(), 'Applications'),
  path.join(homedir(), 'Applications', 'JetBrains Toolbox'),
  '/Applications/Setapp',
  '/System/Applications',
  '/System/Applications/Utilities',
  '/System/Library/CoreServices',
]

let found: OpenTarget[] | undefined

/** The apps that can open a folder here, Finder first. Looked up once per launch. */
export function openTargets(): OpenTarget[] {
  if (found) return found
  if (os !== 'mac') return (found = [{ id: 'files', name: revealLabel, kind: 'files' }])
  found = []
  for (const k of KNOWN) {
    const app = SEARCH.map((dir) => path.join(dir, k.bundle)).find((p) => existsSync(p))
    if (app) found.push({ id: k.id, name: k.name, kind: k.kind, app })
  }
  return found
}

/** Open `dir` in the target. */
export function openIn(target: OpenTarget, dir: string) {
  const known = KNOWN.find((k) => k.id === target.id)
  const argv = !target.app || target.id === 'finder' ? undefined : known?.args ? ['open', '-na', target.app, '--args', ...known.args(dir)] : ['open', '-a', target.app, dir]
  // Checks set this to see what would open, without opening apps on the desktop.
  const log = process.env.VELLUM_OPEN_LOG
  if (log) return appendFileSync(log, JSON.stringify({ target: target.id, dir, argv }) + '\n')
  if (!argv) return revealFolder(dir)
  Bun.spawn(argv, { stdio: ['ignore', 'ignore', 'ignore'] })
}

const iconDir = () => path.join(paths.home, 'cache', 'app-icons')
const pending = new Map<string, Promise<string | undefined>>()

/** A 64px PNG of the app's icon, made once from its .icns; undefined if it has none. */
export function appIcon(target: OpenTarget): Promise<string | undefined> {
  const app = target.app
  if (!app) return Promise.resolve(undefined)
  const cached = pending.get(app)
  if (cached) return cached
  const job = (async () => {
    const plist = path.join(app, 'Contents', 'Info.plist')
    const name = (await Bun.$`plutil -extract CFBundleIconFile raw ${plist}`.quiet().nothrow().text()).trim()
    if (!name) return undefined
    const icns = path.join(app, 'Contents', 'Resources', name.endsWith('.icns') ? name : `${name}.icns`)
    const source = Bun.file(icns)
    if (!(await source.exists())) return undefined
    mkdirSync(iconDir(), { recursive: true })
    // Named by the .icns's mtime too, so an app update brings its new icon.
    const png = path.join(iconDir(), `${target.id}-${Math.floor(source.lastModified)}.png`)
    if (!(await Bun.file(png).exists())) await Bun.$`sips -s format png -Z 64 ${icns} --out ${png}`.quiet().nothrow()
    return (await Bun.file(png).exists()) ? png : undefined
  })()
  pending.set(app, job)
  return job
}
