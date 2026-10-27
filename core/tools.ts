import { parseValue, record } from './tool-display'

/** The one tool-call shape consumed by Vellum's UI, regardless of the ACP agent. */
export type ToolCall = {
  id: string
  name: string
  detail: string
  status: 'running' | 'ok' | 'error'
  error?: string
  title?: string
  input?: Record<string, unknown>
  /** Actual arguments before aliases used by file/terminal views. */
  arguments?: Record<string, unknown>
  /** Structured result, kept independently of the copyable output text. */
  result?: unknown
  definition?: { title?: string; inputSchema?: Record<string, unknown>; outputSchema?: Record<string, unknown>; source?: { name: string; url?: string } }
  output?: string
  /** Actual MCP requests made by a code runner, captured at the note-scoped bridge. */
  children?: ToolCall[]
  origin?: 'bridge'
  /** Presentation context when bridge children replace a runner row. */
  runner?: { code?: string; output?: string }
  exitCode?: number
  startedAt?: string
  finishedAt?: string
}

export type ToolUpdate = Pick<ToolCall, 'id' | 'name'> & Partial<Omit<ToolCall, 'id' | 'name'>>

const names: Record<string, string> = {
  execute: 'Bash', exec_command: 'Bash', shell: 'Bash', bash: 'Bash',
  read: 'Read', read_file: 'Read',
  edit: 'Edit', apply_patch: 'Edit',
  write: 'Write', write_file: 'Write',
  search: 'Grep', grep: 'Grep', glob: 'Glob',
  fetch: 'WebFetch', webfetch: 'WebFetch', websearch: 'WebSearch',
}

/** Claude supplies a tool name; Codex and OpenCode can supply only an ACP kind. */
export function toolName(call: any): string {
  const named = call?._meta?.claudeCode?.toolName ?? call?.name
  return named ? names[String(named).toLowerCase()] ?? String(named) : names[call?.kind] ?? call?.kind ?? 'Tool'
}

/** Aliases from the agents become the fields the existing file and command views consume. */
function normalizeToolInput(input: any): any {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input
  const { filePath, path, oldString, newString, cmd, ...rest } = input
  const file_path = input.file_path ?? filePath ?? path
  const old_string = input.old_string ?? oldString
  const new_string = input.new_string ?? newString
  const command = input.command ?? cmd
  return {
    ...rest,
    ...(file_path !== undefined ? { file_path } : {}),
    ...(old_string !== undefined ? { old_string } : {}),
    ...(new_string !== undefined ? { new_string } : {}),
    ...(command !== undefined ? { command: Array.isArray(command) ? command.join(' ') : command } : {}),
  }
}

/** Normalize both initial calls and partial updates. Missing fields never erase a result. */
export function normalizeToolCall(call: any, previous: Partial<ToolCall> = {}): ToolUpdate {
  const raw = call.rawOutput
  const content = (call.content ?? []).flatMap((part: any) => part.type === 'content' && part.content?.type === 'text' ? [part.content.text] : []).join('\n') || undefined
  const text = typeof raw?.error === 'string' ? raw.error : typeof raw?.output === 'string' ? raw.output : undefined
  // OpenCode puts the result in content and only transport metadata in rawOutput.
  const metadataOnly = raw && typeof raw === 'object' && Object.keys(raw).every((key) => ['metadata', 'exit_code', 'exitCode'].includes(key))
  const delta = call._meta?.terminal_output_delta?.data ?? call._meta?.terminal_output?.data ?? call._meta?.mcp_output_delta?.data
  const output = typeof raw === 'string' ? raw : text ?? content ?? (raw != null && !metadataOnly ? JSON.stringify(raw, null, 2) : typeof delta === 'string' ? (previous.output ?? '') + delta : undefined)
  const status = call.status === 'completed' ? 'ok' : call.status === 'failed' ? 'error' : call.status === 'pending' || call.status === 'in_progress' ? 'running' : undefined
  const exit = raw?.exitCode ?? raw?.exit_code ?? raw?.metadata?.exit ?? call._meta?.terminal_exit?.exit_code
  const args = parseValue(call.rawInput)
  const input = record(args) && Object.keys(args).length ? normalizeToolInput(args) : undefined
  const metadata = call._meta?.vellumTool
  const source = record(metadata?.source) && typeof metadata.source.name === 'string' ? { name: metadata.source.name, ...(typeof metadata.source.url === 'string' ? { url: metadata.source.url } : {}) } : undefined
  const definition: ToolCall['definition'] = record(metadata) ? { ...(typeof metadata.title === 'string' ? { title: metadata.title } : {}), ...(record(metadata.inputSchema) ? { inputSchema: metadata.inputSchema } : {}), ...(record(metadata.outputSchema) ? { outputSchema: metadata.outputSchema } : {}), ...(source ? { source } : {}) } : undefined
  const structured = call.structuredContent ?? (record(raw) ? raw.structuredContent : undefined)
  const result = structured !== undefined ? structured : output !== undefined ? parseValue(output) : undefined
  return {
    id: call.toolCallId,
    name: call._meta?.claudeCode?.toolName ?? previous.name ?? toolName(call),
    ...(typeof call.title === 'string' ? { title: call.title } : {}),
    ...(input !== undefined ? { input } : {}),
    ...(record(args) ? { arguments: args } : {}),
    ...(definition ? { definition } : {}),
    ...(result !== undefined ? { result } : output !== undefined ? { result: undefined } : {}),
    ...(output !== undefined ? { output } : {}),
    ...(status ? { status } : {}),
    ...(Number.isInteger(exit) ? { exitCode: exit } : {}),
  }
}
