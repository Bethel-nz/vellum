// Context tokens: a file index per workspace, skill discovery, fuzzy filtering, parsing tokens
// out of text for chips, line slices for hover, and the translation of tokens into the prompt
// Claude Code receives. `promptFor` is the only place that translation happens.
//
//   #path        a file; becomes `@path`, which headless `claude -p` expands itself
//   #path:42     one line of a file; Claude gets that line quoted, not the file, unless the
//                note widened the tag to the whole file
//   @dir/        a folder, passed through as `@dir/`
//   @skill:name  a skill; becomes one plain instruction
//   ±path:12     a hunk from the Changes sheet; becomes "hunk 1 (path)" with the diff and your
//                line comments after the text
//
// `@path` for a file still parses (older notes wrote files that way).

import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
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

export function skills(workspace: string, profile: Profile): string[] {
  const roots = [
    path.join(workspace, '.claude', 'skills'),
    path.join(profile.configDir ?? path.join(homedir(), '.claude'), 'skills'),
  ]
  const names = new Set<string>()
  for (const root of roots) {
    if (!existsSync(root)) continue
    for (const name of readdirSync(root)) {
      try {
        if (statSync(path.join(root, name)).isDirectory() && existsSync(path.join(root, name, 'SKILL.md'))) names.add(name)
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
  if (tag.type === 'skill') return `@skill:${tag.value}`
  if (tag.type === 'folder') return `@${tag.value}`
  if (tag.type === 'hunk') return `±${tag.value}`
  return `#${tag.value}${tag.line ? `:${tag.line}` : ''}`
}

export type Token = { kind: 'text'; text: string } | { kind: 'tag'; tag: Tag; text: string }

const TRAILING = /[.,;:!?)\]]+$/

/**
 * Splits text into plain runs and tokens. Only tags that were picked (or saved with the block)
 * become tokens, so a stray `#1` or an email address stays text.
 */
export function tokens(text: string, known: Tag[]): Token[] {
  const files = new Set(known.filter((t) => t.type === 'file').map((t) => t.value))
  const others = new Set(known.filter((t) => t.type !== 'file').map((t) => tagText(t)))
  const out: Token[] = []
  let plain = ''
  const flush = () => {
    if (plain) out.push({ kind: 'text', text: plain })
    plain = ''
  }
  for (const part of text.split(/(\s+)/)) {
    const tail = TRAILING.exec(part)?.[0] ?? ''
    let word = tail ? part.slice(0, -tail.length) : part
    let tag: Tag | undefined
    if (word.startsWith('#') || (word.startsWith('@') && !word.startsWith('@skill:'))) {
      // `#path:42` — the trailing colon-number is the line; `TRAILING` may have eaten a lone ':'.
      const m = /^[#@](.+?)(?::(\d+))?$/.exec(word)
      if (m && files.has(m[1]!)) tag = { type: 'file', value: m[1]!, ...(m[2] ? { line: Number(m[2]) } : {}) }
    }
    if (!tag && others.has(word)) tag = known.find((t) => t.type !== 'file' && tagText(t) === word)
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
    if (seen.has(key) || file.includes('..') || !existsSync(path.join(workspace, file))) continue
    seen.add(key)
    out.push({ type: 'file', value: file, ...(m[2] ? { line: Number(m[2]) } : {}) })
    if (out.length >= limit) break
  }
  return out
}

export type Slice = { start: number; lines: string[] }

/** The line a `#path:42` tag points at, or the head of the file for a plain file tag. */
export function readSlice(workspace: string, file: string, line?: number, head = 4): Slice | undefined {
  const text = readWorkspaceFile(workspace, file)
  if (text === undefined) return
  const all = text.split('\n')
  if (line) return line <= all.length ? { start: line, lines: [all[line - 1]!] } : undefined
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
    else if (widened(tag, ctx.scopes)) out += `@${tag.value} (line ${tag.line})`
    else {
      out += `${tag.value}:${tag.line}`
      const slice = ctx.workspace ? readSlice(ctx.workspace, tag.value, tag.line) : undefined
      const quoted = slice ? `\n\n\`\`\`\n${tag.line} | ${slice.lines[0]}\n\`\`\`` : ''
      const note = `Refer only to line ${tag.line} of ${tag.value} (quoted below); read the file first if you need more.${quoted}`
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
