import { realpathSync } from 'node:fs'

/** Windows may return `\\?\` paths; Git and Bun usually return the same path without that prefix. */
export function realPath(file: string): string {
  const resolved = realpathSync(file)
  if (process.platform !== 'win32') return resolved
  return resolved.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '')
}
