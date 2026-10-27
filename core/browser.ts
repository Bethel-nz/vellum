import path from 'node:path'
import { compiled } from './platform'

export const helperDir = () => compiled ? path.join(path.dirname(process.execPath), 'helpers') : path.resolve(import.meta.dir, '../bin')
const sessions = new Set<string>()
export function rememberBrowser(noteId: string) { sessions.add(noteId) }
export function closeBrowser(noteId: string) {
  if (!sessions.delete(noteId)) return
  try { Bun.spawn(['agent-browser', '--session', `vellum-${noteId}`, 'close'], { stdout: 'ignore', stderr: 'ignore' }) } catch {}
}
export function closeAllBrowsers() { for (const noteId of [...sessions]) closeBrowser(noteId) }
