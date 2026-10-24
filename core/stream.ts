// How a streaming reply surfaces: as settled chunks of ink, not a typewriter. The text still
// arrives delta by delta (and is recorded that way, so replay is unchanged); what changes is how
// much of it is shown, and in which pieces.
//
// `settlePoints` are the offsets where shown text may stop, from the text alone: after a blank
// line, a heading, a closed fence or every 6 lines of an open one, and after a sentence once two
// lines have built up. The UI (useInk in ui/blocks.tsx) shows up to the latest point, and past it
// after 500ms (sooner for a reply's first words) up to `safeEnd`. `chunks` cut the shown text at
// block boundaries; each chunk is drawn as its own element that fades in once.

const FENCE = /^ {0,3}(`{3,}|~{3,})/
const HEADING = /^ {0,3}#{1,6}\s/
const LIST = /^\s*([-*+]|\d+[.)])\s/
/** Lines of an open fence shown at a time. */
const FENCE_LINES = 6
/** "Two lines" of prose, for a sentence end to settle on without a newline. */
const TWO_LINES = 140

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

/** Offsets where the shown part of a streaming reply may stop. */
export function settlePoints(md: string): number[] {
  const ls = lines(md)
  const blocks = blockStarts(md).filter((p) => p > 0)
  const points = new Set(blocks)
  // Fenced spans, [start, end): no sentence ends inside them; an open one settles every 6 lines.
  const fenced: [number, number][] = []
  let run = 0
  for (const l of ls) {
    if (!l.fence) continue
    if (l.opens) {
      fenced.push([l.start, md.length])
      run = 0
    } else run++
    if (l.closes) fenced.at(-1)![1] = l.end
    if (l.closes || run >= FENCE_LINES) {
      points.add(l.end)
      run = 0
    }
  }
  const tail = md.slice(ls.at(-1)?.end ?? 0)
  if (FENCE.test(tail)) fenced.push([ls.at(-1)?.end ?? 0, md.length])
  // Prose: a sentence end settles once two lines have built up since the last point.
  const re = /[.?!]["')\]]?\s/g
  let last = 0
  let b = 0
  for (let m = re.exec(md); m; m = re.exec(md)) {
    const at = m.index + m[0].length
    while (b < blocks.length && blocks[b]! <= m.index) last = Math.max(last, blocks[b++]!)
    if (fenced.some(([s, e]) => at > s && at <= e)) continue
    const since = md.slice(last, at)
    if (since.includes('\n') || since.length >= TWO_LINES) {
      points.add(at)
      last = at
    }
  }
  return [...points].sort((a, b) => a - b)
}

/**
 * How far a forced reveal (the 500ms cap) may go: the whole text, but inside an open fence only
 * whole lines, and in prose not into a half-written word.
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
