// Spike: what promptFor sends for each kind of token. Prints the prompt for a line tag, the same
// tag widened to its file, a plain file tag, a folder and a skill.
//   bun spikes/tag-prompt.ts
import path from 'node:path'
import { promptFor, tagsIn } from '../core/tags'
import type { Tag } from '../core/threads'

const workspace = path.join(import.meta.dir, 'fixture-ws')
const picked: Tag[] = [
  { type: 'file', value: 'theme.txt' },
  { type: 'folder', value: 'src/' },
  { type: 'skill', value: 'review' },
]
const text = 'Is the radius on #theme.txt:2 right? Compare with #theme.txt and @src/, then @skill:review.'
const tags = tagsIn(text, picked)
console.log('tags:', JSON.stringify(tags))
console.log('--- line scope\n' + promptFor(text, tags, { workspace }))
console.log('--- widened\n' + promptFor(text, tags, { workspace, scopes: { 'theme.txt:2': 'file' } }))
