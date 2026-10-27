// Self-check for pasted images, against scripts/fake-acp.ts (no paid turns): pasting with an image
// on the clipboard puts a thumbnail on the draft, × removes it, ⌘↵ sends it as an ACP image block
// ahead of the text, and the paragraph shows it. ⌘V in the text field is the window menu's Paste,
// which reads the real clipboard, so the check never presses it: it puts in at once what a paste
// would (VELLUM_CLIPBOARD_TEXT), and VELLUM_PASTE_IMAGE stands in for the image.
//   bun scripts/check-images.ts
import path from 'node:path'
import { launch } from '@gpuix/react/automation'
import { scratchDir } from './scratch'

const home = await scratchDir('vellum-images-')
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } }).exited
const log = path.join(home, 'fake-acp.log')
await Bun.write(log, '')
const picture = path.resolve('assets/check-image.png')

const app = await launch({
  command: 'bun',
  args: ['app.tsx'],
  env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home'), VELLUM_AGENT: path.resolve(import.meta.dir, 'fake-acp.ts'), FAKE_ACP_LOG: log, VELLUM_PASTE_IMAGE: picture, VELLUM_CLIPBOARD_TEXT: 'check-image.png' },
})
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const shot = (n: string) => app.screenshot({ path: 'screenshots/images-' + n + '.png' })
const sent = async () => (await Bun.file(log).text()).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).in)
let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}

try {
  const c = app.getByTestId('composer')
  await c.waitFor({ timeoutMs: 60_000 })
  // The note scrolls to its end after it loads; a click before that misses the composer.
  await wait(2500)
  await c.click()
  // What Finder puts on the clipboard for a copied image: its name, as text.
  await c.fill('check-image.png')
  await wait(800)
  expect('pasting an image puts it on the draft', (await app.getByTestId('draft-image-0').count()) === 1)
  const drafts = async () => JSON.parse(await Bun.file(path.join(home, 'drafts.json')).text())
  expect('…and the file name it came with goes', !Object.values(await drafts()).some((d: any) => d.text?.includes('check-image.png')))
  await c.fill('check-image.png')
  await wait(800)
  expect('a second paste adds another', (await app.getByTestId('draft-image-1').count()) === 1)
  await c.fill('a sentence that is not on the clipboard')
  await wait(800)
  expect('text that isn’t the clipboard’s adds no image', (await app.getByTestId('draft-image-2').count()) === 0)
  await app.getByTestId('draft-image-1').hover()
  await wait(300)
  await app.getByTestId('remove-image-1').click()
  await wait(400)
  expect('× removes one', (await app.getByTestId('draft-image-1').count()) === 0 && (await app.getByTestId('draft-image-0').count()) === 1)
  await shot('1-draft')

  await c.fill('What is in this screenshot?')
  await c.press('cmd-enter')
  await wait(1500)
  const prompt = (await sent()).find((m) => m?.method === 'session/prompt')?.params?.prompt ?? []
  expect('it goes to the agent as an image block before the text', prompt[0]?.type === 'image' && prompt[0]?.mimeType === 'image/png' && prompt[0]?.data?.length > 100 && prompt[1]?.type === 'text', JSON.stringify(prompt.map((p: any) => p.type)))
  expect('the paragraph shows it', (await app.getByTestId('user-images').count()) === 1)
  expect('the draft is empty again', (await app.getByTestId('draft-images').count()) === 0)
  await shot('2-sent')
} finally {
  await app.close()
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
