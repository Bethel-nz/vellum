// Context tokens: a file index per workspace, skill discovery, fuzzy filtering, parsing tokens
// out of text for chips, line slices for hover, and the translation of tokens into the prompt
// Claude Code receives. `promptFor` is the only place that translation happens.
//
//   #path        a file; becomes `@path`, which headless `claude -p` expands itself. The text
//                carries only as much of the path as tells the note's files apart
//                (`#printed.ts`); the tag keeps the whole of it (`fileLabel`)
//   #path:42     one line of a file; Claude gets that line quoted, not the file, unless the
//                note widened the tag to the whole file
//   @dir/        a folder, passed through as `@dir/`
//   @name        a skill; becomes one plain instruction. Typing `@skill:` narrows the menu to
//                skills
//   ±path:12     a hunk from the Changes sheet; becomes "hunk 1 (path)" with the diff and your
//                line comments after the text
//
// `@path` for a file and `@skill:name` for a skill still parse (older notes wrote them that way).

import { readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { agentFor } from './agents'
import { readWorkspaceFile } from './files'
import type { Profile } from './profiles'
import { noteLabel } from './changes'
import { scopeKey, type HunkNote, type Tag } from './threads'

export type Suggestion = Tag & { label: string; hint: string }

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'target', '.next', 'out', '.turbo', '.cache', 'coverage', 'vendor'])
const index = new Map<string, Promise<string[]>>()
const name = 'test'

async function gitFiles(workspace: string): Promise<string[] | undefined> {
  // The repo's config may name an fsmonitor to run; Vellum isn't sandboxed, so it never runs one.
  const proc = Bun.spawn(['git', '-c', 'core.fsmonitor=false', 'ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: workspace,
    stdout: 'pipe',
    stderr: 'ignore',
  })
  const out = await new Response(proc.stdout).text()
  if ((await proc.exited) !== 0) return undefined
  return out.split('\n').filter(Boolean)
}

function walk(workspace: string, limit = 20000): string[] {
  const out: string[] = []
  const stack = ['']
  while (stack.length && out.length < limit) {
    const rel = stack.pop()!
    let entries: import('node:fs').Dirent[]
    try {
      entries = readdirSync(path.join(workspace, rel), { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.claude') continue
      const p = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) stack.push(p)
      } else out.push(p)
    }
  }
  return out
}

/** Files in the workspace, cached. */
export function workspaceFiles(workspace: string): Promise<string[]> {
  let p = index.get(workspace)
  if (!p) {
    p = gitFiles(workspace).then((files) => files ?? walk(workspace))
    index.set(workspace, p)
  }
  return p
}

export function invalidateFiles(workspace: string) {
  index.delete(workspace)
}

function folders(files: string[]): string[] {
  const set = new Set<string>()
  for (const f of files) {
    const parts = f.split('/')
    for (let i = 1; i < parts.length; i++) set.add(parts.slice(0, i).join('/') + '/')
  }
  return [...set]
}

/** The skills the note's agent can load, from the folders that agent reads (core/agents.ts). */
export function skills(workspace: string, profile: Profile, user = homedir()): string[] {
  const roots = agentFor(profile).skillRoots(workspace, profile.configDir ?? null, user)
  const names = new Set<string>()
  for (const root of roots) {
    let entries: string[]
    try {
      entries = readdirSync(root)
    } catch {
      continue
    }
    for (const name of entries) {
      try {
        if (statSync(path.join(root, name)).isDirectory() && Bun.file(path.join(root, name, 'SKILL.md')).size > 0) names.add(name)
      } catch {}
    }
  }
  return [...names].sort()
}

/** Subsequence match with a bonus for contiguous runs and basename hits. Lower is better; -1 is no match. */
function score(query: string, candidate: string): number {
  if (!query) return candidate.length
  const q = query.toLowerCase()
  const c = candidate.toLowerCase()
  const base = c.slice(c.lastIndexOf('/', c.length - 2) + 1)
  if (base.startsWith(q)) return c.length * 0.01
  let ci = 0
  let gaps = 0
  let last = -1
  for (const ch of q) {
    const found = c.indexOf(ch, ci)
    if (found < 0) return -1
    if (last >= 0 && found !== last + 1) gaps++
    last = found
    ci = found + 1
  }
  return 10 + gaps * 5 + c.length * 0.05
}

