import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { copyFile, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { captureFiles, type Capture, type CaptureStatus, type SavedCapture } from './capture'
import { paths, readJson } from './store'

export const plainName = (name: unknown): name is string => typeof name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,159}$/.test(name) && !name.includes('..')
export const captureDir = (noteId: string, id: string) => {
  if (!plainName(noteId) || !plainName(id)) throw new Error('Invalid capture or note id')
  return path.join(paths.captures, noteId, id)
}

export function validateCapture(value: unknown): Capture {
  const c = value as Capture
  const object = (v: unknown) => Boolean(v && typeof v === 'object' && !Array.isArray(v))
  const text = (v: unknown, max: number) => typeof v === 'string' && v.length <= max
  const styles = (v: unknown) => object(v) && Object.entries(v!).every(([key, val]) => text(key, 200) && text(val, 20000))
  if (!c || c.version !== 1 || !plainName(c.id) || !text(c.createdAt, 50) || !Number.isFinite(Date.parse(c.createdAt))) throw new Error('Invalid capture header')
  if (!object(c.page) || !text(c.page.url, 8192) || !/^https?:\/\//.test(c.page.url) || !text(c.page.title, 2000)) throw new Error('Invalid page')
  if (!object(c.page.viewport) || ![c.page.viewport.w, c.page.viewport.h, c.page.viewport.dpr].every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 100000)) throw new Error('Invalid viewport')
  if (!Array.isArray(c.elements) || !c.elements.length || c.elements.length > 50) throw new Error('Select between 1 and 50 elements')
  for (const el of c.elements) {
    if (!object(el) || !text(el.ref, 200) || !text(el.selector, 8192) || !text(el.html, 500000) || !styles(el.css) || (el.note !== undefined && !text(el.note, 20000))) throw new Error('Invalid element')
    if (!object(el.box) || ![el.box.x, el.box.y, el.box.w, el.box.h].every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 10000000) || el.box.w <= 0 || el.box.h <= 0) throw new Error('Invalid element bounds')
    if (!object(el.shots) || !plainName(el.shots.element) || !Array.isArray(el.animations) || el.animations.length > 200) throw new Error('Invalid element images or animations')
    if (el.snapshots !== undefined) {
      if (!Array.isArray(el.snapshots) || el.snapshots.length > 12) throw new Error('Invalid capture stack')
      for (const snapshot of el.snapshots) {
        if (!object(snapshot) || !plainName(snapshot.id) || !text(snapshot.createdAt, 50) || !Number.isFinite(Date.parse(snapshot.createdAt)) || !object(snapshot.image) || !plainName(snapshot.image.file) || snapshot.image.mime !== 'image/png' || !text(snapshot.image.dataUrl, 14000030) || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(snapshot.image.dataUrl)) throw new Error('Invalid captured image')
        if (!object(snapshot.node) || 'snapshots' in snapshot.node || snapshot.node.shots?.element !== snapshot.image.file) throw new Error('Invalid captured node')
        validateCapture({ ...c, assets: undefined, pageShot: undefined, elements: [snapshot.node] })
      }
    }
    for (const animation of el.animations) {
      if (!object(animation) || !['extracted', 'sampled'].includes(animation.origin) || !['css-animation', 'css-transition', 'waapi', 'js'].includes(animation.kind) || (animation.frames !== undefined && (!Array.isArray(animation.frames) || animation.frames.length > 20))) throw new Error('Invalid animation')
    }
  }
  if (c.assets !== undefined && (!Array.isArray(c.assets) || c.assets.length > 500 || c.assets.some((asset) => !object(asset) || !text(asset.url, 8192)))) throw new Error('Invalid assets')
  if (captureFiles(c).some((file) => !plainName(file) || file === 'capture.json' || file === 'status.json')) throw new Error('Invalid image file name')
  return c
}

