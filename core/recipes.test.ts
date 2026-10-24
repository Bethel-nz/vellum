// Recipes on disk and how one expands. VELLUM_HOME is a scratch folder (core/test-setup.ts).
import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { deleteRecipe, expandRecipe, formatRecipe, loadRecipes, parseRecipe, recipeCall, recipeDir, recipeName, saveRecipe } from './recipes'

test('a recipe file: header fields, then the prompt', () => {
  const r = parseRecipe('---\ndescription: Review changes\nmode: Plan\nmodel: "opus"\nwhatever: x\n---\nReview {{branch}}.\n')
  expect(r).toEqual({ description: 'Review changes', mode: 'plan', model: 'opus', body: 'Review {{branch}}.' })
  expect(parseRecipe('Just a prompt.')).toEqual({ description: undefined, mode: undefined, model: undefined, body: 'Just a prompt.' })
  expect(parseRecipe(formatRecipe({ description: 'd', mode: 'auto', body: 'b' }))).toEqual({ description: 'd', mode: 'auto', model: undefined, body: 'b' })
})

test('names are what you type: lower-case words joined by dashes', () => {
  expect(recipeName('Review PR #12!')).toBe('review-pr-12')
  expect(recipeName('  ')).toBe('')
})

test('yours and the project’s load together; a repo’s recipe never stands in for yours', () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'vellum-recipes-'))
  saveRecipe({ name: 'review', scope: 'yours', body: 'mine' })
  saveRecipe({ name: 'standup', scope: 'yours', body: 'what did I do' })
  saveRecipe({ name: 'review', scope: 'project', body: 'the repo’s' }, folder)
  saveRecipe({ name: 'triage', scope: 'project', body: 'the repo’s' }, folder)
  const all = loadRecipes(folder)
  expect(all.map((r) => `${r.name}:${r.scope}`)).toEqual(['review:yours', 'standup:yours', 'triage:project'])
})

test('a repo’s recipe can ask for Ask or Plan, never a mode that asks you less', () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'vellum-recipes-'))
  const dir = recipeDir('project', folder)
  mkdirSync(dir, { recursive: true })
  for (const mode of ['bypassPermissions', 'dontAsk', 'auto', 'acceptEdits', 'plan', 'manual']) writeFileSync(path.join(dir, `${mode}.md`), `---\nmode: ${mode}\n---\nx`)
  const modes = Object.fromEntries(loadRecipes(folder).filter((r) => r.scope === 'project').map((r) => [r.name, r.mode]))
  expect(modes).toEqual({ acceptedits: undefined, auto: undefined, bypasspermissions: undefined, dontask: undefined, manual: 'manual', plan: 'plan' })
  // Yours may use any.
  saveRecipe({ name: 'yolo', scope: 'yours', mode: 'bypassPermissions', body: 'x' })
  expect(loadRecipes().find((r) => r.name === 'yolo')?.mode).toBe('bypassPermissions')
})

test('saving under a new name moves the file; delete removes it', () => {
  const first = saveRecipe({ name: 'old name', scope: 'yours', body: 'x' })
  const second = saveRecipe({ name: 'new name', scope: 'yours', body: 'x', file: first })
  expect(existsSync(first)).toBe(false)
  expect(second.endsWith('new-name.md')).toBe(true)
  deleteRecipe({ file: second })
  expect(existsSync(second)).toBe(false)
  expect(() => saveRecipe({ name: '!!', scope: 'yours', body: 'x' })).toThrow('name')
  expect(() => saveRecipe({ name: 'a', scope: 'project', body: 'x' })).toThrow('project folder')
})

test('a stray file in the folder is skipped, not fatal', () => {
  mkdirSync(recipeDir('yours'), { recursive: true })
  writeFileSync(path.join(recipeDir('yours'), 'notes.txt'), 'not a recipe')
  expect(loadRecipes().some((r) => r.file.endsWith('notes.txt'))).toBe(false)
})

test('expanding: placeholders fill in, typed text goes to {{input}} or after the recipe', () => {
  const ctx = { folder: '/w', branch: 'main', date: new Date('2026-10-24T12:00:00Z') }
  expect(expandRecipe({ body: 'Review {{branch}} in {{folder}} on {{date}}. Focus: {{input}}' }, { ...ctx, input: ' auth ' })).toBe('Review main in /w on 2026-10-24. Focus: auth')
  expect(expandRecipe({ body: 'Summarise the day.' }, { ...ctx, input: 'only the API work' })).toBe('Summarise the day.\n\nonly the API work')
  expect(expandRecipe({ body: 'Keep {{unknown}} as is.' }, ctx)).toBe('Keep {{unknown}} as is.')
})

test('$name at the start of a message calls the recipe with the rest', () => {
  const recipes = [{ name: 'review', body: 'r', scope: 'yours' as const, file: '' }]
  expect(recipeCall('$review the auth module', recipes)).toEqual({ recipe: recipes[0]!, input: 'the auth module' })
  expect(recipeCall('$review', recipes)?.input).toBe('')
  expect(recipeCall('$nope x', recipes)).toBeUndefined()
  expect(recipeCall('costs $5', recipes)).toBeUndefined()
})

test('a repo can’t point its recipes at your files: links, and a recipes folder outside it, are ignored', () => {
  const secret = path.join(mkdtempSync(path.join(tmpdir(), 'vellum-secret-')), 'id_rsa')
  writeFileSync(secret, 'PRIVATE KEY')
  // A link as a recipe file.
  const folder = mkdtempSync(path.join(tmpdir(), 'vellum-recipes-'))
  mkdirSync(recipeDir('project', folder), { recursive: true })
  symlinkSync(secret, path.join(recipeDir('project', folder), 'leak.md'))
  expect(loadRecipes(folder).some((r) => r.body.includes('PRIVATE KEY'))).toBe(false)
  // Saving over that link is refused, and the file behind it is untouched.
  expect(() => saveRecipe({ name: 'leak', scope: 'project', body: 'x' }, folder)).toThrow('link')
  expect(readFileSync(secret, 'utf8')).toBe('PRIVATE KEY')
  // The whole .vellum folder as a link out of the repo.
  const elsewhere = mkdtempSync(path.join(tmpdir(), 'vellum-elsewhere-'))
  mkdirSync(path.join(elsewhere, 'recipes'))
  writeFileSync(path.join(elsewhere, 'recipes', 'outside.md'), 'from outside')
  const sneaky = mkdtempSync(path.join(tmpdir(), 'vellum-recipes-'))
  symlinkSync(elsewhere, path.join(sneaky, '.vellum'))
  expect(loadRecipes(sneaky).some((r) => r.name === 'outside')).toBe(false)
  expect(() => saveRecipe({ name: 'x', scope: 'project', body: 'x' }, sneaky)).toThrow('outside the project')
})