/** `#` asks for files only; `@` for skills, folders and files. */
export async function suggest(query: string, workspace: string, profile: Profile, limit = 8, filesOnly = false): Promise<Suggestion[]> {
  const files = await workspaceFiles(workspace)
  if (filesOnly) {
    return files
      .map((f) => ({ s: { type: 'file' as const, value: f, label: f, hint: '' }, n: score(query, f) }))
      .filter((x) => x.n >= 0)
      .sort((a, b) => a.n - b.n)
      .slice(0, limit)
      .map((x) => x.s)
  }
  const q = query.startsWith('skill:') ? query.slice(6) : query
  const pool: Suggestion[] = [
    ...skills(workspace, profile).map((s) => ({ type: 'skill' as const, value: s, label: `skill:${s}`, hint: 'Skill' })),
    ...(query.startsWith('skill:')
      ? []
      : [
          ...folders(files).map((f) => ({ type: 'folder' as const, value: f, label: f, hint: 'Folder' })),
          ...files.map((f) => ({ type: 'file' as const, value: f, label: f, hint: '' })),
        ]),
  ]
  return pool
    .map((s) => ({ s, n: score(q, s.type === 'skill' ? s.value : s.label) }))
    .filter((x) => x.n >= 0)
    .sort((a, b) => a.n - b.n)
    .slice(0, limit)
    .map((x) => x.s)
}

export function tagText(tag: Tag) {
  if (tag.type === 'skill') return `@${tag.value}`
  if (tag.type === 'folder') return `@${tag.value}`
  if (tag.type === 'hunk') return `±${tag.value}`
  return `#${tag.value}${tag.line ? `:${lineLabel(tag)}` : ''}`
}

/** `42` for a line tag, `12-18` for a range. */
export const lineLabel = (tag: { line?: number; endLine?: number }) => (tag.endLine ? `${tag.line}-${tag.endLine}` : `${tag.line ?? ''}`)

/**
 * What a file is written as in the text: the shortest end of its path that no other file in
 * `others` ends with, so `core/printed.ts` is `printed.ts` until `ui/printed.ts` joins it.
 */
export function fileLabel(value: string, others: string[]): string {
  const parts = value.split('/')
  for (let n = 1; n < parts.length; n++) {
    const end = parts.slice(-n).join('/')
    if (!others.some((o) => o !== value && (o === end || o.endsWith(`/${end}`)))) return end
  }
  return value
}

/** The file a written path means: the tag with exactly that path, else the first whose path ends with it. */
function fileFor(written: string, files: string[]): string | undefined {
  if (files.includes(written)) return written
  return files.find((f) => f.endsWith(`/${written}`))
}

/**
 * The text with every file tag written as its label among the files tagged in it. Run when a tag
 * joins the text, so the labels stay apart (a second `printed.ts` lengthens both).
 */
export function relabel(text: string, known: Tag[]): string {
  const present = tagsIn(text, known)
  const files = [...new Set(present.filter((t) => t.type === 'file').map((t) => t.value))]
  return tokens(text, known)
    .map((t) => (t.kind === 'tag' && t.tag.type === 'file' ? `#${fileLabel(t.tag.value, files)}${t.tag.line ? `:${lineLabel(t.tag)}` : ''}` : t.text))
    .join('')
}

export type Token = { kind: 'text'; text: string } | { kind: 'tag'; tag: Tag; text: string }

const TRAILING = /[.,;:!?)\]]+$/

/**
 * Splits text into plain runs and tokens. Only tags that were picked (or saved with the block)
 * become tokens, so a stray `#1` or an email address stays text.
 */
