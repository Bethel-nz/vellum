// Everything that differs between macOS, Windows and Linux, in one place. macOS is the first
// target; the other two get the nearest native equivalent, or a quiet fallback where there is
// none (no picture → a monogram, no PTY → a console window of its own).
//
//   keys       ⌘ on macOS, Ctrl elsewhere; labels are written the macOS way and translated
//   clipboard  pbcopy/pbpaste · PowerShell Set-/Get-Clipboard · wl-copy/xclip/xsel
//   folders    open · explorer · xdg-open
//   shell      $SHELL -lc · %ComSpec% /d /s /c
//   PTY        Bun's PTY is POSIX only, so on Windows interactive `claude` opens in a console

import { appendFileSync, closeSync, copyFileSync, existsSync, linkSync, mkdirSync, openSync, readFileSync, statSync, symlinkSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import path from 'node:path'

export type OS = 'mac' | 'windows' | 'linux'
export const os: OS = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'linux'
export const isMac = os === 'mac'
/**
 * Running as the compiled Vellum binary (scripts/build-app.ts) rather than from source. There is
 * no Bun beside it to run a script, so it runs its own parts instead (bin.ts).
 */
export const compiled = /^(\/\$bunfs|B:\\~BUN)/.test(import.meta.dir)

type Mods = { shift?: boolean; ctrl?: boolean; alt?: boolean; cmd?: boolean } | undefined

/** The app's command key is held: ⌘ on macOS, Ctrl elsewhere (GPUIX's `cmd` is Super/Win there). */
export function primary(mods: Mods): boolean {
  return Boolean(isMac ? mods?.cmd : mods?.ctrl && !mods.cmd)
}

/** Inside a terminal, Ctrl belongs to the program, so outside macOS the app's keys there are Ctrl+Shift. */
export function terminalPrimary(mods: Mods): boolean {
  return Boolean(isMac ? mods?.cmd : mods?.ctrl && mods.shift)
}

/** -1 / 1 when the key steps through tabs: ⌃← ⌃→ on macOS, Ctrl+PgUp/PgDn elsewhere (Ctrl+arrows move by word there). */
export function tabStep(key: string, mods: Mods): -1 | 0 | 1 {
  if (!mods?.ctrl || mods.cmd || mods.alt) return 0
  if (isMac) return key === 'left' || key === 'arrowleft' ? -1 : key === 'right' || key === 'arrowright' ? 1 : 0
  return key === 'pageup' ? -1 : key === 'pagedown' ? 1 : 0
}

/** Leaves a focused terminal: ⌘Esc on macOS; Ctrl+` elsewhere, where Ctrl+Esc opens the Start menu. */
export function isTerminalLeave(key: string, mods: Mods): boolean {
  return isMac ? Boolean(mods?.cmd) && key === 'escape' : Boolean(mods?.ctrl) && (key === '`' || key === 'backquote')
}

const GLYPH: Record<string, string> = { '⌃': 'Ctrl', '⌥': 'Alt', '⇧': 'Shift', '⌘': 'Ctrl' }
const KEY: Record<string, string> = { '↵': 'Enter', '↩': 'Enter', '⌫': 'Backspace', Esc: 'Esc' }

/**
 * A shortcut label written the macOS way ("⇧⌘W", "⌘↵", "⌃N ⌃P"), as this platform spells it
 * ("Ctrl+Shift+W", "Ctrl+Enter"). Text around the shortcut is left alone.
 */
export function keys(label: string): string {
  if (isMac) return label
  return label
    .replace(/⌘Esc/g, 'Ctrl+`')
    .replace(/([⌃⌥⇧⌘]+)(Esc|↵|↩|⌫|[A-Z0-9.,[\]`/]|↑|↓|←|→)?/g, (_, mods: string, key?: string) => {
      const names = [...new Set([...mods].map((g) => GLYPH[g]!))].sort((a, b) => order(a) - order(b))
      return [...names, ...(key ? [KEY[key] ?? key] : [])].join('+')
    })
}
const order = (m: string) => ['Ctrl', 'Alt', 'Shift'].indexOf(m)

// ---------------------------------------------------------------- clipboard

function firstAvailable(cands: string[][]): string[] | undefined {
  return cands.find((c) => Bun.which(c[0]!))
}

const copyCommand = () =>
  os === 'mac'
    ? ['pbcopy']
    : os === 'windows'
      ? ['powershell', '-NoProfile', '-NonInteractive', '-Command', 'Set-Clipboard -Value ([Console]::In.ReadToEnd())']
      : firstAvailable([
          ...(process.env.WAYLAND_DISPLAY ? [['wl-copy']] : []),
          ['xclip', '-selection', 'clipboard'],
          ['xsel', '--clipboard', '--input'],
        ])

const pasteCommand = () =>
  os === 'mac'
    ? ['pbpaste']
    : os === 'windows'
      ? ['powershell', '-NoProfile', '-NonInteractive', '-Command', 'Get-Clipboard -Raw']
      : firstAvailable([
          ...(process.env.WAYLAND_DISPLAY ? [['wl-paste', '--no-newline']] : []),
          ['xclip', '-selection', 'clipboard', '-o'],
          ['xsel', '--clipboard', '--output'],
        ])

/** Put text on the system clipboard (GPUIX has no clipboard API yet). False when nothing can. */
export function copyText(text: string): boolean {
  const argv = copyCommand()
  if (!argv) return false
  try {
    Bun.spawn(argv, { stdin: new Blob([text]), stdout: 'ignore', stderr: 'ignore' })
    return true
  } catch {
    return false
  }
}

export function pasteText(): string {
  const argv = pasteCommand()
  if (!argv) return ''
  try {
    const text = Bun.spawnSync(argv, { stderr: 'ignore' }).stdout.toString()
    return os === 'windows' ? text.replace(/\r\n$/, '') : text
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------- folders, shells, claude

export const revealLabel = os === 'mac' ? 'Show folder in Finder' : os === 'windows' ? 'Show folder in Explorer' : 'Open folder'

export function revealFolder(dir: string) {
  const argv = os === 'mac' ? ['open', dir] : os === 'windows' ? ['explorer', dir] : ['xdg-open', dir]
  try {
    Bun.spawn(argv, { stdout: 'ignore', stderr: 'ignore' })
  } catch {}
}

/** Shows a file selected in Finder (elsewhere, its folder). Checks set VELLUM_OPEN_LOG to see it instead. */
export function revealFile(file: string) {
  const log = process.env.VELLUM_OPEN_LOG
  if (log) return appendFileSync(log, JSON.stringify({ reveal: file }) + '\n')
  if (os !== 'mac') return revealFolder(path.dirname(file))
  try {
    Bun.spawn(['open', '-R', file], { stdout: 'ignore', stderr: 'ignore' })
  } catch {}
}

/** argv that runs one command line in the person's shell, the way they'd type it. */
export function shellArgv(command: string): string[] {
  if (os === 'windows') return [process.env.ComSpec ?? 'cmd.exe', '/d', '/s', '/c', command]
  return [process.env.SHELL ?? (os === 'mac' ? '/bin/zsh' : '/bin/sh'), '-lc', command]
}

/**
 * The PATH your login shell sets up. An app opened from Finder or the Dock gets launchd's bare
 * one, with no `claude`, no Homebrew and no version managers. Undefined when the shell can't say.
 */
export function loginShellPath(): string | undefined {
  if (os === 'windows') return undefined
  const mark = '__vellum_path__'
  const shell = process.env.SHELL ?? (os === 'mac' ? '/bin/zsh' : '/bin/sh')
  // Interactive too: most people extend PATH in ~/.zshrc, not ~/.zprofile.
  const r = Bun.spawnSync([shell, '-ilc', `printf '${mark}%s${mark}' "$PATH"`], { stdin: 'ignore', stderr: 'ignore', timeout: 5000 })
  return r.stdout.toString().match(new RegExp(`${mark}(.+)${mark}`))?.[1]
}

/** Bun's PTY is POSIX only; on Windows a spawn with `terminal` fails with ENOTSUP. */
export const hasPty = os !== 'windows'

let claudePath: string | undefined
/** The official binary, resolved once (on Windows through PATHEXT, so claude.exe or claude.cmd). */
export function claudeBin(): string {
  return (claudePath ??= Bun.which('claude') ?? 'claude')
}

/**
 * Windows only: run an interactive program in a console window of its own, since there is no PTY
 * to host it inline. The console inherits `env`, so CLAUDE_CONFIG_DIR still picks the profile.
 */
export function openConsole(argv: string[], cwd: string, env: Record<string, string>) {
  // cmd.exe parses this line again, so only plain words (paths, flags, session ids) may pass.
  if (argv.slice(1).some((a) => !/^[\w.:\\/-]+$/.test(a))) throw new Error('openConsole: refusing an argument cmd.exe would re-parse')
  // `start` takes the window title as its first quoted argument.
  return Bun.spawn([process.env.ComSpec ?? 'cmd.exe', '/d', '/c', 'start', 'Claude Code', '/wait', ...argv], { cwd, env, stdout: 'ignore', stderr: 'ignore' })
}

/**
 * Share one config file or folder into a profile. Windows needs admin rights (or Developer Mode)
 * for symlinks, so folders become junctions there and files fall back to a hard link.
 */
export function linkShared(target: string, link: string) {
  if (os !== 'windows') return symlinkSync(target, link)
  if (statSync(target).isDirectory()) return symlinkSync(target, link, 'junction')
  try {
    symlinkSync(target, link, 'file')
  } catch {
    linkSync(target, link)
  }
}

// ---------------------------------------------------------------- appearance

function read(argv: string[]): string | undefined {
  try {
    const out = Bun.spawnSync(argv, { stderr: 'ignore' })
    return out.exitCode === 0 ? out.stdout.toString().trim() : undefined
  } catch {
    return
  }
}

/** Light or dark, read once at startup. */
export function systemAppearance(): 'dark' | 'light' {
  if (os === 'mac') return read(['defaults', 'read', '-g', 'AppleInterfaceStyle']) === 'Dark' ? 'dark' : 'light'
  if (os === 'windows') {
    const out = read(['reg', 'query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', '/v', 'AppsUseLightTheme'])
    return out ? (/0x0\b/.test(out) ? 'dark' : 'light') : 'dark'
  }
  const scheme = read(['gsettings', 'get', 'org.gnome.desktop.interface', 'color-scheme'])
  if (scheme) return scheme.includes('dark') ? 'dark' : 'light'
  const gtk = read(['gsettings', 'get', 'org.gnome.desktop.interface', 'gtk-theme'])
  return gtk && !/dark/i.test(gtk) ? 'light' : 'dark'
}

/** The system's reduce-motion switch, where one can be read without a native call. */
export function systemReduceMotion(): boolean {
  if (os === 'mac') return read(['defaults', 'read', 'com.apple.universalaccess', 'reduceMotion']) === '1'
  if (os === 'linux') return read(['gsettings', 'get', 'org.gnome.desktop.interface', 'enable-animations']) === 'false'
  // Windows keeps "Show animations" behind SystemParametersInfo; the settings sheet can override.
  return false
}

// ---------------------------------------------------------------- who you are

/** The full name the system knows you by, or your user name. */
export function realName(): string {
  const user = userInfo().username
  if (os === 'mac') return read(['dscl', '.', '-read', `/Users/${user}`, 'RealName'])?.replace(/^RealName:\s*/, '').trim() || user
  if (os === 'linux') {
    // GECOS: "Full Name,room,phone,…"
    const gecos = read(['getent', 'passwd', user])?.split(':')[4]?.split(',')[0]?.trim()
    return gecos || user
  }
  return user
}

/**
 * Your account picture, as JPEG/PNG bytes or a file. macOS: the directory service, no permission
 * prompt. Linux: ~/.face or AccountsService's copy. Windows keeps it in a .accountpicture-ms
 * container, so there the profile's own image or the monogram stands in.
 */
export function accountPicture(): { bytes: Buffer } | { file: string } | undefined {
  const user = userInfo().username
  if (os === 'mac') {
    const out = read(['dscl', '.', '-read', `/Users/${user}`, 'JPEGPhoto'])
    // "JPEGPhoto:" on the first line, then the bytes as spaced hex.
    const hex = out?.split('\n').slice(1).join('').replace(/\s+/g, '')
    if (!hex || !/^ffd8ff/i.test(hex) || hex.length % 2) return
    return { bytes: Buffer.from(hex, 'hex') }
  }
  if (os === 'linux') {
    for (const file of [path.join(homedir(), '.face'), path.join(homedir(), '.face.icon'), `/var/lib/AccountsService/icons/${user}`]) {
      try {
        if (existsSync(file) && isImage(readFileSync(file).subarray(0, 8))) return { file }
      } catch {}
    }
  }
  return
}

function isImage(head: Buffer) {
  return (head[0] === 0xff && head[1] === 0xd8) || head.toString('latin1', 1, 4) === 'PNG'
}

// ---------------------------------------------------------------- images on the clipboard

const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i

/**
 * The image on the clipboard, saved as a file in `dir`; undefined when there is none. A copied
 * image file (Finder, Explorer) is copied as is; image data is written as PNG. macOS asks
 * AppleScript, Linux wl-paste or xclip, Windows PowerShell's clipboard.
 */
export async function pasteImage(dir: string): Promise<string | undefined> {
  mkdirSync(dir, { recursive: true })
  // Self-checks paste a known file instead of touching the real clipboard.
  if (process.env.VELLUM_PASTE_IMAGE) return existsSync(process.env.VELLUM_PASTE_IMAGE) ? copyInto(process.env.VELLUM_PASTE_IMAGE, dir) : undefined
  const out = path.join(dir, `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}.png`)
  const run = async (argv: string[], stdout: 'pipe' | number = 'pipe') => {
    try {
      const p = Bun.spawn(argv, { stdout, stderr: 'ignore' })
      const text = stdout === 'pipe' ? await new Response(p.stdout as ReadableStream).text() : ''
      return { ok: (await p.exited) === 0, text: text.trim() }
    } catch {
      return { ok: false, text: '' }
    }
  }
  const saved = () => existsSync(out) && statSync(out).size > 0 ? out : undefined

  if (os === 'mac') {
    const r = await run([
      'osascript',
      '-e', 'try',
      '-e', 'return POSIX path of (the clipboard as «class furl»)',
      '-e', 'end try',
      '-e', 'try',
      '-e', 'set d to (the clipboard as «class PNGf»)',
      '-e', 'on error',
      '-e', 'return ""',
      '-e', 'end try',
      '-e', `set f to open for access (POSIX file "${out}") with write permission`,
      '-e', 'set eof f to 0',
      '-e', 'write d to f',
      '-e', 'close access f',
      '-e', 'return "png"',
    ])
    if (r.text && r.text !== 'png') return IMAGE_EXT.test(r.text) && existsSync(r.text) ? copyInto(r.text, dir) : undefined
    return saved()
  }
  if (os === 'linux') {
    const wayland = Boolean(process.env.WAYLAND_DISPLAY) && Bun.which('wl-paste')
    const types = wayland ? await run(['wl-paste', '--list-types']) : Bun.which('xclip') ? await run(['xclip', '-selection', 'clipboard', '-t', 'TARGETS', '-o']) : { ok: false, text: '' }
    if (!types.ok) return
    if (types.text.split('\n').includes('image/png')) {
      const fd = openSync(out, 'w')
      await run(wayland ? ['wl-paste', '--type', 'image/png'] : ['xclip', '-selection', 'clipboard', '-t', 'image/png', '-o'], fd)
      closeSync(fd)
      return saved()
    }
    const uri = types.text.split('\n').includes('text/uri-list') ? (await run(wayland ? ['wl-paste', '--type', 'text/uri-list'] : ['xclip', '-selection', 'clipboard', '-t', 'text/uri-list', '-o'])).text.split('\n')[0] : ''
    const file = uri?.startsWith('file://') ? decodeURIComponent(uri.slice(7)) : ''
    return IMAGE_EXT.test(file) && existsSync(file) ? copyInto(file, dir) : undefined
  }
  const r = await run([
    'powershell', '-NoProfile', '-NonInteractive', '-STA', '-Command',
    `Add-Type -AssemblyName System.Windows.Forms; $f = [System.Windows.Forms.Clipboard]::GetFileDropList(); if ($f.Count -gt 0) { $f[0] } else { $i = [System.Windows.Forms.Clipboard]::GetImage(); if ($i) { $i.Save('${out}', [System.Drawing.Imaging.ImageFormat]::Png); 'png' } }`,
  ])
  if (r.text && r.text !== 'png') return IMAGE_EXT.test(r.text) && existsSync(r.text) ? copyInto(r.text, dir) : undefined
  return saved()
}

function copyInto(file: string, dir: string): string {
  const to = path.join(dir, `${Date.now().toString(36)}-${path.basename(file)}`)
  copyFileSync(file, to)
  return to
}

/** The MIME type the agent needs for an image file. */
export function imageMime(file: string): string {
  const ext = path.extname(file).slice(1).toLowerCase()
  return ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/png'
}
