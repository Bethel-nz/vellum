// What the file preview shows (ui/FilePreview.tsx): a workspace file's text and how to show it.
// Markdown renders, with its source a toggle away; code highlights; JSON has a view of its own when
// one is registered, and reads as code until then; everything else is plain text. An image shows
// as itself, with its size; any other binary file as a hex dump of its first 4 KB, which is all
// that's read of it, whatever its size. Files are read under the same rules as diffs and tag
// slices (core/files.ts): inside the note's folder only, and never anything that looks like
// credentials. When a file can't be shown, the reason says why.

import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import path from 'node:path'
import { insideWorkspace } from './files'
import { imageSize, type Size } from './imagesize'

export type PreviewKind = 'markdown' | 'json' | 'code' | 'text' | 'image' | 'binary'

export type Preview =
  | { ok: true; abs: string; rel: string; kind: PreviewKind; text: string; lines: number; shown: number; bytes: number; size?: Size }
  | { ok: false; rel: string; reason: string }

/** Past this, a text file is too big to read into the pane at all. */
const MAX_BYTES = 4 * 1024 * 1024
/** Images are only drawn, not read here, so they can be bigger. */
const MAX_IMAGE_BYTES = 32 * 1024 * 1024
/** A binary file shows this much of its start. */
export const HEX_BYTES = 4096
const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico'])
/** Past this, only the first lines show: <code> builds a row per line. */
export const MAX_LINES = 5000

const MARKDOWN = new Set(['.md', '.markdown', '.mdx'])
const JSON_EXT = new Set(['.json', '.jsonc', '.json5', '.jsonl', '.ndjson'])
const TEXT = new Set(['.txt', '.text', '.log', '.csv', '.tsv', ''])
const TEXT_NAMES = new Set(['license', 'licence', 'readme', 'changelog', 'authors', 'notice', 'copying'])

export function previewKind(file: string): PreviewKind {
  const base = path.basename(file).toLowerCase()
  const ext = path.extname(base)
  if (IMAGE.has(ext)) return 'image'
  if (MARKDOWN.has(ext)) return 'markdown'
  if (JSON_EXT.has(ext)) return 'json'
  if (TEXT.has(ext) && (ext !== '' || TEXT_NAMES.has(base))) return 'text'
  // Dotfiles and extensionless scripts still read better highlighted: <code> picks by path.
  return 'code'
}

// Code highlighting covers a fixed set of grammars (bash, c, css, go, html, js and ts, json,
// markdown, python, rust, toml, yaml); everything else stays plain. A file of a type with no
// grammar borrows the nearest one, close enough for comments, strings and keywords; SQL and Lua
// have none near, so they stay plain. Undefined leaves the pick to <code>.
const BORROWED: Record<string, string> = {
  '.xml': 'html', '.svg': 'html', '.plist': 'html', '.xhtml': 'html', '.vue': 'html', '.svelte': 'html',
  '.env': 'bash', '.envrc': 'bash', '.zsh': 'bash', '.zshrc': 'bash', '.bashrc': 'bash', '.profile': 'bash', '.gitignore': 'bash', '.dockerignore': 'bash', '.gitattributes': 'bash', '.ini': 'bash', '.cfg': 'bash', '.conf': 'bash', '.mk': 'bash',
  '.cc': 'c', '.cpp': 'c', '.cxx': 'c', '.hpp': 'c', '.hh': 'c', '.m': 'c', '.mm': 'c', '.java': 'c', '.cs': 'c',
  '.swift': 'typescript', '.kt': 'typescript', '.kts': 'typescript', '.scala': 'typescript', '.dart': 'typescript', '.groovy': 'typescript', '.gradle': 'typescript',
  '.rb': 'python',
}
const BORROWED_NAMES: Record<string, string> = { makefile: 'bash', gnumakefile: 'bash', dockerfile: 'bash', containerfile: 'bash', gemfile: 'python', rakefile: 'python', brewfile: 'python' }

