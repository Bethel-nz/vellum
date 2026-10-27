// agent-browser v0.39.1, cli/src/connection.rs: Response.
export type CliResponse<T> = { success: boolean; data: T | null; error: string | null; code?: string; warning?: string }

// cli/src/native/actions.rs: current_stream_status / handle_stream_status.
export type StreamStatusData = { enabled: boolean; port: number | null; connected: boolean; screencasting: boolean }

// cli/src/native/actions.rs: handle_session_info.
export type SessionRuntimeData = {
  session: string; namespace: string | null; socketDir: string; backgroundPid: number; browserLaunched: boolean; pageCount: number;
  engine: string; launchHash: number | null; compatibilityStatus: string;
  effectiveLaunch: { browserLaunched: boolean; engine: string; launchHash: number | null };
  restoreKey: string | null; restoreStatus: string; restoreStatusDetail: string | null; restoreLoadedPath: string | null;
  restoreValidationPending: boolean; restoreSave: string; saveStatus: string; restoreSavedPath: string | null;
  restoreCheckUrl: string | null; restoreCheckText: string | null; restoreCheckFn: string | null
}

// cli/src/main.rs: run_session_info wraps handle_session_info without launching a daemon.
export type SessionInfoData = {
  session: string; namespace: string | null; socketDir: string; active: boolean; pid: number | null; version: string | null;
  runtime: SessionRuntimeData | null; runtimeError: string | null
}

// cli/src/native/actions.rs: handle_url.
export type GetUrlData = { url: string }

// cli/src/native/actions.rs: handle_launch_inner, CDP URL/port and reuse branches.
export type ConnectData = { launched: boolean; relaunchedBrowser: boolean; reused?: boolean }

// cli/src/native/browser.rs: BrowserManager::tab_list, via actions.rs: handle_tab_list.
export type BrowserTab = { tabId: string; targetId: string; label: string | null; title: string; url: string; type: string; active: boolean }
// cli/src/native/actions.rs: handle_tab_list.
export type TabListData = { tabs: BrowserTab[] }
// cli/src/native/browser.rs: BrowserManager::tab_new, via actions.rs: handle_tab_new (conditional navigation title).
export type TabNewData = { tabId: string; targetId: string; label: string | null; url: string; total: number; title?: string }
// cli/src/native/browser.rs: BrowserManager::tab_switch, via actions.rs: handle_tab_switch.
export type TabSwitchData = { tabId: string; targetId: string; label: string | null; url: string; title: string; revived?: boolean; dialogBlocked?: boolean }
// cli/src/native/browser.rs: BrowserManager::tab_close, via actions.rs: handle_tab_close.
export type TabCloseData = { tabId: string; targetId: string; label: string | null; closed: boolean; activeTabRevived?: boolean }
// cli/src/commands.rs: parse_command_inner (tab), cli/src/native/actions.rs: handle_tab_*.
export type TabData = TabListData | TabNewData | TabSwitchData | TabCloseData

// cli/src/native/actions.rs: handle_viewport.
export type ViewportData = { width: number; height: number; deviceScaleFactor: number; mobile: boolean }
// cli/src/native/actions.rs: handle_close.
export type CloseData = { closed: boolean; restoreStatus: string; saveStatus: string; statePath?: string; saveError?: string }
// cli/src/native/actions.rs: handle_snapshot, non-delta branch (snapshot -i).
export type SnapshotData = { snapshot: string; origin: string; refs: Record<string, { role: string; name: string }>; removedRefs: string[] }
// cli/src/native/screenshot.rs: ScreenshotAnnotation::serialize.
export type ScreenshotAnnotation = { ref: string; number: number; role: string; name?: string; box: { x: number; y: number; width: number; height: number } }
// cli/src/native/actions.rs: handle_screenshot / observe_screenshot (--if-changed may omit path).
export type ScreenshotData = ({ path: string } | { path?: string; changed: boolean; revision: number; pixelChangeRatio: number; threshold: number }) & { annotations?: ScreenshotAnnotation[] }
// cli/src/native/recording.rs: recording_start, via actions.rs: handle_recording_start.
export type RecordStartData = { started: boolean; path: string; fps: number; cursor: boolean; contactSheet: boolean; contactSheetPath?: string; contactSheetThreshold?: number }
// cli/src/native/recording.rs: recording_stop, via actions.rs: handle_recording_stop.
export type RecordStopData = { path: string; frames: number; capturedFrames: number; fps: number; contactSheetPath?: string; contactSheetFrames?: number; contactSheetThreshold?: number }
