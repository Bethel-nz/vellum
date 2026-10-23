// Spike: with `--permission-prompts host`, what does headless `claude -p` (stream-json) emit when a
// tool needs permission, and what answer does it accept on stdin? Runs one small turn in a temp
// folder, prints every non-stream line type, answers the first permission request with "allow",
// and logs the turn's result.
//   bun spikes/permission-host.ts [mode]
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const mode = process.argv[2] ?? 'manual'
const cwd = mkdtempSync(path.join(tmpdir(), 'vellum-perm-'))
const proc = Bun.spawn(
  ['claude', '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-mode', mode, '--permission-prompts', 'host', '--permission-prompt-tool', 'stdio'],
  { cwd, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
)
const send = (o: unknown) => {
  proc.stdin.write(JSON.stringify(o) + '\n')
  proc.stdin.flush()
}
// The host opens the control channel first, as an SDK host does.
send({ type: 'control_request', request_id: 'init-1', request: { subtype: 'initialize', hooks: null } })
send({ type: 'user', message: { role: 'user', content: 'Run the shell command `echo vellum-spike > out.txt` with the Bash tool, then reply with one word: done.' } })

let buf = ''
const decoder = new TextDecoder()
const timer = setTimeout(() => proc.kill(), 120_000)
for await (const chunk of proc.stdout) {
  buf += decoder.decode(chunk)
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i)
    buf = buf.slice(i + 1)
    if (!line.trim()) continue
    let ev: any
    try {
      ev = JSON.parse(line)
    } catch {
      console.log('non-json:', line.slice(0, 200))
      continue
    }
    if (ev.type === 'stream_event') continue
    if (ev.type === 'system' && /hook_/.test(ev.subtype)) continue
    if (ev.type === 'control_request' || ev.type === 'control_response' || ev.type === 'system' || ev.type === 'result') console.log(JSON.stringify(ev).slice(0, 900))
    else console.log(ev.type, ev.subtype ?? '')
    if (ev.type === 'control_request' && ev.request?.subtype === 'can_use_tool') {
      send({ type: 'control_response', response: { subtype: 'success', request_id: ev.request_id, response: { behavior: 'allow', updatedInput: ev.request.input } } })
      console.log('→ answered allow')
    }
    if (ev.type === 'result') {
      proc.stdin.end()
    }
  }
}
clearTimeout(timer)
console.log('exit', await proc.exited, 'stderr:', (await new Response(proc.stderr).text()).slice(0, 400))
console.log('out.txt:', await Bun.file(path.join(cwd, 'out.txt')).text().catch(() => '(missing)'))
