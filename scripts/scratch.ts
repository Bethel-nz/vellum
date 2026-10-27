// Scratch folders and file checks for the scripts, on Bun's own file APIs.
import { tmpdir } from 'node:os'
import path from 'node:path'

/** A new private folder in the system temp dir, `<prefix><random>` (what mkdtemp makes; Bun has none). */
export async function scratchDir(prefix: string): Promise<string> {
  const dir = path.join(tmpdir(), `${prefix}${Bun.randomUUIDv7()}`)
  // The system mkdir: Bun’s shell has its own, without -m.
  await Bun.$`/bin/mkdir -m 700 ${dir}`.quiet()
  return dir
}

/** Something is at `p`: a file, a folder or a socket. `Bun.file(p).exists()` says false for the last two. */
export function present(p: string): Promise<boolean> {
  return Bun.file(p).stat().then(
    () => true,
    () => false,
  )
}

/** The names in a folder, dot files and folders included, like readdir. */
export function names(dir: string, pattern = '*'): string[] {
  return [...new Bun.Glob(pattern).scanSync({ cwd: dir, onlyFiles: false, dot: true })]
}

/** Removes a file or a folder and what's in it; nothing there is fine. */
export async function remove(p: string): Promise<void> {
  await Bun.$`rm -rf ${p}`.quiet()
}

/**
 * Writes to `p` a piece at a time, flushed as it goes: a log one process keeps. It starts the file
 * empty, since Bun's writer replaces a file rather than appending to it.
 */
export function appender(p: string): (text: string) => void {
  const sink = Bun.file(p).writer()
  return (text) => {
    sink.write(text)
    sink.flush()
  }
}
