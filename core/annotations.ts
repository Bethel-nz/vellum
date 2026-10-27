import type { SavedCapture } from './capture'
import type { Thread } from './threads'

export type AnnotationCapture = { saved: SavedCapture; note: { id: string; title: string; workspace: string } }
export const captureOpen = (saved: SavedCapture) => saved.status === 'queued' || saved.status === 'acknowledged'

/** Capture records already reduce to their latest status in each loaded note. */
export function collectAnnotations(threads: Thread[]): AnnotationCapture[] {
  return threads.flatMap((thread) => thread.blocks.flatMap((block) => block.kind === 'capture' ? [{ saved: block.saved, note: { id: thread.id, title: thread.title, workspace: thread.workspace } }] : []))
    .sort((a, b) => b.saved.capture.createdAt.localeCompare(a.saved.capture.createdAt))
}

export function annotationPage(url: string) {
  try { const page = new URL(url); return { host: page.host, label: `${page.host}${page.pathname}${page.search}` } }
  catch { return { host: url, label: url } }
}
