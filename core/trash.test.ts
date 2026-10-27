import { expect, test } from 'bun:test'
import path from 'node:path'
// VELLUM_HOME is a scratch folder already (core/test-setup.ts, preloaded).
import { paths } from './store'
import { daysLeft, deleteForever, purgeTrash, restoreNote, trashed, trashNote } from './trash'

const DAY = 86_400_000
const note = async (id: string, title = 'A note') => {
  const meta = { id, title, profileId: 'main', workspace: '/tmp/project', createdAt: '2026-10-01T09:00:00.000Z' }
  await Bun.write(path.join(paths.threads, `${id}.jsonl`), `${JSON.stringify({ type: 'vellum/meta', meta })}\n${JSON.stringify({ type: 'vellum/user', text: 'hello', tags: [], at: '2026-10-01T09:00:01.000Z' })}\n`)
  return meta
}

test('a deleted note waits in the trash and comes back as it was', async () => {
  const meta = await note('trash-1', 'Plan the release')
  const now = new Date('2026-10-24T12:00:00.000Z')
  expect(trashNote(meta, now)).toBe(true)
  expect(await Bun.file(path.join(paths.threads, 'trash-1.jsonl')).exists()).toBe(false)
  const t = (await trashed(now)).find((x) => x.id === 'trash-1')!
  expect(t.title).toBe('Plan the release')
  expect(daysLeft(t, now)).toBe(30)
  expect(daysLeft(t, new Date(now.getTime() + 29.5 * DAY))).toBe(1)
  const back = (await restoreNote('trash-1'))!
  expect(back.title).toBe('Plan the release')
  expect(back.blocks.some((b) => b.kind === 'user')).toBe(true)
  expect((await trashed(now)).some((x) => x.id === 'trash-1')).toBe(false)
})

test('thirty days on, it is gone for good', async () => {
  const meta = await note('trash-2')
  const then = new Date('2026-09-01T12:00:00.000Z')
  trashNote(meta, then)
  await purgeTrash(new Date(then.getTime() + 29 * DAY))
  expect((await trashed(new Date(then.getTime() + 29 * DAY))).some((x) => x.id === 'trash-2')).toBe(true)
  await purgeTrash(new Date(then.getTime() + 30 * DAY))
  expect(await restoreNote('trash-2')).toBeUndefined()
})

test('deleting for good, and a note that is not there', async () => {
  trashNote(await note('trash-3'))
  deleteForever('trash-3')
  expect((await trashed()).some((x) => x.id === 'trash-3')).toBe(false)
  expect(trashNote({ id: 'missing', title: '', workspace: '', profileId: '' })).toBe(false)
})
