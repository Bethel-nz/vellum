import { plainName } from '../core/captures'

export async function runBrowser(args: string[]) {
  const noteId = process.env.VELLUM_NOTE_ID, endpoint = process.env.VELLUM_BRIDGE, token = process.env.VELLUM_TOKEN
  if (!plainName(noteId) || !endpoint || !token) throw new Error('Run browser from a Vellum note')
  if (!args.length) { process.stdout.write('browser <open|snapshot|click|screenshot|...> — the browser in this note\n'); return }
  const response = await fetch(`${endpoint}/browser/execute`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ noteId, args }) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || `Browser request failed (${response.status})`)
  process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '')
  for (const artifact of result.artifacts ?? []) process.stdout.write(`${artifact.path}\n`)
  process.exitCode = result.exitCode
}
if (import.meta.main) await runBrowser(process.argv.slice(2))
