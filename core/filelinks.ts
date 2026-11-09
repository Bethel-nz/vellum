// Inline code naming a file in the note's folder becomes a link that opens it beside the note.

import { realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { insideWorkspace } from './files'

const SCHEME = 'vellum-file:'

export type FileRef = { path: string; line?: number; endLine?: number }

const isFile = (abs: string) => {
  try {
    return statSync(abs).isFile()
  } catch {
    return false
  }
}

/** `path`, `path:42`, `path:42-50`, `path#L42`, `path#L42-L50`, as a file in the folder, or undefined. */
export function fileRef(workspace: string, text: string): FileRef | undefined {
  const m = /^(.+?)(?::(\d+)(?:-(\d+))?|#L(\d+)(?:-L?(\d+))?)?$/.exec(text.trim())
  if (!m) return
  const raw = m[1]!.replace(/^file:\/\//, '')
  // A name, not a sentence or a command: no spaces, and a folder or an extension in it.
  if (/\s/.test(raw) || !/[/.]/.test(raw)) return
  let name = raw
  try {
    name = decodeURIComponent(raw)
  } catch {}
  const abs = insideWorkspace(workspace, name)
  if (!abs || !isFile(abs)) return
  const line = Number(m[2] ?? m[4]) || undefined
  const end = Number(m[3] ?? m[5]) || undefined
  // Named from the folder; macOS's /var is /private/var once resolved.
  let root = workspace
  try {
    root = realpathSync(workspace)
  } catch {}
  return { path: path.relative(root, abs) || name, ...(line ? { line } : {}), ...(line && end && end > line ? { endLine: end } : {}) }
}

/** The reply's text with every inline code span that names a file wrapped in a link to it. */
export function linkFiles(text: string, workspace: string): string {
  // Not code already inside a link's text: `[`a`](b)`.
  return text.replace(/(\[)?`([^`\n]+)`(?!\]\()/g, (all, bracket: string | undefined, code: string) => {
    if (bracket) return all
    const ref = fileRef(workspace, code)
    if (!ref) return all
    const at = ref.line ? `#L${ref.line}${ref.endLine ? `-L${ref.endLine}` : ''}` : ''
    return `[\`${code}\`](${SCHEME}${encodeURI(ref.path)}${at})`
  })
}

/** The file a clicked link points at: one of ours, or a plain link to a file in the folder. */
export function linkTarget(workspace: string, url: string): FileRef | undefined {
  if (url.startsWith(SCHEME)) return fileRef(workspace, url.slice(SCHEME.length))
  // Any other scheme (https:, mailto:) is not a file here.
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith('file://')) return
  return fileRef(workspace, url)
}
