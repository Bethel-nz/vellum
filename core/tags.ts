// `@` tags: a file index per workspace, skill discovery, fuzzy filtering, and the
// translation of tags into prompt text Claude Code understands.
//
// Spike result: headless `claude -p` expands `@path` itself, so file and folder
// tags stay in the prompt as written. Skills become one plain instruction.

import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import type { Profile } from './profiles'
import type { Tag } from './threads'

export type Suggestion = Tag & { label: string; hint: string }

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'target', '.next', 'out', '.turbo', '.cache', 'coverage', 'vendor'])
const index = new Map<string, Promise<string[]>>()

async function gitFiles(workspace: string): Promise<string[] | undefined> {
  const proc = Bun.spawn(['git', 'ls-files', '--cached', '--others', '--exclude-standard'], {
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

export async function suggest(query: string, workspace: string, profile: Profile, limit = 8): Promise<Suggestion[]> {
  const files = await workspaceFiles(workspace)
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
  return tag.type === 'skill' ? `@skill:${tag.value}` : `@${tag.value}`
}

/** Tags still present in the draft, in order. */
export function tagsIn(text: string, inserted: Tag[]): Tag[] {
  return inserted.filter((t, i) => text.includes(tagText(t)) && inserted.findIndex((x) => x.value === t.value && x.type === t.type) === i)
}

/** The prompt Claude receives: file tags stay as @path; skills become an instruction. */
export function promptFor(text: string, tags: Tag[]): string {
  let out = text
  const skillNames: string[] = []
  for (const t of tags) {
    if (t.type === 'skill') {
      out = out.split(tagText(t)).join(`"${t.value}" skill`)
      skillNames.push(t.value)
    }
  }
  for (const name of skillNames) out += `\n\nUse the "${name}" skill for this.`
  return out
}
