// A note out of Vellum: a .vel to open and carry on elsewhere, or Markdown for another agent.

import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { paths } from './store'
import { hunksOnly, newThreadId, type Thread } from './threads'

const VERSION = 1

type Header = { type: 'vellum/export'; version: number; home: string; title: string; exportedAt: string }
type Asset = { type: 'vellum/asset'; path: string; data: string }

/** Where exports of a project go: the setting's folder, or ~/Downloads/vellum/export, then the project's name. */
export function exportDir(setting: string | undefined, workspace: string): string {
  return path.join(setting || path.join(homedir(), 'Downloads', 'vellum', 'export'), path.basename(workspace) || 'notes')
}

/** A file name from the title that doesn't overwrite an earlier export. */
function freeName(dir: string, title: string, ext: string): string {
  const base = title.replace(/[/\\:*?"<>|\n]+/g, ' ').trim().slice(0, 80) || 'note'
  for (let n = 1; ; n++) {
    const file = path.join(dir, `${base}${n > 1 ? ` ${n}` : ''}${ext}`)
    if (!existsSync(file)) return file
  }
}

/** Every string in a record, mapped. */
function mapStrings(v: unknown, f: (s: string) => string): unknown {
  if (typeof v === 'string') return f(v)
  if (Array.isArray(v)) return v.map((x) => mapStrings(x, f))
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapStrings(x, f)]))
  return v
}

/** The note's records with every file of Vellum's they point at (pasted images, captures) inside. */
export async function writeVel(t: Thread, dir: string): Promise<string> {
  const lines = (await Bun.file(path.join(paths.threads, `${t.id}.jsonl`)).text()).split('\n').filter((l) => l.trim())
  const files = new Set<string>()
  for (const line of lines) {
    try {
      mapStrings(JSON.parse(line), (s) => {
        if (s.startsWith(paths.home + path.sep) && assetPath(path.relative(paths.home, s), t.id) && existsSync(s) && statSync(s).isFile()) files.add(s)
        return s
      })
    } catch {}
  }
  const header: Header = { type: 'vellum/export', version: VERSION, home: paths.home, title: t.title, exportedAt: new Date().toISOString() }
  const assets: Asset[] = await Promise.all([...files].map(async (file) => ({ type: 'vellum/asset' as const, path: path.relative(paths.home, file), data: Buffer.from(await Bun.file(file).arrayBuffer()).toString('base64') })))
  mkdirSync(dir, { recursive: true })
  const out = freeName(dir, t.title, '.vel')
  await Bun.write(out, [header, ...assets].map((r) => JSON.stringify(r)).concat(lines).join('\n') + '\n')
  return out
}

/** Where a note's files may live, relative to Vellum's home: never its settings, accounts or MCP config. */
function assetPath(rel: string, noteId: string): string | undefined {
  const parts = path.normalize(rel).split(path.sep)
  if (path.isAbsolute(rel) || parts.includes('..')) return
  if (parts[0] === 'images' && parts.length === 2) return rel
  if (parts[0] === 'captures' && parts.length > 2 && parts[1] === noteId) return rel
}

