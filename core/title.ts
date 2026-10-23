// A short title for a note, from its first paragraph, so a ten-line opener still names the tab in
// a few words. One headless call to the official binary on the small model, with as little loaded
// as the CLI allows: about $0.0003 and 6s (spikes/title-haiku.ts). The note keeps its provisional
// title (the first line, cut short) until this answers, and if it fails.

import type { Profile } from './profiles'
import { claudeBin } from './platform'
import { profileEnv } from './profiles'

const SYSTEM = 'You name notes. Reply with a title of 2 to 6 words, sentence case, no quotes, no trailing period.'
const MAX_INPUT = 4000

export async function nameNote(text: string, profile: Profile, cwd: string): Promise<string | undefined> {
  const proc = Bun.spawn(
    [
      claudeBin(), '-p', '--model', 'haiku', '--output-format', 'json',
      '--setting-sources', '', '--strict-mcp-config', '--tools', '', '--disable-slash-commands', '--no-session-persistence',
      '--system-prompt', SYSTEM,
    ],
    // The note goes in on stdin, never as an argument: on Windows a claude.cmd shim would hand
    // the arguments to cmd.exe to parse again.
    { cwd, env: profileEnv(profile), stdin: new Blob([text.slice(0, MAX_INPUT)]), stdout: 'pipe', stderr: 'ignore' },
  )
  const timer = setTimeout(() => proc.kill(), 30_000)
  try {
    const out = await new Response(proc.stdout).text()
    if ((await proc.exited) !== 0) return
    const r = JSON.parse(out)
    if (r.is_error || typeof r.result !== 'string') return
    const title = r.result.trim().split('\n')[0]!.replace(/^["'`*#\s]+|["'`*.\s]+$/g, '')
    return title && title.length <= 60 ? title : undefined
  } catch {
    return
  } finally {
    clearTimeout(timer)
  }
}
