// Deleted notes, kept for 30 days (Settings › Trash). Deleting moves a note's records from
// threads/ to trash/, beside a small record of what it was and when it went. Restoring moves it
// back as it was. A note past 30 days is deleted for good the next time Vellum looks: at launch,
// and when the Trash tab opens. Pasted images stay in images/; a restored note still finds them.

import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import { paths, readJson, writeJson } from './store'
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
  const entry: Trashed = { id: thread.id, title: thread.title, workspace: thread.workspace, profileId: thread.profileId, deletedAt: now.toISOString() }
  writeJson(about(thread.id), entry)
  return true
}

/** What's in the trash, most recently deleted first, after clearing out anything past its time. */
export function trashed(now = new Date()): Trashed[] {
  purgeTrash(now)
  if (!existsSync(dir())) return []
  return readdirSync(dir())
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson<Trashed | undefined>(path.join(dir(), f), undefined))
    .filter((t): t is Trashed => Boolean(t?.id) && existsSync(records(t!.id)))
    .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
}

/** Days until a trashed note is deleted for good: 30 on the day it went, 1 on its last. */
export function daysLeft(t: Trashed, now = new Date()): number {
  return Math.max(1, TRASH_DAYS - Math.floor((now.getTime() - new Date(t.deletedAt).getTime()) / DAY))
}

/** Puts a note back where it was; undefined if it's gone, or a note with its id exists again. */
export function restoreNote(id: string): Thread | undefined {
  if (!existsSync(records(id)) || existsSync(live(id))) return undefined
  renameSync(records(id), live(id))
  rmSync(about(id), { force: true })
  return readThread(live(id))
}

export function deleteForever(id: string) {
  rmSync(records(id), { force: true })
  rmSync(about(id), { force: true })
}

export function emptyTrash() {
  for (const t of trashed()) deleteForever(t.id)
}

/** Deletes for good what has been in the trash for 30 days or more. */
export function purgeTrash(now = new Date()) {
  if (!existsSync(dir())) return
  for (const f of readdirSync(dir())) {
    if (!f.endsWith('.json')) continue
    const t = readJson<Trashed | undefined>(path.join(dir(), f), undefined)
    const at = t ? new Date(t.deletedAt).getTime() : Number.NaN
    if (t && !Number.isNaN(at) && now.getTime() - at >= TRASH_DAYS * DAY) deleteForever(t.id)
  }
}
