import type { BrowserTab } from './agent-browser-types'

// Mouse defaults: button=none, clickCount=0; keyboard VK/modifiers=0.
export type StreamMouseInput = {
  type: 'input_mouse'; eventType?: 'mousePressed' | 'mouseReleased' | 'mouseMoved' | 'mouseWheel'; x?: number; y?: number;
  button?: 'none' | 'left' | 'middle' | 'right' | 'back' | 'forward'; clickCount?: number; deltaX?: number; deltaY?: number; modifiers?: number
}
// key/code/text are sent only when present.
export type StreamKeyboardInput = { type: 'input_keyboard'; eventType?: 'keyDown' | 'keyUp' | 'rawKeyDown' | 'char'; key?: string; code?: string; text?: string; windowsVirtualKeyCode?: number; modifiers?: number }
// touchPoints pass through unchanged.
export type StreamTouchInput = { type: 'input_touch'; eventType?: 'touchStart' | 'touchEnd' | 'touchMove' | 'touchCancel'; touchPoints?: unknown[]; modifiers?: number }
export type BrowserInput = StreamMouseInput | StreamKeyboardInput | StreamTouchInput
// maxFps: integer 0–120, 0 uncapped.
export type StreamClientMessage = BrowserInput | { type: 'config'; maxFps?: number; pacing?: 'ack' | 'push' } | { type: 'ack'; seq: number } | { type: 'status' }

export type StreamFrameMessage = {
  type: 'frame'; seq: number; data: string;
  metadata: { offsetTop: number; pageScaleFactor: number; deviceWidth: number; deviceHeight: number; scrollOffsetX: number; scrollOffsetY: number; timestamp: number }
}
export type StreamStatusMessage = { type: 'status'; connected: boolean; screencasting: boolean; viewportWidth: number; viewportHeight: number; engine: string; recording: boolean }
export type StreamServerMessage = StreamFrameMessage | StreamStatusMessage
  | { type: 'url'; url: string; timestamp: number }
  | { type: 'tabs'; tabs: BrowserTab[]; timestamp: number }
  | { type: 'error'; message: string }
  | { type: 'command'; action: string; id: string; params: unknown; timestamp: number }
  | { type: 'result'; id: string; action: string; success: boolean; data: unknown; duration_ms: number; timestamp: number }
  | { type: 'console'; level: string; text: string; args?: unknown[]; timestamp: number }
  | { type: 'page_error'; text: string; line: number | null; column: number | null; timestamp: number }
