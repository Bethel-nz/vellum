// Recipes: prompts you keep and reuse with `$name` in the composer.
//
// Each is a markdown file: the body is the prompt, and an optional header sets what it's for and
// how it runs.
//
//   ---
//   description: Review the uncommitted changes
//   mode: plan
//   model: opus
//   ---
//   Review what changed on {{branch}} in {{folder}}. Focus on {{input}}.
//
// Yours live in ~/.vellum/recipes; a project's in <folder>/.vellum/recipes, so they can be shared
// through the repo. A project's recipes come from whoever wrote the repo, so they can't loosen
// permissions (their mode is Ask or Plan, or none) and never stand in for one of yours: on a clash
// of names, yours is the one `$name` runs.
// `{{input}}` is what you type after `$name`; without it, that text goes after the recipe.
// {{folder}}, {{branch}} and {{date}} fill themselves in.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { PermissionMode } from './asks'
import { paths } from './store'

export type Recipe = {
  /** The name you type after `$`: the file name, lower-case, words joined by dashes. */
  name: string
  description?: string
  mode?: PermissionMode
  model?: string
  body: string
  scope: 'yours' | 'project'
  file: string
}

const MODES: PermissionMode[] = ['manual', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions']
/** The modes a repo's recipe may ask for: ones that ask you more, never less. */
const PROJECT_MODES: PermissionMode[] = ['manual', 'plan']

export const recipeDir = (scope: Recipe['scope'], folder?: string) =>
  scope === 'yours' ? path.join(paths.home, 'recipes') : path.join(folder ?? '', '.vellum', 'recipes')

/** A name as it is typed: lower-case, letters, digits and dashes. */
export function recipeName(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Header fields and body of a recipe file. Only `key: value` lines; anything else is ignored. */
export function parseRecipe(text: string): Pick<Recipe, 'description' | 'mode' | 'model' | 'body'> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  const head: Record<string, string> = {}
  if (m) {
    for (const line of m[1]!.split(/\r?\n/)) {
      const kv = /^([A-Za-z]+):\s*(.*)$/.exec(line.trim())
      if (kv) head[kv[1]!.toLowerCase()] = kv[2]!.replace(/^["']|["']$/g, '').trim()
    }
  }
  const mode = MODES.find((x) => x.toLowerCase() === head.mode?.toLowerCase())
  return {
    description: head.description || undefined,
    mode,
    model: head.model || undefined,
    body: (m ? text.slice(m[0].length) : text).trim(),
  }
}

export function formatRecipe(r: Pick<Recipe, 'description' | 'mode' | 'model' | 'body'>): string {
  const head = [r.description && `description: ${r.description}`, r.mode && `mode: ${r.mode}`, r.model && `model: ${r.model}`].filter(Boolean)
  return (head.length ? `---\n${head.join('\n')}\n---\n` : '') + r.body.trim() + '\n'
}

function readDir(scope: Recipe['scope'], dir: string): Recipe[] {
  if (!existsSync(dir)) return []
  const out: Recipe[] = []
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith('.md')) continue
    const name = recipeName(f.slice(0, -3))
    if (!name) continue
    const file = path.join(dir, f)
    try {
      const r = parseRecipe(readFileSync(file, 'utf8'))
      if (scope === 'project' && r.mode && !PROJECT_MODES.includes(r.mode)) r.mode = undefined
      out.push({ name, scope, file, ...r })
    } catch {}
  }
  return out
}

/** Your recipes and the project's, by name; yours wins a clash. */
export function loadRecipes(folder?: string): Recipe[] {
  const byName = new Map<string, Recipe>()
  if (folder) for (const r of readDir('project', recipeDir('project', folder))) byName.set(r.name, r)
  for (const r of readDir('yours', recipeDir('yours'))) byName.set(r.name, r)
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Write a recipe (new or edited); a rename moves the file. Returns where it went. */
export function saveRecipe(r: Pick<Recipe, 'name' | 'description' | 'mode' | 'model' | 'body' | 'scope'> & { file?: string }, folder?: string): string {
  const name = recipeName(r.name)
  if (!name) throw new Error('A recipe needs a name')
  if (!r.body.trim()) throw new Error('A recipe needs a prompt')
  if (r.scope === 'project' && !folder) throw new Error('A project recipe needs the project folder')
  const dir = recipeDir(r.scope, folder)
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${name}.md`)
  writeFileSync(file, formatRecipe(r))
  if (r.file && r.file !== file && existsSync(r.file)) rmSync(r.file)
  return file
}

export function deleteRecipe(r: Pick<Recipe, 'file'>) {
  rmSync(r.file, { force: true })
}

/**
 * The prompt a recipe sends. `{{input}}` takes what was typed after `$name`; with no such
 * placeholder, the typed text follows the recipe after a blank line. Unknown placeholders stay.
 */
export function expandRecipe(r: Pick<Recipe, 'body'>, ctx: { input?: string; folder?: string; branch?: string; date?: Date }): string {
  const input = ctx.input?.trim() ?? ''
  const values: Record<string, string | undefined> = {
    input,
    folder: ctx.folder,
    branch: ctx.branch,
    date: (ctx.date ?? new Date()).toISOString().slice(0, 10),
  }
  const hasInput = /\{\{\s*input\s*\}\}/.test(r.body)
  const body = r.body.replace(/\{\{\s*(\w+)\s*\}\}/g, (all, key: string) => values[key] ?? all)
  return hasInput || !input ? body.trim() : `${body.trim()}\n\n${input}`
}

/** `$name rest of the line` at the start of a message: the recipe and what follows it. */
export function recipeCall(text: string, recipes: Recipe[]): { recipe: Recipe; input: string } | undefined {
  const m = /^\$([a-z0-9-]+)(?:\s+([\s\S]*))?$/.exec(text.trim())
  if (!m) return undefined
  const recipe = recipes.find((r) => r.name === m[1])
  return recipe ? { recipe, input: m[2] ?? '' } : undefined
}
