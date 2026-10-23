// File-type icons from the SF Mono Nerd Font (seti and devicons glyphs), tinted from the
// material's ANSI and syntax colours so they follow the theme. GPUIX draws private-use glyphs
// only when the <text> names the Nerd Font itself (spikes/nerd-icons.tsx); anything unknown
// falls back to a plain file glyph.

import { font, type Material } from '../ui/theme'
import { useM } from './theme'

type Tone = 'blue' | 'cyan' | 'yellow' | 'orange' | 'green' | 'red' | 'pink' | 'muted'

const FILE: [number, Tone] = [0xf4a5, 'muted']

const byExt: Record<string, [number, Tone]> = {
  ts: [0xe628, 'blue'], mts: [0xe628, 'blue'], cts: [0xe628, 'blue'],
  tsx: [0xe7ba, 'cyan'], jsx: [0xe7ba, 'cyan'],
  js: [0xe60c, 'yellow'], mjs: [0xe60c, 'yellow'], cjs: [0xe60c, 'yellow'],
  json: [0xe60b, 'yellow'], jsonl: [0xe60b, 'yellow'],
  md: [0xe73e, 'muted'], mdx: [0xe73e, 'muted'],
  rs: [0xe7a8, 'orange'],
  py: [0xe606, 'blue'],
  swift: [0xe755, 'orange'],
  go: [0xe627, 'cyan'],
  sh: [0xf489, 'green'], zsh: [0xf489, 'green'], bash: [0xf489, 'green'], fish: [0xf489, 'green'],
  css: [0xe614, 'blue'], scss: [0xe614, 'pink'],
  html: [0xe60e, 'red'],
  toml: [0xe615, 'muted'], yml: [0xe615, 'muted'], yaml: [0xe615, 'muted'], ini: [0xe615, 'muted'], conf: [0xe615, 'muted'],
  lock: [0xf023, 'muted'], lockb: [0xf023, 'muted'],
  png: [0xe60d, 'pink'], jpg: [0xe60d, 'pink'], jpeg: [0xe60d, 'pink'], gif: [0xe60d, 'pink'], svg: [0xe60d, 'pink'], webp: [0xe60d, 'pink'],
}

const byName: Record<string, [number, Tone]> = {
  '.gitignore': [0xe702, 'orange'], '.gitattributes': [0xe702, 'orange'], '.gitmodules': [0xe702, 'orange'],
  'package.json': [0xe60b, 'green'], 'tsconfig.json': [0xe628, 'blue'],
}

function tone(m: Material, t: Tone) {
  switch (t) {
    case 'blue': return m.ansi[4]
    case 'cyan': return m.ansi[6]
    case 'yellow': return m.ansi[3]
    case 'orange': return m.syntax.function
    case 'green': return m.ansi[2]
    case 'red': return m.ansi[1]
    case 'pink': return m.syntax.link
    case 'muted': return m.textMuted
  }
}

export function fileGlyph(path: string): [number, Tone] {
  const name = path.split('/').pop() ?? path
  // Own keys only: a file called `constructor` must not resolve to Object.prototype's.
  if (Object.hasOwn(byName, name)) return byName[name]!
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  return Object.hasOwn(byExt, ext) ? byExt[ext]! : FILE
}

/** A file-type glyph sized like an Icon. `muted` drops the colour, for dense rows. */
export function FileIcon({ path, size = 13, muted }: { path: string; size?: number; muted?: boolean }) {
  const m = useM()
  const [code, t] = fileGlyph(path)
  return (
    <text style={{ fontFamily: font.term, fontSize: size, lineHeight: size + 2, width: size + 1, textAlign: 'center', flexShrink: 0, color: muted ? m.textMuted : tone(m, t) }}>
      {String.fromCodePoint(code)}
    </text>
  )
}
