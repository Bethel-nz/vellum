// Scratch folders and file checks for the scripts.
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/** A new private folder in the system temp dir, `<prefix><random>`. */
export async function scratchDir(prefix: string): Promise<string> {
  const dir = path.join(tmpdir(), `${prefix}${Bun.randomUUIDv7()}`)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

/** Something is at `p`: a file, a folder or a socket. */
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
 * Writes to `p` a piece at a time, flushed as it goes: a log one process keeps,
 * starting the file empty.
 */
export function appender(p: string): (text: string) => void {
  const sink = Bun.file(p).writer()
  return (text) => {
    sink.write(text)
    sink.flush()
  }
}
