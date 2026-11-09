/** Git for Windows invokes configured helpers through its POSIX-compatible shell. */
export function gitCommand(script: string): string {
  const executable = process.platform === 'win32' ? process.execPath.replaceAll('\\', '/') : process.execPath
  const target = process.platform === 'win32' ? script.replaceAll('\\', '/') : script
  const quote = (value: string) => process.platform === 'win32' ? `"${value.replaceAll('"', '\\"')}"` : `'${value.replaceAll("'", "'\\''")}'`
  return `${quote(executable)} ${quote(target)}`
}
