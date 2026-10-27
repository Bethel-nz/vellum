export type BrowserKey = { noteId: string; session: string; generation: string }
export type BrowserPhase = 'idle' | 'starting' | 'ready' | 'working' | 'waiting-user' | 'disconnected' | 'closed' | 'error'
export type BrowserPlacement = 'inline' | 'floating' | 'expanded' | 'minimized'
export type BrowserBinding = { mode: 'managed'; owned: true } | { mode: 'toolbar'; owned: false; targetKey: string; targetId: string }
export type ToolbarTarget = { key: string; installationId: string; toolbarId: string; tabId: number; windowId: number; targetId?: string; url: string; title: string; receivedAt: number }
export type BrowserArtifact = { id: string; path: string; mime: string; kind: 'screenshot' | 'video' | 'download' | 'pdf' | 'trace' | 'har' | 'other' }
export type BrowserCommandInput = { args: string[]; title?: string }
export type BrowserCommandResult = { key: BrowserKey; actionId: string; exitCode: number; stdout: string; stderr: string; code?: string; data?: unknown; artifacts: BrowserArtifact[] }
export type BrowserContext = { signal: AbortSignal; toolCallId?: string; runId?: string; onAction?: (key: BrowserKey, actionId: string) => void }
type EventBase = { key: BrowserKey; at: string; runId?: string }
export type BrowserEvent = EventBase & (
  | { type: 'session'; phase: BrowserPhase; binding: BrowserBinding; streamPort?: number; error?: string; url?: string; recording?: boolean }
  | { type: 'action-start'; actionId: string; toolCallId?: string; title: string }
  | { type: 'action-end'; actionId: string; exitCode: number; durationMs: number; summary: string; artifacts: BrowserArtifact[] }
  | { type: 'artifact'; actionId: string; artifact: BrowserArtifact }
  | { type: 'warning'; actionId: string; message: string }
)
export type BrowserActivity = { id: string; title: string; at: string; exitCode?: number; durationMs?: number; summary?: string; artifacts?: BrowserArtifact[] }
