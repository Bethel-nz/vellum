import type { Capture, CaptureSnapshot, SavedCapture } from '../../core/capture'

export type CaptureSettings = { target: string; mode: 'send' | 'queue'; url: string; port: number }
export type Note = { id: string; title: string; workspace: string; account: string; active: boolean }
export type Upload = { name: string; mime: string; data: string }
export type SnapshotResult = { snapshot: CaptureSnapshot }
export type SnapshotStateResult = { node: Capture['elements'][number] }
export type PageScreenshot = { id: string; image: string }
export type PageScreenshotResult = { screenshot: PageScreenshot }
export type CaptureResult = { capture: Capture; scroll: { x: number; y: number }; files?: Upload[] }
export type WorkerMessage =
  | { type: 'settings' }
  | { type: 'bridge-settings'; url: string; port: number }
  | { type: 'notes' }
  | { type: 'appearance' }
  | { type: 'target'; target: string; mode: 'send' | 'queue' }
  | { type: 'toggle' }
  | { type: 'capture'; ref?: string; mode?: 'queue'; triggers: boolean; frames: boolean; listeners: boolean }
  | { type: 'snapshot'; ref: string }
  | { type: 'page-screenshot' }
  | { type: 'capture-status'; id: string }
export type ContentMessage =
  | { type: 'ping' }
  | { type: 'toggle' }
  | { type: 'extract'; ref?: string }
  | { type: 'snapshot-state'; ref: string }
  | { type: 'visibility'; hidden: boolean }
  | { type: 'seek'; ref: string; progress: number }
  | { type: 'restore-animations' }
  | { type: 'trigger-read'; ref: string; trigger: 'hover' | 'focus' | 'active' }
  | { type: 'captured'; saved: SavedCapture }
  | { type: 'capture-error'; error: string }
export type Reply<T = unknown> = { ok: true; value: T } | { ok: false; error: string }

export async function worker<T>(message: WorkerMessage): Promise<T> {
  const reply: Reply<T> = await chrome.runtime.sendMessage(message)
  if (!reply?.ok) throw new Error(reply?.error ?? 'Vellum Snapshot did not respond. Reload the extension and try again.')
  return reply.value
}
