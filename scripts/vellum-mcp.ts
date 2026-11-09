// Stdio MCP stays available even when the agent does not advertise HTTP servers.
const endpoint = process.env.VELLUM_BRIDGE
const noteId = process.env.VELLUM_NOTE_ID
const token = process.env.VELLUM_TOKEN
const serverId = process.env.VELLUM_MCP_SERVER
const pending = new Map<number | string, AbortController>()
if (!endpoint || !noteId || !token) throw new Error('Vellum MCP needs a note and bridge credentials')

/** One JSON-RPC message from the agent, sent on to the bridge; its answer goes back on stdout. */
async function forward(line: string) {
  let body: any
  let controller: AbortController | undefined
  try {
    body = JSON.parse(line)
    if (body.method === 'notifications/cancelled') { pending.get(body.params?.requestId)?.abort(); return }
    if (body.id !== undefined) { controller = new AbortController(); pending.set(body.id, controller) }
    const response = await fetch(`${endpoint}/mcp/${encodeURIComponent(noteId!)}${serverId ? `?server=${encodeURIComponent(serverId)}` : ''}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: line, signal: controller?.signal })
    if (body.id === undefined) return
    if (!response.ok) throw new Error(`Vellum bridge returned ${response.status}`)
    process.stdout.write(`${await response.text()}\n`)
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: body?.id ?? null, error: { code: -32603, message: String((error as Error).message) } })}\n`)
  } finally {
    if (controller && pending.get(body?.id) === controller) pending.delete(body.id)
  }
}

// A slow answer doesn't hold up the next line.
export {}
for await (const line of console) if (line.trim()) void forward(line)
