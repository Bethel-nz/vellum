// How much of a streaming reply shows (`revealTo`), and the blocks it's drawn in (`chunks`).

const FENCE = /^ {0,3}(`{3,}|~{3,})/
const HEADING = /^ {0,3}#{1,6}\s/
const LIST = /^\s*([-*+]|\d+[.)])\s/

type Line = { start: number; end: number; text: string; fence: boolean; closes: boolean; opens: boolean }

/** Every complete line (ending in \n) with whether it's inside a fence, opens one or closes one. */
function lines(md: string): Line[] {
  const out: Line[] = []
  let open: string | undefined
  let start = 0
  for (let i = md.indexOf('\n'); i >= 0; i = md.indexOf('\n', start)) {
    const text = md.slice(start, i)
    const f = FENCE.exec(text)?.[1]
    const opens = !open && Boolean(f)
    const closes = Boolean(open && f && f[0] === open[0] && f.length >= open.length && text.trim() === f)
    out.push({ start, end: i + 1, text, fence: Boolean(open) || opens, closes, opens })
    if (opens) open = f
    else if (closes) open = undefined
    start = i + 1
  }
  return out
}

/** Offsets where a chunk starts: block boundaries outside fences, never inside a list. */
export function blockStarts(md: string): number[] {
  const ls = lines(md)
  const cuts = new Set<number>([0])
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i]!
    const next = ls[i + 1]
    if (l.closes) cuts.add(l.end)
    else if (l.opens && l.start > 0) cuts.add(l.start)
    else if (!l.fence && HEADING.test(l.text)) {
      cuts.add(l.start)
      cuts.add(l.end)
    } else if (!l.fence && !l.text.trim() && ls[i - 1]?.text.trim()) {
      // A blank line ends a block, unless a list (or an indented continuation) carries on past it.
      const prev = ls[i - 1]!.text
      const after = next?.text ?? md.slice(l.end)
      const inList = (LIST.test(prev) || /^\s/.test(prev)) && (LIST.test(after) || /^\s{2,}\S/.test(after))
      if (!inList) cuts.add(l.end)
    }
  }
  return [...cuts].filter((c) => c < md.length).sort((a, b) => a - b)
}

/** Where shown text reads as finished: after a sentence, a block, or a whole line of code. */
export function naturalEnds(md: string): number[] {
  const ls = lines(md)
  const points = new Set(blockStarts(md).filter((p) => p > 0))
  // Fenced spans, [start, end): their lines are ends, their full stops are not.
  const fenced: [number, number][] = []
  for (const l of ls) {
    if (!l.fence) continue
    if (l.opens) fenced.push([l.start, md.length])
    if (l.closes) fenced.at(-1)![1] = l.end
    if (!l.opens) points.add(l.end)
  }
  const tail = md.slice(ls.at(-1)?.end ?? 0)
  if (FENCE.test(tail)) fenced.push([ls.at(-1)?.end ?? 0, md.length])
  const re = /[.?!:;]["')\]]?\s/g
  for (let m = re.exec(md); m; m = re.exec(md)) {
    const at = m.index + m[0].length
    if (!fenced.some(([s, e]) => at > s && at <= e)) points.add(at)
  }
  return [...points].sort((a, b) => a - b)
}

/** How long a half-written sentence waits for its end. */
export const HOLD_MS = 200

/** To the latest natural end; past the hold, to the last whole word. The first words show at once. */
export function revealTo(md: string, cursor: number, waited: number): number {
  const end = naturalEnds(md).filter((p) => p > cursor).at(-1)
  const words = Math.max(cursor, safeEnd(md))
  if (cursor === 0) return Math.max(end ?? 0, words)
  return end ?? (waited >= HOLD_MS ? words : cursor)
}

/**
 * The end of the last whole word, or of the last whole line inside an open fence.
 */
export function safeEnd(md: string): number {
  const ls = lines(md)
  const tail = md.slice(ls.at(-1)?.end ?? 0)
  const last = ls.at(-1)
  if ((last && last.fence && !last.closes) || FENCE.test(tail)) return last?.end ?? 0
  const space = Math.max(md.lastIndexOf(' '), md.lastIndexOf('\n'))
  return /\s$/.test(md) ? md.length : space >= 0 ? space + 1 : md.length
}

/** The shown text cut into chunks at block boundaries; `start` keys each one. */
export function chunks(shown: string): { start: number; text: string }[] {
  const starts = blockStarts(shown)
  return starts.map((s, i) => ({ start: s, text: shown.slice(s, starts[i + 1] ?? shown.length) })).filter((c) => c.text.trim())
}
