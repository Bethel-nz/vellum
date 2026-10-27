import type { BrowserTab } from './agent-browser-types'

// agent-browser v0.39.1, cli/src/native/stream/websocket.rs: dispatch_input.
// Mouse defaults: button=none, clickCount=0; keyboard VK/modifiers=0.
export type StreamMouseInput = {
  type: 'input_mouse'; eventType?: 'mousePressed' | 'mouseReleased' | 'mouseMoved' | 'mouseWheel'; x?: number; y?: number;
  button?: 'none' | 'left' | 'middle' | 'right' | 'back' | 'forward'; clickCount?: number; deltaX?: number; deltaY?: number; modifiers?: number
}
// websocket.rs: keyboard_params forwards key/code/text only when present.
export type StreamKeyboardInput = { type: 'input_keyboard'; eventType?: 'keyDown' | 'keyUp' | 'rawKeyDown' | 'char'; key?: string; code?: string; text?: string; windowsVirtualKeyCode?: number; modifiers?: number }
// websocket.rs: dispatch_input passes touchPoints through to CDP unchanged.
export type StreamTouchInput = { type: 'input_touch'; eventType?: 'touchStart' | 'touchEnd' | 'touchMove' | 'touchCancel'; touchPoints?: unknown[]; modifiers?: number }
export type BrowserInput = StreamMouseInput | StreamKeyboardInput | StreamTouchInput
// websocket.rs: apply_config / config_from_upgrade / parse_ack_seq. maxFps: integer 0–120, 0 uncapped.
export type StreamClientMessage = BrowserInput | { type: 'config'; maxFps?: number; pacing?: 'ack' | 'push' } | { type: 'ack'; seq: number } | { type: 'status' }

// cli/src/native/stream/mod.rs: StreamServer::broadcast_screencast_frame.
export type StreamFrameMessage = {
  type: 'frame'; seq: number; data: string;
  metadata: { offsetTop: number; pageScaleFactor: number; deviceWidth: number; deviceHeight: number; scrollOffsetX: number; scrollOffsetY: number; timestamp: number }
}
// websocket.rs: handle_ws_client; mod.rs: broadcast_status.
export type StreamStatusMessage = { type: 'status'; connected: boolean; screencasting: boolean; viewportWidth: number; viewportHeight: number; engine: string; recording: boolean }
// mod.rs: broadcast_{tabs,error,command,result,console,page_error}; cdp_loop.rs: publish_url.
export type StreamServerMessage = StreamFrameMessage | StreamStatusMessage
  | { type: 'url'; url: string; timestamp: number }
  | { type: 'tabs'; tabs: BrowserTab[]; timestamp: number }
  | { type: 'error'; message: string }
  | { type: 'command'; action: string; id: string; params: unknown; timestamp: number }
  | { type: 'result'; id: string; action: string; success: boolean; data: unknown; duration_ms: number; timestamp: number }
  | { type: 'console'; level: string; text: string; args?: unknown[]; timestamp: number }
  | { type: 'page_error'; text: string; line: number | null; column: number | null; timestamp: number }
