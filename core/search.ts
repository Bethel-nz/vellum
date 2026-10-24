import type { Thread } from './threads'

// A note's text, and the same lower-cased, worked out once per version of the note: Past notes
// searches every note on each key.
const bodies = new WeakMap<Thread, { body: string; lower: string }>()

/** Search the note itself, not only its generated title. Keep the excerpt around the match. */
export function searchNote(thread: Thread, query: string) {
  let cached = bodies.get(thread)
  if (!cached) {
    const body = thread.blocks.flatMap((block) => block.kind === 'user' ? [block.text] : block.kind === 'assistant' ? [block.markdown] : []).join('\n').replace(/```[^\n]*\n?/g, ' ').replace(/(^|\n)#{1,6}\s+/g, '$1').replace(/`/g, '').replace(/\*\*(.*?)\*\*/g, '$1').replace(/\s+/g, ' ').trim()
    cached = { body, lower: body.toLocaleLowerCase() }
    bodies.set(thread, cached)
  }
  const { body, lower } = cached
  const q = query.trim().toLocaleLowerCase()
  const title = thread.title.toLocaleLowerCase()
  const folder = thread.workspace.toLocaleLowerCase()
  const match = lower.indexOf(q)
  if (q && !title.includes(q) && !folder.includes(q) && match < 0) return
  let start = q && match >= 0 ? Math.max(0, match - 45) : 0
  if (start) start = body.lastIndexOf(' ', start) + 1
  let end = Math.min(body.length, start + 210)
  if (end < body.length) { const boundary = body.lastIndexOf(' ', end); if (boundary > start) end = boundary }
  return { thread, rank: title === q ? 0 : title.startsWith(q) ? 1 : title.includes(q) ? 2 : folder.includes(q) ? 3 : 4, excerpt: `${start ? '…' : ''}${body.slice(start, end)}${end < body.length ? '…' : ''}` }
}
