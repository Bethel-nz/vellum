// Which file a shell command prints, when that's all it does: `cat ui/theme.ts`, `head -n 40
// app.tsx`, `sed -n '10,80p' core/agent.ts`, after a `cd … &&` or not. The note then highlights
// the output as that file's language instead of as shell (ui/blocks.tsx, AgentShell). Anything
// that transforms the output (a pipe, a redirect, a second command), or prints several files,
// gets no file: its output isn't that file's text.

/** Commands that print a file's text as it is, or a slice of it. */
const PRINTERS = new Set(['cat', 'head', 'tail', 'nl', 'bat', 'batcat'])
/** Each printer's options that take a value (`head -n 40`), so the value isn't the file. `cat -n` takes none. */
const VALUED: Record<string, Set<string>> = {
  cat: new Set(),
  head: new Set(['-n', '-c', '--lines', '--bytes']),
  tail: new Set(['-n', '-c', '--lines', '--bytes']),
  nl: new Set(['-b', '-d', '-f', '-h', '-i', '-l', '-n', '-s', '-v', '-w']),
  bat: new Set(['-l', '-H', '-r', '--language', '--line-range', '--highlight-line', '--style', '--theme']),
}

export function printedFile(command: string): string | undefined {
  const steps = command.split(/\s*(?:&&|;)\s*/).filter(Boolean)
  const last = steps.at(-1)
  // Leading steps may only move into a folder.
  if (!last || steps.slice(0, -1).some((s) => !/^cd(\s|$)/.test(s.trim()))) return undefined
  const words = split(last)
  if (!words) return undefined
  const [cmd, ...args] = words
  if (!cmd) return undefined
  const name = cmd.split('/').pop()!
  if (name === 'sed') return sedFile(args)
  if (!PRINTERS.has(name)) return undefined
  const valued = VALUED[name === 'batcat' ? 'bat' : name]!
  const files: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === '--') {
      files.push(...args.slice(i + 1))
      break
    }
    if (a.startsWith('-') && a !== '-') {
      if (valued.has(a)) i++
      continue
    }
    files.push(a)
  }
  return files.length === 1 && files[0] !== '-' ? files[0] : undefined
}

/** `sed -n 'script' file`: printing a slice, with no in-place edit and one file. */
function sedFile(args: string[]) {
  if (!args.includes('-n') || args.some((a) => a === '-i' || a.startsWith('-i') || a === '--in-place')) return undefined
  const rest = args.filter((a) => a !== '-n' && a !== '-E' && a !== '-r')
  if (rest.some((a) => a.startsWith('-'))) return undefined
  // The script, then exactly one file.
  return rest.length === 2 ? rest[1] : undefined
}

/**
 * Shell words with plain quoting; undefined for anything this shouldn't guess at: a pipe, a
 * redirect, a substitution, a glob, or a background job.
 */
function split(s: string): string[] | undefined {
  const words: string[] = []
  let word = ''
  let quote: '"' | "'" | null = null
  let started = false
  for (const ch of s.trim()) {
    if (quote) {
      if (ch === quote) quote = null
      else word += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      started = true
    } else if (/\s/.test(ch)) {
      if (started) words.push(word)
      word = ''
      started = false
    } else if ('|<>`$*?&()'.includes(ch)) {
      return undefined
    } else {
      word += ch
      started = true
    }
  }
  if (quote) return undefined
  if (started) words.push(word)
  return words
}
