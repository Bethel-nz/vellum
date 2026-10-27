/** Inspect a runner script without executing it. One literal tools.x(...) or
 * discovery search(...) call can become an input view; dynamic/multiple calls stay code. */
export function literalToolCall(code: string) {
  const calls: { name: string; arguments?: Record<string, unknown>; code: string; discovery?: boolean }[] = []
  let dynamicTemplate = false
  const skip = (at: number): number => {
    const quote = code[at]
    if (quote === '"' || quote === "'" || quote === '`') {
      let i = at + 1
      while (i < code.length) {
        if (code[i] === '\\') { i += 2; continue }
        if (quote === '`' && code.slice(i, i + 2) === '${') dynamicTemplate = true
        if (code[i++] === quote) return i
      }
      return code.length
    }
    if (code.slice(at, at + 2) === '//') { const end = code.indexOf('\n', at + 2); return end < 0 ? code.length : end + 1 }
    if (code.slice(at, at + 2) === '/*') { const end = code.indexOf('*/', at + 2); return end < 0 ? code.length : end + 2 }
    return at
  }
  const closeParen = (at: number) => {
    const stack = ['(']
    for (let i = at + 1; i < code.length; i++) {
      const skipped = skip(i); if (skipped !== i) { i = skipped - 1; continue }
      const char = code[i]!
      if ('([{'.includes(char)) stack.push(char)
      else if (')]}'.includes(char)) {
        if (stack.pop() !== ({ ')': '(', ']': '[', '}': '{' } as Record<string, string>)[char]) return
        if (!stack.length) return i
      }
    }
  }
  for (let i = 0; i < code.length; i++) {
    const skipped = skip(i); if (skipped !== i) { i = skipped - 1; continue }
    // An unhandled slash can begin a regexp literal. Keep ambiguous scripts as code.
    if (code[i] === '/') return
    if (/[\w$.]/.test(code[i - 1] ?? '')) continue
    const discovery = code.slice(i).match(/^search\s*\(/)
    const match = discovery ?? code.slice(i).match(/^tools((?:\s*\.\s*[A-Za-z_$][\w$]*)+)\s*\(/)
    if (!match) continue
    const name = discovery ? 'search' : match[1]!.replace(/\s/g, '').slice(1), open = i + match[0].length - 1, end = closeParen(open)
    if (end === undefined) return
    let args: Record<string, unknown> | undefined
    try {
      const value = Bun.JSON5.parse(code.slice(open + 1, end).trim().replace(/,\s*$/, ''))
      if (value && typeof value === 'object' && !Array.isArray(value)) args = value
    } catch { /* Identifiers, calls, spreads and expressions are not literal arguments. */ }
    calls.push({ name: name.split('.').at(-1)!, arguments: args, code, ...(discovery ? { discovery: true } : {}) })
    // Keep scanning the arguments too: a nested tool invocation makes this a multi-call script.
  }
  const call = calls[0]
  return !dynamicTemplate && calls.length === 1 && call?.arguments ? { ...call, arguments: call.arguments } : undefined
}
