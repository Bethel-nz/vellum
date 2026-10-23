// Splits a reply into prose and fenced code, so code blocks can be drawn in our own card
// (no language header) while the prose stays one <markdown>. Fences indented four or more
// spaces belong to a list item and stay inside the markdown.

export type Part = { kind: 'prose'; text: string } | { kind: 'code'; code: string; language: string; open?: boolean }

const OPEN = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)/

export function splitFences(markdown: string): Part[] {
  const parts: Part[] = []
  const prose: string[] = []
  const flush = () => {
    const text = prose.join('\n').trim()
    if (text) parts.push({ kind: 'prose', text })
    prose.length = 0
  }
  const lines = markdown.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const open = OPEN.exec(lines[i]!)
    if (!open) {
      prose.push(lines[i]!)
      continue
    }
    const fence = open[1]!
    const close = new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`)
    const body: string[] = []
    let j = i + 1
    while (j < lines.length && !close.test(lines[j]!)) body.push(lines[j++]!)
    flush()
    // A fence still streaming in has no closing line yet.
    parts.push({ kind: 'code', code: body.join('\n'), language: open[2] ?? '', open: j >= lines.length || undefined })
    i = j
  }
  flush()
  return parts
}
