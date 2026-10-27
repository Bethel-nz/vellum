# Tool activity

`core/tools.ts` defines the shared tool-call shape for Claude, Codex and OpenCode.
Original arguments, structured results, readable output, schema metadata and state
remain separate. Metadata-only completion updates do not erase a previous result.

## Actual calls inside code runners

Vellum records authenticated `tools/call` requests at its note-scoped MCP bridge.
Each request gets a unique trace id, actual arguments, start/completion state and
the actual MCP result. This captures variable arguments and loops without executing
or attempting to interpret model-generated source in the renderer.

The runner associates requests with one unambiguous active parent. Parallel calls
with ambiguous ownership remain separate activity rows. Caught errors remain failed
tool rows even if the enclosing script returns successfully. Captured children
replace the generic runner row; View code retains its original code and aggregate
output. Direct calls have no empty code disclosure.

This applies to requests routed through Vellum's bridge. Older code-only records
cannot recover dynamic arguments retrospectively. A conservative literal parser can
show a single literal `tools.namespace.name({...})` call from an old record; variables,
multiple calls and expressions retain their original source instead.
The runner's single literal `search({query: ...})` discovery call also displays its
query as a named input, while retaining the original highlighted source.

## Presentation

Input uses the actual named fields, with schema property titles when available.
Output uses records and result rows; expanding a result exposes its remaining
fields. MCP transport envelopes are unpacked, with structured content preferred
and distinct text preserved. Attachments are described without displaying base64.
Raw output and copy actions retain the original result for inspection.
Caption-prefixed JSON (including older `iPhone name\n{...}` snapshots) is decoded
without losing the caption. New mobile snapshots also return MCP structured content.
An empty input object has no input panel. Snapshot rows prefer element refs over
duplicated ids/labels, and short scalar arrays stay on one line.

Code/script inputs, shell commands, source disclosures, raw JSON and scalar arrays
use the native code renderer with Pierre syntax colors. Formatted scalar values use
the same string, numeric, boolean and constant colors in both appearances. Multiline
text fields are chunked inside the virtual output rather than mounted as one tall row.

Titles use supplied tool metadata or derive from known actions and actual arguments.
An existing exact `{title, arg}` display envelope is supported, but agents do not
need to change a tool's input schema or manufacture presentation fields.

Output has a bounded 260px virtual viewport for structured rows, raw output and
plain text. It mounts at most 16 top-level rows, measures their heights and reserves
the rest with spacers. The installed GPUIX 0.11 virtual-list stopped delivering
visible ranges after a scroll jumped beyond mounted children, so this implementation
follows an ordinary native scroll host's offsets, including large jumps.

Tool-group header corners remain joined to the body until its exit completes.
OpenCode's supplied two-tone mark uses a bundled raster image because native SVG
icons are tint masks; Codex uses the supplied vector path.

Notification presentation removes the unlabelled note subtitle and formats quota,
authentication, question and approval messages. Raw provider errors remain in the
note/inbox; notification click routing still opens the originating note.
