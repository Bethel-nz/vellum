// Deleted notes, kept for 30 days (Settings › Trash). Deleting moves a note's records from
// threads/ to trash/, beside a small record of what it was and when it went. Restoring moves it
// back as it was. A note past 30 days is deleted for good the next time Vellum looks: at launch,
// and when the Trash tab opens. Pasted images stay in images/; a restored note still finds them.

// Moving a note in or out is renames, which Bun.file has no form of, so those stay node:fs and
// synchronous: the caller acts on the answer at once. Reading what's in the trash is Bun.file.
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import { loadJson, paths, writeJson } from './store'
import { readThread, type Thread } from './threads'

export const TRASH_DAYS = 30
const DAY = 86_400_000

export type Trashed = { id: string; title: string; workspace: string; profileId: string; deletedAt: string }

const dir = () => path.join(paths.home, 'trash')
const records = (id: string) => path.join(dir(), `${id}.jsonl`)
const about = (id: string) => path.join(dir(), `${id}.json`)
const live = (id: string) => path.join(paths.threads, `${id}.jsonl`)

/** Moves a note to the trash. The caller closes its tab and ends its agent first. */
export function trashNote(thread: Pick<Thread, 'id' | 'title' | 'workspace' | 'profileId'>, now = new Date()): boolean {
  if (!existsSync(live(thread.id))) return false
  mkdirSync(dir(), { recursive: true })
  renameSync(live(thread.id), records(thread.id))
  const captures = path.join(paths.captures, thread.id)
  if (existsSync(captures)) renameSync(captures, path.join(dir(), `${thread.id}.captures`))
  const entry: Trashed = { id: thread.id, title: thread.title, workspace: thread.workspace, profileId: thread.profileId, deletedAt: now.toISOString() }
  writeJson(about(thread.id), entry)
  return true
}

/** Every trash entry, read side by side; a file that can't be read counts as none. */
async function entries(): Promise<Trashed[]> {
  let files: string[]
  try {
    files = readdirSync(dir()).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
  const all = await Promise.all(files.map((f) => loadJson<Trashed | undefined>(path.join(dir(), f), undefined)))
  return all.filter((t): t is Trashed => Boolean(t?.id))
}

/** What's in the trash, most recently deleted first, after clearing out anything past its time. */
export async function trashed(now = new Date()): Promise<Trashed[]> {
  const all = await entries()
  for (const t of all) if (expired(t, now)) deleteForever(t.id)
  return all.filter((t) => !expired(t, now) && existsSync(records(t.id))).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
}

/** Days until a trashed note is deleted for good: 30 on the day it went, 1 on its last. */
export function daysLeft(t: Trashed, now = new Date()): number {
  return Math.max(1, TRASH_DAYS - Math.floor((now.getTime() - new Date(t.deletedAt).getTime()) / DAY))
}

/** Puts a note back where it was; undefined if it's gone, or a note with its id exists again. */
export async function restoreNote(id: string): Promise<Thread | undefined> {
  if (!existsSync(records(id)) || existsSync(live(id))) return undefined
  renameSync(records(id), live(id))
  const captures = path.join(dir(), `${id}.captures`)
  if (existsSync(captures)) {
    mkdirSync(paths.captures, { recursive: true })
    renameSync(captures, path.join(paths.captures, id))
  }
  rmSync(about(id), { force: true })
  return readThread(live(id))
}

export function deleteForever(id: string) {
  rmSync(records(id), { force: true })
  rmSync(about(id), { force: true })
  rmSync(path.join(dir(), `${id}.captures`), { recursive: true, force: true })
}

export async function emptyTrash() {
  for (const t of await entries()) deleteForever(t.id)
}

function expired(t: Trashed, now: Date): boolean {
  const at = new Date(t.deletedAt).getTime()
  return !Number.isNaN(at) && now.getTime() - at >= TRASH_DAYS * DAY
}

/** Deletes for good what has been in the trash for 30 days or more. */
export async function purgeTrash(now = new Date()) {
  for (const t of await entries()) if (expired(t, now)) deleteForever(t.id)
}