export function codeLanguage(file: string): string | undefined {
  const base = path.basename(file).toLowerCase()
  // `.env.local` and `Dockerfile.dev` count as what they start with.
  const ext = path.extname(base) || (base.startsWith('.') ? base : '')
  return BORROWED_NAMES[base] ?? BORROWED_NAMES[base.split('.')[0]] ?? BORROWED[ext] ?? (base.startsWith('.env') ? 'bash' : undefined)
}

export function readPreview(workspace: string, file: string): Preview {
  const rel = path.isAbsolute(file) ? path.relative(workspace, file) : file
  const abs = insideWorkspace(workspace, file)
  if (!abs) return { ok: false, rel, reason: 'Only files inside this note’s folder can be previewed.' }
  if (/credentials|keychain/i.test(abs)) return { ok: false, rel, reason: 'This looks like a credentials file, so Vellum doesn’t open it.' }
  let size: number
  try {
    const st = statSync(abs)
    if (!st.isFile()) return { ok: false, rel, reason: 'This is a folder, not a file.' }
    size = st.size
  } catch {
    return { ok: false, rel, reason: 'This file doesn’t exist anymore.' }
  }
  if (previewKind(abs) === 'image') {
    if (size > MAX_IMAGE_BYTES) return { ok: false, rel, reason: `This image is ${Math.round(size / 1024 / 1024)} MB, too big to preview.` }
    return { ok: true, abs, rel, kind: 'image', text: '', lines: 0, shown: 0, bytes: size, size: imageSize(abs) }
  }
  // A NUL in the first few KB means bytes, not text; then the start is all that's read.
  const head = readHead(abs, 8192)
  if (!head) return { ok: false, rel, reason: 'Vellum can’t read this file.' }
  if (head.includes(0)) {
    const text = hexDump(head.subarray(0, HEX_BYTES))
    const lines = text.split('\n').length
    return { ok: true, abs, rel, kind: 'binary', text, lines, shown: lines, bytes: size }
  }
  if (size > MAX_BYTES) return { ok: false, rel, reason: `This file is ${Math.round(size / 1024 / 1024)} MB, too big to preview.` }
  let buf: Buffer
  try {
    buf = readFileSync(abs)
  } catch {
    return { ok: false, rel, reason: 'Vellum can’t read this file.' }
  }
  const all = buf.toString('utf8').replace(/\r\n/g, '\n')
  const split = all.split('\n')
  const lines = split.length - (all.endsWith('\n') ? 1 : 0)
  const shown = Math.min(lines, MAX_LINES)
  const text = shown < lines ? split.slice(0, shown).join('\n') : all.replace(/\n$/, '')
  return { ok: true, abs, rel, kind: previewKind(abs), text, lines, shown, bytes: size }
}

function readHead(abs: string, n: number): Buffer | undefined {
  try {
    const fd = openSync(abs, 'r')
    try {
      const buf = Buffer.alloc(n)
      return buf.subarray(0, readSync(fd, buf, 0, n, 0))
    } finally {
      closeSync(fd)
    }
  } catch {
    return undefined
  }
}

/** `hexdump -C`'s layout: offset, sixteen bytes in two eights, then the printable ones. */
export function hexDump(b: Buffer): string {
  const rows: string[] = []
  for (let at = 0; at < b.length; at += 16) {
    const row = b.subarray(at, at + 16)
    const hex = [...row].map((x) => x.toString(16).padStart(2, '0'))
    const left = hex.slice(0, 8).join(' ').padEnd(23)
    const right = hex.slice(8).join(' ').padEnd(23)
    const ascii = [...row].map((x) => (x >= 0x20 && x < 0x7f ? String.fromCharCode(x) : '.')).join('')
    rows.push(`${at.toString(16).padStart(8, '0')}  ${left}  ${right}  |${ascii}|`)
  }
  return rows.join('\n')
}

/** 245 KB, 1.2 MB: a file's size for the pane. */
export function bytesLabel(n: number): string {
  if (n < 1024) return `${n} bytes`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
