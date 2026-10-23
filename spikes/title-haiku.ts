// Spike: a note title from the first paragraph, via the official binary on a small model, with
// as little loaded as the CLI allows (no settings sources, MCP, tools or skills; a short system
// prompt; nothing saved). Prints the title, the cost and the time.
//   bun spikes/title-haiku.ts <empty folder>
const cwd = process.argv[2] ?? process.cwd()
const text = `ok so the tab strip is weird when there are lots of notes, the boxes wrap or overflow and
the active pill pushes everything left. also the hover label sometimes sticks after the mouse leaves.
can you look at TabStrip.tsx and make it scroll horizontally or collapse older tabs into a +3 box,
and fix the hover stickiness. also check the reduced motion path still works. and maybe the
close button on the pill should only show on hover which i think it already does but double check
and if theres time look at why ctrl+click sometimes doesnt close`
const started = Date.now()
const proc = Bun.spawn(
  [
    'claude', '-p', '--model', 'haiku', '--output-format', 'json',
    '--setting-sources', '', '--strict-mcp-config', '--tools', '', '--disable-slash-commands', '--no-session-persistence',
    '--system-prompt', 'You name notes. Reply with a title of 2 to 6 words, sentence case, no quotes, no trailing period.',
    text,
  ],
  { cwd, stdout: 'pipe', stderr: 'pipe' },
)
const out = await new Response(proc.stdout).text()
console.log('exit', await proc.exited, (await new Response(proc.stderr).text()).slice(0, 300))
try {
  const r = JSON.parse(out)
  console.log({ title: r.result, cost: r.total_cost_usd, ms: Date.now() - started, model: Object.keys(r.modelUsage ?? {}) })
} catch {
  console.log(out.slice(0, 500))
}
export {}
