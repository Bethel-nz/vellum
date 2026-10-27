import { literalToolCall } from './tool-wrapper'
import type { ToolCall } from './tools'

export const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
export const valueText = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? String(value)
export const compactText = (text: string) => text.replace(/\s+/g, ' ').trim()
export function parseValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const text = value.trim()
  if (text.startsWith('{') || text.startsWith('[')) try { return JSON.parse(text) } catch { /* Partial JSON remains text. */ }
  return value
}

/** An optional display envelope. It never changes the arguments sent to a tool. */
export function envelope(value: unknown, input = false) {
  if (!record(value) || typeof value.title !== 'string' || !value.title.trim()) return
  const key = (input ? ['arg'] : ['arg', 'result', 'data']).find(key => Object.hasOwn(value, key))
  if (key && Object.keys(value).every(name => name === 'title' || name === key) && (!input || record(value[key]))) return { title: compactText(value.title), value: value[key] }
}
export const wrappedTool = (call: ToolCall) => { const input = call.arguments ?? call.input; return typeof input?.code === 'string' ? literalToolCall(input.code) : undefined }
export const displayInput = (call: ToolCall) => {
  const wrapped = wrappedTool(call)
  if (wrapped) return wrapped.arguments
  const value = call.arguments ?? call.input ?? (call.detail && call.detail !== call.name ? { target: call.detail } : {})
  return envelope(value, true)?.value ?? value
}

/** Some tools send a caption followed by a complete JSON document. */
function resultText(text: unknown): { value: unknown; caption?: string; extra?: string } {
  const value = parseValue(text)
  if (typeof value !== 'string') return { value }
  const labeled = value.trim().match(/^([^{}\[\]\n]{1,160}?)(?::[ \t]*|\r?\n)([\s\S]+)$/)
  const parsed = labeled ? parseValue(labeled[2]) : undefined
  if (record(parsed) || Array.isArray(parsed)) return { value: parsed, caption: labeled![1]!.trim() }
  const newline = value.indexOf('\n'), first = newline < 0 ? undefined : parseValue(value.slice(0, newline))
  return record(first) || Array.isArray(first) ? { value: first, extra: value.slice(newline + 1).trim() } : { value }
}

export type DisplayResult = { value?: unknown; caption?: string; extra?: string; attachments: string[]; raw?: string }
export function displayResult(call: ToolCall): DisplayResult {
  const raw = call.output ?? call.error
  const decoded = parseValue(raw)
  let value: unknown = record(decoded) && Array.isArray(decoded.content) ? decoded : parseValue(call.result !== undefined ? call.result : raw)
  const attachments: string[] = []
  let extra: string | undefined, caption: string | undefined
  // MCP's transport envelope is distinct from an arbitrary object with a content field.
  if (record(value) && Array.isArray(value.content) && value.content.every(part => record(part) && ['text', 'image', 'audio', 'resource', 'resource_link'].includes(String(part.type)))) {
    const text = value.content.flatMap(part => record(part) && part.type === 'text' && typeof part.text === 'string' ? [part.text] : []).join('\n')
    for (const part of value.content) if (record(part) && part.type !== 'text') attachments.push(`${String(part.type).replace('_', ' ')}${typeof part.mimeType === 'string' ? ` · ${part.mimeType}` : ''}${typeof part.name === 'string' ? ` · ${part.name}` : ''}`)
    const parsed = resultText(text)
    const structured = value.structuredContent
    value = structured !== undefined ? structured : text ? parsed.value : undefined
    if (structured === undefined || JSON.stringify(parsed.value) === JSON.stringify(structured)) { caption = parsed.caption; extra = parsed.extra }
    else if (text) extra = text
  }
  if (typeof value === 'string') {
    const parsed = resultText(value)
    value = parsed.value; caption = parsed.caption ?? caption
    extra = [extra, parsed.extra].filter(Boolean).join('\n') || undefined
  }
  return { value, caption, extra, attachments, raw: raw ?? (value === undefined ? undefined : valueText(value)) }
}

