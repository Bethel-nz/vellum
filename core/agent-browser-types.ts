// The pinned agent-browser CLI's response types.
export type CliResponse<T> = { success: boolean; data: T | null; error: string | null; code?: string; warning?: string }

export type StreamStatusData = { enabled: boolean; port: number | null; connected: boolean; screencasting: boolean }

export type SessionRuntimeData = {
  session: string; namespace: string | null; socketDir: string; backgroundPid: number; browserLaunched: boolean; pageCount: number;
  engine: string; launchHash: number | null; compatibilityStatus: string;
  effectiveLaunch: { browserLaunched: boolean; engine: string; launchHash: number | null };
  restoreKey: string | null; restoreStatus: string; restoreStatusDetail: string | null; restoreLoadedPath: string | null;
  restoreValidationPending: boolean; restoreSave: string; saveStatus: string; restoreSavedPath: string | null;
  restoreCheckUrl: string | null; restoreCheckText: string | null; restoreCheckFn: string | null
}

export type SessionInfoData = {
  session: string; namespace: string | null; socketDir: string; active: boolean; pid: number | null; version: string | null;
  runtime: SessionRuntimeData | null; runtimeError: string | null
}

export type GetUrlData = { url: string }

export type ConnectData = { launched: boolean; relaunchedBrowser: boolean; reused?: boolean }

export type BrowserTab = { tabId: string; targetId: string; label: string | null; title: string; url: string; type: string; active: boolean }
export type TabListData = { tabs: BrowserTab[] }
export type TabNewData = { tabId: string; targetId: string; label: string | null; url: string; total: number; title?: string }
export type TabSwitchData = { tabId: string; targetId: string; label: string | null; url: string; title: string; revived?: boolean; dialogBlocked?: boolean }
export type TabCloseData = { tabId: string; targetId: string; label: string | null; closed: boolean; activeTabRevived?: boolean }
export type TabData = TabListData | TabNewData | TabSwitchData | TabCloseData

export type ViewportData = { width: number; height: number; deviceScaleFactor: number; mobile: boolean }
export type CloseData = { closed: boolean; restoreStatus: string; saveStatus: string; statePath?: string; saveError?: string }
export type SnapshotData = { snapshot: string; origin: string; refs: Record<string, { role: string; name: string }>; removedRefs: string[] }
export type ScreenshotAnnotation = { ref: string; number: number; role: string; name?: string; box: { x: number; y: number; width: number; height: number } }
export type ScreenshotData = ({ path: string } | { path?: string; changed: boolean; revision: number; pixelChangeRatio: number; threshold: number }) & { annotations?: ScreenshotAnnotation[] }
export type RecordStartData = { started: boolean; path: string; fps: number; cursor: boolean; contactSheet: boolean; contactSheetPath?: string; contactSheetThreshold?: number }
export type RecordStopData = { path: string; frames: number; capturedFrames: number; fps: number; contactSheetPath?: string; contactSheetFrames?: number; contactSheetThreshold?: number }