export function tokens(text: string, known: Tag[]): Token[] {
  const files = [...new Set(known.filter((t) => t.type === 'file').map((t) => t.value))]
  // Skills were written `@skill:name` before they read `@name`; notes from then still show them.
  const others = new Map(known.filter((t) => t.type !== 'file').flatMap((t) => [tagText(t), ...(t.type === 'skill' ? [`@skill:${t.value}`] : [])].map((text) => [text, t] as const)))
  const out: Token[] = []
  let plain = ''
  const flush = () => {
    if (plain) out.push({ kind: 'text', text: plain })
    plain = ''
  }
  // Picked paths may contain spaces; keep their full names and shortened labels together.
  const spaced = [...new Set(files.flatMap((file) => file.split('/').map((_, i, parts) => parts.slice(i).join('/'))).filter((file) => /\s/.test(file)))].sort((a, b) => b.length - a.length)
  const split = spaced.length
    ? new RegExp(String.raw`((?<!\S)[#@](?:${spaced.map((file) => file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?::\d+(?:-\d+)?)?[.,;:!?)\]]*(?=\s|$)|\s+)`)
    : /(\s+)/
  for (const part of text.split(split)) {
    const tail = TRAILING.exec(part)?.[0] ?? ''
    let word = tail ? part.slice(0, -tail.length) : part
    // A tag the text already has comes first: `@simdriver` is the skill even beside a file of that name.
    let tag: Tag | undefined = others.get(word)
    if (!tag && (word.startsWith('#') || word.startsWith('@'))) {
      // `#path:42` or `#path:12-18` — the trailing colon-number is the line or range; `TRAILING`
      // may have eaten a lone ':'.
      const m = /^[#@](.+?)(?::(\d+)(?:-(\d+))?)?$/.exec(word)
      const end = m?.[3] ? Number(m[3]) : 0
      const value = m ? fileFor(m[1]!, files) : undefined
      if (value) tag = { type: 'file', value, ...(m![2] ? { line: Number(m![2]) } : {}), ...(m![2] && end > Number(m![2]) ? { endLine: end } : {}) }
    }
    if (tag) {
      flush()
      out.push({ kind: 'tag', tag, text: word })
      plain = tail
    } else plain += part
  }
  flush()
  return out
}

/** Tags present in the text, in order, with the line each file tag points at. */
export function tagsIn(text: string, known: Tag[]): Tag[] {
  const seen = new Set<string>()
  const out: Tag[] = []
  for (const t of tokens(text, known)) {
    if (t.kind !== 'tag') continue
    const key = `${t.tag.type}:${tagText(t.tag)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t.tag)
  }
  return out
}

/**
 * Files a reply names in inline code (`ui/theme.ts`, `ui/theme.ts:42`) that exist in the
 * workspace, for its read-only chip row.
 */
export function mentionedFiles(markdown: string, workspace: string, limit = 6): Tag[] {
  const out: Tag[] = []
  const seen = new Set<string>()
  for (const m of markdown.matchAll(/`([\w@][\w@./-]*\.\w+)(?::(\d+))?`/g)) {
    const file = m[1]!
    const key = `${file}:${m[2] ?? ''}`
    if (seen.has(key) || file.includes('..') || Bun.file(path.join(workspace, file)).size === 0) continue
    seen.add(key)
    out.push({ type: 'file', value: file, ...(m[2] ? { line: Number(m[2]) } : {}) })
    if (out.length >= limit) break
  }
  return out
}

export type Slice = { start: number; lines: string[] }

/**
 * The line a `#path:42` tag points at, the lines of a `#path:12-18` range, or the head of the file
 * for a plain file tag.
 */
export function readSlice(workspace: string, file: string, line?: number, endLine?: number, head = 4): Slice | undefined {
  const text = readWorkspaceFile(workspace, file)
  if (text === undefined) return
  const all = text.split('\n')
  if (line) return line <= all.length ? { start: line, lines: all.slice(line - 1, Math.max(line, Math.min(endLine ?? line, all.length))) } : undefined
  return { start: 1, lines: all.slice(0, head) }
}

/** True when a line tag reaches Claude as its whole file. */
export const widened = (tag: Tag, scopes: Record<string, 'file'> = {}) =>
  tag.type === 'file' && Boolean(tag.line) && (tag.scope === 'file' || scopes[scopeKey(tag.value, tag.line!)] === 'file')

/**
 * The prompt Claude receives. Files become `@path`; a line tag becomes `path:42` with that one
 * line quoted after the text, unless it was widened, in which case it is `@path (line 42)`.
 */
export function promptFor(text: string, tags: Tag[], ctx: { workspace?: string; scopes?: Record<string, 'file'> } = {}): string {
  const skillNames: string[] = []
  const quotes: string[] = []
  const hunks: Extract<Tag, { type: 'hunk' }>[] = []
  let out = ''
  for (const t of tokens(text, tags)) {
    if (t.kind === 'text') {
      out += t.text
      continue
    }
    const tag = t.tag
    if (tag.type === 'skill') {
      out += `"${tag.value}" skill`
      if (!skillNames.includes(tag.value)) skillNames.push(tag.value)
    } else if (tag.type === 'folder') out += `@${tag.value}`
    else if (tag.type === 'hunk' && tag.comments) {
      out += `${tag.path} line ${tag.notes?.[0]?.line ?? ''}`.trimEnd()
      const quote = commentQuote(tag)
      if (!quotes.includes(quote)) quotes.push(quote)
    } else if (tag.type === 'hunk') {
      if (!hunks.includes(tag)) hunks.push(tag)
      out += `hunk ${hunks.indexOf(tag) + 1} (${tag.path})`
    } else if (!tag.line) out += `@${tag.value}`
    else if (widened(tag, ctx.scopes)) out += `@${tag.value} (${tag.endLine ? 'lines' : 'line'} ${lineLabel(tag)})`
    else {
      out += `${tag.value}:${lineLabel(tag)}`
      const slice = ctx.workspace ? readSlice(ctx.workspace, tag.value, tag.line, tag.endLine) : undefined
      const fence = slice?.lines.some((l) => l.includes('```')) ? '````' : '```'
      const quoted = slice ? `\n\n${fence}\n${slice.lines.map((l, i) => `${slice.start + i} | ${l}`).join('\n')}\n${fence}` : ''
      const which = tag.endLine ? `lines ${tag.line}–${tag.endLine}` : `line ${tag.line}`
      const note = `Refer only to ${which} of ${tag.value} (quoted below); read the file first if you need more.${quoted}`
      if (!quotes.includes(note)) quotes.push(note)
    }
  }
  for (const q of quotes) out += `\n\n${q}`
  hunks.forEach((h, i) => (out += `\n\n${hunkQuote(h, i + 1)}`))
  for (const name of skillNames) out += `\n\nUse the "${name}" skill for this.`
  return out
}

/** A hunk as Claude reads it: which edit, the diff itself, then your comments line by line. */
function hunkQuote(h: Extract<Tag, { type: 'hunk' }>, n: number): string {
  const fence = h.patch.includes('```') ? '````' : '```'
  const diff = `${fence}diff\n--- a/${h.path}\n+++ b/${h.path}\n${h.patch.trimEnd()}\n${fence}`
  const notes = (h.notes ?? []).map(noteLine)
  return [`Hunk ${n}, from an edit you made to ${h.path}:`, diff, ...(notes.length ? ['My comments on its lines:', ...notes] : [])].join('\n')
}

/** Comments without their hunk: the file, then each line's number, code and comment. */
function commentQuote(h: Extract<Tag, { type: 'hunk' }>): string {
  return [`My comments on ${h.path}:`, ...(h.notes ?? []).map(noteLine)].join('\n')
}

function noteLine(x: HunkNote): string {
  const where = x.endLine ? `lines ${noteLabel(x)}` : `${x.side === 'old' ? 'removed' : 'new'} line ${x.line}`
  const code = x.code.includes('\n') ? `\n  \`\`\`\n${x.code.split('\n').map((l) => `  ${l}`).join('\n')}\n  \`\`\`\n  ` : ` \`${x.code.trim().slice(0, 120)}\`: `
  return `- ${where}${code}${x.text}`
}
