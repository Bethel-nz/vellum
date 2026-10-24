// What the file preview shows (ui/FilePreview.tsx): a workspace file's text and how to show it.
// Markdown renders, with its source a toggle away; code highlights; JSON has a view of its own when
// one is registered, and reads as code until then; everything else is plain text. Files are read
// under the same rules as diffs and tag slices (core/files.ts): inside the note's folder only, and
// never anything that looks like credentials. When a file can't be shown, the reason says why.

import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { insideWorkspace } from './files'

export type PreviewKind = 'markdown' | 'json' | 'code' | 'text'

export type Preview =
  | { ok: true; abs: string; rel: string; kind: PreviewKind; text: string; lines: number; shown: number }
  | { ok: false; rel: string; reason: string }

/** Past this, a file is too big to read into the pane at all. */
const MAX_BYTES = 4 * 1024 * 1024
/** Past this, only the first lines show: <code> builds a row per line. */
export const MAX_LINES = 5000

const MARKDOWN = new Set(['.md', '.markdown', '.mdx'])
const JSON_EXT = new Set(['.json', '.jsonc', '.json5', '.jsonl', '.ndjson'])
const TEXT = new Set(['.txt', '.text', '.log', '.csv', '.tsv', ''])
const TEXT_NAMES = new Set(['license', 'licence', 'readme', 'changelog', 'authors', 'notice', 'copying'])

export function previewKind(file: string): PreviewKind {
  const base = path.basename(file).toLowerCase()
  const ext = path.extname(base)
  if (MARKDOWN.has(ext)) return 'markdown'
  if (JSON_EXT.has(ext)) return 'json'
  if (TEXT.has(ext) && (ext !== '' || TEXT_NAMES.has(base))) return 'text'
  // Dotfiles and extensionless scripts still read better highlighted: <code> picks by path.
  return 'code'
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
  if (size > MAX_BYTES) return { ok: false, rel, reason: `This file is ${Math.round(size / 1024 / 1024)} MB, too big to preview.` }
  let buf: Buffer
  try {
    buf = readFileSync(abs)
  } catch {
    return { ok: false, rel, reason: 'Vellum can’t read this file.' }
  }
  // A NUL in the first few KB means bytes, not text.
  if (buf.subarray(0, 8192).includes(0)) return { ok: false, rel, reason: 'This is a binary file, so there’s no text to show.' }
  const all = buf.toString('utf8').replace(/\r\n/g, '\n')
  const split = all.split('\n')
  const lines = split.length - (all.endsWith('\n') ? 1 : 0)
  const shown = Math.min(lines, MAX_LINES)
  const text = shown < lines ? split.slice(0, shown).join('\n') : all.replace(/\n$/, '')
  return { ok: true, abs, rel, kind: previewKind(abs), text, lines, shown }
}
