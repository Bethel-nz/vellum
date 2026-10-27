# MCP connections

Settings → Connections manages Vellum-added servers and inherits global/user MCP
configurations from Codex, Claude and OpenCode. Codex TOML and Claude/OpenCode
JSON/JSONC normalize into Vellum's JSON connection format. Original files remain
unchanged. Connections shows each row's sources; Refresh rereads them.

Remote servers deduplicate by normalized URL (including query parameters). Local
servers deduplicate only when command, arguments, environment and working directory
match. Configured disabled states are preserved, while Vellum's own switches and
approval policies survive refresh. Removing an inherited server hides it in Vellum
without deleting it from the source config, and it stays hidden across refreshes.
Project-only definitions are not promoted into every note. Source-defined headers
resolve environment references into the private credentials store, not UI state.
OAuth sessions owned by another CLI are not copied.

Add a remote HTTP/SSE URL or a local executable with one argument per line. The
searchable directory provides real vendor endpoints. Vendor vectors are bundled
locally; custom services use a generic connection mark.

The server list shows actual discovery/connection results. Expand a server to see
its tools, switch individual tools off, choose an approval policy, pause the server
or remove it. Context counts estimate serialized tool definitions at four characters
per token. The segmented bar shows each server's share, not a context-window budget.

Remote servers can use browser OAuth or an explicitly pasted bearer token. OAuth
uses the official MCP SDK, PKCE, a loopback callback and state validation. Discovery
does not open the browser automatically. Credentials are stored separately from
connection settings, in a mode-0600 file under VELLUM_HOME. Local command environment
values are kept in the mode-0600 connection settings. Clipboard values are only read
when the user clicks a paste control and are never printed in the interface.

All three ACP adapters receive note-scoped stdio proxies. Vellum owns the upstream
clients and enforces permissions before forwarding each call. Disabled or paused
tools are checked again after an approval, so an old tool list cannot bypass a switch.
Ask every time is the default. Always allow reads only bypasses approval for tools
whose server declares readOnlyHint=true without destructiveHint=true. Other tools
still ask. Server annotations describe the server's claim, not a guarantee of its
behavior. The approval card shows the real arguments and exact offered rule.

Configuration changes refresh idle ACP sessions on the next message. An active turn
keeps its connection; execution checks apply immediately. MCP cancellation aborts the
corresponding proxy request. This integration exposes tools; it does not expose MCP
resources, prompts, sampling or elicitation.

OAuth requires a server that accepts Vellum as a native public client. Vendors may
require pre-approved clients or other registration. Such failures remain visible;
Vellum does not present a successful authorization screen without a real connection.
Live vendor account sign-ins have not been exercised in the implementation checks.

Endpoint references:

- [Linear](https://linear.app/docs/mcp)
- [Notion](https://github.com/makenotion/notion-cookbook/blob/main/docs/mcp-client-integration.md)
- [Figma](https://developers.figma.com/docs/figma-mcp-server/)
- [Vercel](https://vercel.com/docs/agent-resources/vercel-mcp)
- [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
