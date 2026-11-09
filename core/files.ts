// Reading workspace files for diffs and tag previews, kept inside the workspace: a path outside
// it, a `..` escape or a symlink pointing out is never opened, and nor is anything that looks like
// credentials.

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { createTwoFilesPatch } from 'diff'
import { relPath } from './threads'

const MAX_DIFF_BYTES = 2 * 1024 * 1024

/** The real path of `file` if it lies inside the workspace, else undefined. */
export function insideWorkspace(workspace: string, file: string): string | undefined {
  const abs = path.isAbsolute(file) ? file : path.join(workspace, file)
  let root: string
  let target: string
  try {
    root = realpathSync(workspace)
    // A file that does not exist yet (Write) resolves through its folder.
    target = existsSync(abs) ? realpathSync(abs) : path.join(realpathSync(path.dirname(abs)), path.basename(abs))
  } catch {
    return
  }
  const rel = path.relative(root, target)
  if (rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return
  return target
}

/** Text of a workspace file for tag previews and line quotes, under the same rules as diffs. */
export function readWorkspaceFile(workspace: string, file: string): string | undefined {
  const abs = insideWorkspace(workspace, file)
  if (!abs || /credentials|keychain/i.test(abs) || !existsSync(abs)) return
  try {
    if (!statSync(abs).isFile() || statSync(abs).size > MAX_DIFF_BYTES) return
    return readFileSync(abs, 'utf8')
  } catch {
    return
  }
}

export function filePatch(workspace: string, name: string, input: any): string | undefined {
  const file = String(input.file_path ?? '')
  if (!file) return
  // Only files inside the workspace are read for a diff; anything else falls
  // back to the snippet patch built from the tool input. Credential files are
  // never opened, wherever they are.
  const abs = insideWorkspace(workspace, file)
  if (!abs || /credentials|keychain/i.test(abs)) return
  if (existsSync(abs) && statSync(abs).size > MAX_DIFF_BYTES) return
  const before = existsSync(abs) ? readFileSync(abs, 'utf8') : ''
  let after = before
  if (name === 'Write') after = String(input.content ?? '')
  else {
    const edits = name === 'MultiEdit' ? (input.edits ?? []) : [input]
    for (const e of edits) {
      const from = String(e.old_string ?? '')
      const to = String(e.new_string ?? '')
      if (!from || !after.includes(from)) return
      // Literal, as the Edit tool does: a string replacement would read `$&` or `$1` in `to`.
      if (e.replace_all) after = after.split(from).join(to)
      else {
        const i = after.indexOf(from)
        after = after.slice(0, i) + to + after.slice(i + from.length)
      }
    }
  }
  const label = relPath(workspace, abs)
  return createTwoFilesPatch(label, label, before, after, '', '', { context: 3 })
}