/** A .vel as a new note; off its own machine and account, the next message carries the note so far. */
export async function readVel(file: string, here: { profiles: string[]; profileId: string; workspace?: string; known: string[] }): Promise<string> {
  const lines = (await Bun.file(file).text()).split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
  const header = lines[0] as Header
  if (header?.type !== 'vellum/export') throw new Error('This isn’t a Vellum export.')
  if (header.version > VERSION) throw new Error('This export is from a newer Vellum.')
  const meta = lines.find((r) => r.type === 'vellum/meta')?.meta
  if (!meta?.id) throw new Error('This export has no note in it.')
  const oldId = String(meta.id)
  const id = newThreadId()
  // Its own captures folder moves to the new id; everything else of Vellum's is out of reach.
  const local = (rel: string) => rel.replace(`captures${path.sep}${oldId}${path.sep}`, `captures${path.sep}${id}${path.sep}`)
  for (const rec of lines) {
    if (rec.type !== 'vellum/asset' || !assetPath(String(rec.path), oldId)) continue
    const to = path.join(paths.home, local(path.normalize(rec.path)))
    if (existsSync(to)) continue
    mkdirSync(path.dirname(to), { recursive: true })
    if (!realpathSync(path.dirname(to)).startsWith(realpathSync(paths.home) + path.sep)) continue
    await Bun.write(to, Buffer.from(String(rec.data), 'base64'))
  }
  let sameAccount = header.home === paths.home && here.profiles.includes(meta.profileId)
  if (!here.profiles.includes(meta.profileId)) meta.profileId = here.profileId
  if (!here.known.includes(meta.workspace)) {
    if (!here.workspace) throw new Error('Open a project first; the note opens in it.')
    meta.workspace = here.workspace
    sameAccount = false
  }
  const records = lines.filter((r) => r.type !== 'vellum/export' && r.type !== 'vellum/asset')
  const moved = records.map((r) => mapStrings(r, (s) => (s === oldId ? id : s.startsWith(header.home + path.sep) ? paths.home + local(s.slice(header.home.length)) : s)))
  moved.push({ type: 'vellum/imported', fresh: !sameAccount, at: new Date().toISOString() })
  await Bun.write(path.join(paths.threads, `${id}.jsonl`), moved.map((r) => JSON.stringify(r)).join('\n') + '\n')
  return id
}

const attr = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/\n/g, ' ')
const tag = (name: string, attrs: Record<string, unknown>, body?: string) => {
  const a = Object.entries(attrs).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => ` ${k}="${attr(v)}"`).join('')
  return body === undefined ? `<${name}${a} />` : `<${name}${a}>\n${body}\n</${name}>`
}
const fence = (lang: string, body: string) => `\`\`\`${lang}\n${body.trimEnd()}\n\`\`\``

/** The note for another agent: prose as Markdown, each component an XML-style tag. */
export function agentMarkdown(t: Thread, agent: string): string {
  const out = ['---', `title: ${JSON.stringify(t.title)}`, `workspace: ${JSON.stringify(t.workspace)}`, `created: ${t.createdAt}`, '---', '']
  let speaker = ''
  const say = (who: string) => {
    if (speaker !== who) out.push(`## ${who}`, '')
    speaker = who
  }
  for (const b of t.blocks) {
    if (b.kind === 'user') {
      say('You')
      out.push(b.text, '')
      continue
    }
    say(agent)
    switch (b.kind) {
      case 'assistant':
        out.push(b.markdown, '')
        break
      case 'activity':
        if (b.items.length) out.push(tag('tools', { summary: b.summary }, b.items.map((c) => tag('tool', { name: c.name, status: c.status }, c.detail || '')).join('\n')), '')
        break
      case 'edit':
        out.push(tag('edit', { path: b.path, added: b.added, removed: b.removed, status: b.status === 'ok' ? undefined : b.status }, fence('diff', hunksOnly(b.patch))), '')
        break
      case 'shell':
        out.push(tag('shell', { command: b.command, exit: b.exitCode }, fence('console', b.output ?? '')), '')
        break
      case 'capture':
        out.push(tag('capture', { url: b.saved.capture.page.url, status: b.saved.status }, b.saved.capture.elements.map((e) => `- ${e.note || e.selector}`).join('\n')), '')
        break
      case 'browser':
        out.push(tag('browser', { url: b.browser.url || b.browser.session }), '')
        break
      case 'approval':
        out.push(tag('approval', { tool: b.tool, decision: b.decision }, [b.title, b.detail, b.message].filter(Boolean).join('\n')), '')
        break
      case 'error':
        out.push(tag('error', {}, b.text), '')
        break
      case 'compact':
        out.push(tag('compact', { trigger: b.trigger }), '')
        break
      case 'moved':
        out.push(tag('moved', { from: b.from, to: b.to }), '')
        break
      case 'git':
        if (b.also.length) out.push(tag('also-changed', {}, b.also.join('\n')), '')
        break
    }
  }
  return out.join('\n').trimEnd() + '\n'
}

export async function writeMarkdownExport(t: Thread, agent: string, dir: string): Promise<string> {
  mkdirSync(dir, { recursive: true })
  const out = freeName(dir, t.title, '.md')
  await Bun.write(out, agentMarkdown(t, agent))
  return out
}
