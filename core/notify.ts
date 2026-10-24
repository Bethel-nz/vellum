// macOS notifications for when Vellum is in the background and Claude needs you or is done
// (Settings › Notifications). Sent with osascript, the note's title passed as an argument, never
// spliced into the script. Elsewhere, and while Vellum is in front, the in-app toast is enough.

import { appendFileSync } from 'node:fs'
import { appIsActive } from './dock'
import { readSettings } from './store'

/** Notify, if the setting allows this kind and Vellum isn't the app in front. */
export function notify(kind: 'ask' | 'done', title: string, body: string) {
  if (process.platform !== 'darwin') return
  const want = readSettings().notify ?? 'asks'
  if (want === 'off' || (kind === 'done' && want !== 'all')) return
  if (appIsActive()) return
  // Checks set this to see what would be shown, without notifying the desktop.
  const log = process.env.VELLUM_NOTIFY_LOG
  if (log) return appendFileSync(log, JSON.stringify({ kind, title, body }) + '\n')
  // An automated run (GPUIX_BACKGROUND) never reaches the desktop; a check sets the log above.
  if (process.env.GPUIX_BACKGROUND) return
  Bun.spawn(['osascript', '-e', 'on run argv', '-e', 'display notification (item 2 of argv) with title (item 1 of argv)', '-e', 'end run', '--', title, body], { stdio: ['ignore', 'ignore', 'ignore'] })
}