export function saveCapture(noteId: string, capture: Capture, files: Map<string, Uint8Array>): SavedCapture {
  const dir = captureDir(noteId, capture.id)
  if (existsSync(dir)) throw new Error('This capture already exists')
  const expected = captureFiles(capture)
  if (expected.some((name) => !files.has(name))) throw new Error('A capture image is missing')
  const parent = path.dirname(dir)
  mkdirSync(parent, { recursive: true, mode: 0o700 })
  const temporary = `${dir}.${crypto.randomUUID()}.upload`
  mkdirSync(temporary, { mode: 0o700 })
  try {
    writeFileSync(path.join(temporary, 'capture.json'), JSON.stringify(capture, null, 2), { mode: 0o600 })
    writeFileSync(path.join(temporary, 'status.json'), JSON.stringify({ status: 'queued' }), { mode: 0o600 })
    for (const name of expected) writeFileSync(path.join(temporary, name), files.get(name)!, { mode: 0o600 })
    renameSync(temporary, dir)
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true })
    throw error
  }
  return { noteId, capture, status: 'queued' }
}

export function readCapture(noteId: string, id: string): SavedCapture | undefined {
  const dir = captureDir(noteId, id)
  const capture = readJson<Capture | undefined>(path.join(dir, 'capture.json'), undefined)
  if (!capture) return
  const status = readJson<{ status: CaptureStatus; summary?: string; reply?: string; delivery?: 'send' | 'sent' }>(path.join(dir, 'status.json'), { status: 'queued' })
  return { capture, noteId, ...status }
}

export function listCaptures(noteId: string): SavedCapture[] {
  if (!plainName(noteId)) return []
  const dir = path.join(paths.captures, noteId)
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((id) => plainName(id) && existsSync(path.join(dir, id, 'capture.json'))).flatMap((id) => readCapture(noteId, id) ?? []).sort((a, b) => a.capture.createdAt.localeCompare(b.capture.createdAt))
}

export function changeCapture(noteId: string, id: string, patch: { status?: CaptureStatus; summary?: string; reply?: string; delivery?: 'send' | 'sent' }): SavedCapture {
  const saved = readCapture(noteId, id)
  if (!saved) throw new Error('Capture not found')
  const next = { ...saved, ...patch }
  writeFileSync(path.join(captureDir(noteId, id), 'status.json'), JSON.stringify({ status: next.status, summary: next.summary, reply: next.reply, delivery: next.delivery }), { mode: 0o600 })
  return next
}

/** Copy every captured asset before the caller redirects or queues the work. The source stays intact. */
export async function copyCapture(saved: SavedCapture, noteId: string): Promise<SavedCapture> {
  if (saved.noteId === noteId) throw new Error('Choose a different note')
  const original = validateCapture(saved.capture)
  const capture = { ...original, id: crypto.randomUUID() }
  const source = captureDir(saved.noteId, original.id)
  const destination = captureDir(noteId, capture.id)
  const temporary = `${destination}.copy`
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
  await mkdir(temporary, { mode: 0o700 })
  try {
    const copied = await Promise.allSettled([
      writeFile(path.join(temporary, 'capture.json'), JSON.stringify(capture, null, 2), { mode: 0o600 }),
      writeFile(path.join(temporary, 'status.json'), JSON.stringify({ status: 'queued' }), { mode: 0o600 }),
      ...captureFiles(capture).map((name) => copyFile(path.join(source, name), path.join(temporary, name))),
    ])
    const failed = copied.find((result) => result.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
    await rename(temporary, destination)
  } catch (error) { await rm(temporary, { recursive: true, force: true }); throw error }
  return { capture, noteId, status: 'queued' }
}

export function captureImages(saved: SavedCapture): string[] {
  return captureFiles(saved.capture).filter((name) => /\.(png|jpe?g|webp)$/i.test(name)).map((name) => path.join(captureDir(saved.noteId, saved.capture.id), name))
}

export function captureImageContent(saved: SavedCapture) {
  return captureImages(saved).slice(0, 8).filter(existsSync).map((file) => ({ type: 'image', mimeType: /\.png$/i.test(file) ? 'image/png' : /\.webp$/i.test(file) ? 'image/webp' : 'image/jpeg', data: readFileSync(file).toString('base64') }))
}
