// Which Nerd Font, if any, this machine has. File-type icons need one (GPUIX draws private-use
// glyphs only from a <text> that names the font itself), and the terminal grid prefers the SF Mono
// build so its cells line up with the Ghostty theme. Nothing is bundled: a machine without one
// gets plain file icons and the terminal in Geist Mono.
//
// Font files are found by name ("*Nerd*"), then their family is read from the `name` table.

import { closeSync, existsSync, openSync, readdirSync, readSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { os } from './platform'

const PREFERRED = 'Liga SFMono Nerd Font'

function fontDirs(): string[] {
  const home = homedir()
  if (os === 'mac') return [path.join(home, 'Library/Fonts'), '/Library/Fonts']
  if (os === 'windows') {
    return [path.join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts'), path.join(process.env.LOCALAPPDATA ?? path.join(home, 'AppData/Local'), 'Microsoft/Windows/Fonts')]
  }
  return [path.join(home, '.local/share/fonts'), path.join(home, '.fonts'), '/usr/share/fonts', '/usr/local/share/fonts']
}

function nerdFiles(dir: string, depth = 3, out: string[] = []): string[] {
  if (depth < 0 || !existsSync(dir)) return out
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) nerdFiles(p, depth - 1, out)
    else if (/nerd/i.test(e.name) && /\.(ttf|otf)$/i.test(e.name)) out.push(p)
  }
  return out
}

/** The family name (nameID 16, else 1) of a TrueType/OpenType file, reading only its `name` table. */
export function familyOf(file: string): string | undefined {
  let fd: number | undefined
  try {
    fd = openSync(file, 'r')
    const at = (pos: number, len: number) => {
      const b = Buffer.alloc(len)
      readSync(fd!, b, 0, len, pos)
      return b
    }
    const tables = at(4, 2).readUInt16BE(0)
    const dir = at(12, 16 * tables)
    let offset = -1
    let length = 0
    for (let i = 0; i < tables; i++) {
      if (dir.toString('latin1', 16 * i, 16 * i + 4) !== 'name') continue
      offset = dir.readUInt32BE(16 * i + 8)
      length = dir.readUInt32BE(16 * i + 12)
    }
    if (offset < 0 || length > 1 << 20) return
    const d = at(offset, length)
    const count = d.readUInt16BE(2)
    const strings = d.readUInt16BE(4)
    const found: Record<number, string> = {}
    for (let i = 0; i < count; i++) {
      const r = 6 + 12 * i
      const [platform, , , id, len, off] = [0, 2, 4, 6, 8, 10].map((o) => d.readUInt16BE(r + o)) as [number, number, number, number, number, number]
      if ((id !== 1 && id !== 16) || found[id]) continue
      const raw = Buffer.from(d.subarray(strings + off, strings + off + len))
      // Windows and Unicode platforms store UTF-16BE; Mac Roman is close enough to latin1 here.
      found[id] = platform === 3 || platform === 0 ? raw.swap16().toString('utf16le') : raw.toString('latin1')
    }
    return found[16] ?? found[1]
  } catch {
    return
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

let cached: string | null | undefined
/** A Nerd Font family installed on this machine, the SF Mono build first; undefined when none is. */
export function nerdFamily(): string | undefined {
  if (cached !== undefined) return cached ?? undefined
  const families = new Set<string>()
  for (const dir of fontDirs()) for (const f of nerdFiles(dir)) {
    const fam = familyOf(f)
    if (fam) families.add(fam)
  }
  cached = families.has(PREFERRED) ? PREFERRED : ([...families].find((f) => /Nerd Font Mono$/.test(f)) ?? [...families][0] ?? null)
  return cached ?? undefined
}

export const preferredTerminalFamily = PREFERRED