const leafName = (name: string) => name.replace(/^mcp__.+?__/, '').replace(/^vellum_/, '')
const mobileActions: Record<string, string> = { connect: 'Connect simulator', disconnect: 'Disconnect simulator', devices: 'List simulators', status: 'Check simulator connection', boot: 'Boot simulator', shutdown: 'Shut down simulator' }
const mobileNames: Record<string, string> = { mobile_apps: 'List installed apps', mobile_configure: 'Configure simulator', mobile_notify: 'Send simulator notification', mobile_reset: 'Reset simulator data', mobile_input: 'Send simulator input', mobile_inspect: 'Inspect simulator' }
function mobileTitle(name: string, args: Record<string, unknown>) {
  if (name === 'mobile_connection' && typeof args.action === 'string') return Object.hasOwn(mobileActions, args.action) ? mobileActions[args.action] : `Mobile · ${args.action}`
  if (name === 'mobile_snapshot') return 'Read simulator screen'
  if (name === 'mobile_tap' && typeof args.target === 'string') return `Tap ${args.target}`
  if (name === 'mobile_steps') return `Run ${Array.isArray(args.steps) ? args.steps.length + ' ' : ''}mobile steps`
  return Object.hasOwn(mobileNames, name) ? mobileNames[name] : undefined
}
export function displayTitle(call: ToolCall) {
  const runner = wrappedTool(call)
  const wrapped = envelope(call.arguments ?? call.input, true)
  if (wrapped) return wrapped.title
  if (runner?.discovery) return `Find tools${typeof runner.arguments.query === 'string' ? ` · ${compactText(runner.arguments.query)}` : ''}`
  if (runner) return mobileTitle(runner.name, runner.arguments) ?? displayTitle({ ...call, name: runner.name, title: undefined, arguments: runner.arguments, input: runner.arguments, detail: runner.name, definition: undefined })
  const nativeName = leafName(call.name), nativeInput = displayInput(call)
  const mobile = record(nativeInput) ? mobileTitle(nativeName, nativeInput) : undefined
  if (mobile) return mobile
  if (call.title && call.title !== call.name && !/^(execute|bash|shell|tool|terminal)$/i.test(call.title)) return compactText(call.title)
  if (call.definition?.title) return call.definition.title
  const input = displayInput(call), args = record(input) ? input : {}
  const name = leafName(call.name)
  const done = call.status === 'ok'
  const repo = typeof args.repo === 'string' ? args.repo : typeof args.repository === 'string' ? args.repository : undefined
  const target = [args.file_path, args.path, args.url, args.query, args.pattern].find(value => typeof value === 'string' && value.trim())
  if (/search.*issues|issues.*search/i.test(name)) return `${done ? 'Searched' : 'Search'} issues${repo ? ` in ${repo}` : ''}`
  if (/search|grep|glob/i.test(name)) return `${done ? 'Searched' : 'Search'}${repo ? ` in ${repo}` : typeof target === 'string' ? ` · ${compactText(target)}` : ''}`
  if (/^read(?:_|$)|^Read$/.test(name) && typeof target === 'string') return `Read ${target}`
  if (typeof args.description === 'string' && args.description.trim()) return compactText(args.description)
  if (typeof args.command === 'string' && args.command.trim()) return compactText(args.command)
  if (typeof args.code === 'string') return 'Run code'
  return compactText(call.detail && call.detail !== call.name ? `${name.replaceAll('_', ' ')} · ${call.detail}` : name.replaceAll('_', ' '))
}

export function resultSummary(call: ToolCall) {
  if (call.status === 'running') return 'Running'
  if (call.status === 'error') return call.exitCode ? `Exit ${call.exitCode}` : 'Failed'
  const parsed = displayResult(call).value
  const value = envelope(parsed)?.value ?? parsed
  if (Array.isArray(value)) return `${value.length} results`
  if (record(value)) {
    if (typeof value.completed === 'number') return `${value.completed} ${value.completed === 1 ? 'step' : 'steps'} completed`
    if (Array.isArray(value.elements)) return `${value.elements.length} elements`
    for (const key of ['results', 'issues', 'items', 'matches', 'files', 'devices']) if (Array.isArray(value[key])) return `${value[key].length} results`
    for (const key of ['total_count', 'count', 'total']) if (typeof value[key] === 'number') return `${value[key]} results`
  }
  // Mobile reports sometimes prefix a text snapshot with one JSON line.
  const first = parseValue(call.output?.split('\n')[0])
  if (record(first) && typeof first.completed === 'number') return `${first.completed} steps completed`
  const lines = call.output?.trim() ? call.output.trimEnd().split('\n').length : 0
  return lines ? `${lines} ${lines === 1 ? 'line' : 'lines'}` : 'Done'
}

/** Live bridge requests take precedence over static source inspection. */
export function displayCalls(items: ToolCall[]): ToolCall[] {
  return items.flatMap(call => call.children?.length ? displayCalls(call.children).map(child => ({ ...child, runner: typeof (call.arguments ?? call.input)?.code === 'string' ? { code: String((call.arguments ?? call.input)!.code), output: call.output } : child.runner })) : [call])
}
