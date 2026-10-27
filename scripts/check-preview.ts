// Self-check for the file preview (ui/FilePreview.tsx): a paragraph with three file chips, a line
// in a TypeScript file, a markdown file and one that's gone. Pressing the line chip opens the
// file beside the note, which narrows, with that line washed; the markdown chip swaps it for the
// rendered page, Source shows its text; the same chip again closes it; a missing file says why;
// Esc closes. In a narrow window it slides over the note instead. Dragging down the line numbers
// picks lines, ⇧-click stretches the pick, Esc clears it, and "Add to note" (or ↵) puts a
// `#printed.ts:20-24` chip on the end of the draft, the tag keeping its path. The pane is a card of its own, its
// header a path pill; "Show changes" swaps in the note's edit to the file; Open › Finder shows
// that file; the tree opens on the file, marks what changed and opens another file; ⇧⌘E
// hides it; and the strip's Files button opens the pane on the tree and a file it picks: the
// one the note changed last.
// Shots: screenshots/preview-*.png.
//   bun scripts/check-preview.ts
import path from 'node:path'
import { launch } from '@gpuix/react/automation'
import { present, remove, scratchDir } from './scratch'

const home = await scratchDir('vellum-preview-')
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } }).exited
const id = '20261024-prev01'
const workspace = path.resolve(import.meta.dir, '..')
const tags = [
  { type: 'file', value: 'core/printed.ts', line: 18 },
  { type: 'file', value: 'MOTION-CONTRACT.md' },
  { type: 'file', value: 'core/gone.ts' },
]
const lines = [
  { type: 'vellum/meta', meta: { id, title: 'Read some files', profileId: 'main', workspace, createdAt: '2026-10-24T09:00:00.000Z' } },
  { type: 'vellum/user', text: 'Why does #core/printed.ts:18 work this way, given #MOTION-CONTRACT.md and #core/gone.ts?', tags, at: '2026-10-24T09:00:01.000Z' },
  { type: 'acp/update', update: { sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: 'It takes the last step only.' } } },
  { type: 'acp/end', stopReason: 'end_turn' },
  // An edit to the open file, for "Show changes" and the tree's marks.
  { type: 'assistant', message: { id: 'm2', content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: path.join(workspace, 'core/printed.ts'), old_string: 'const last = steps.at(-1)', new_string: 'const last = steps.at(-1) // the step that prints' } }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'The file has been updated.' }] } },
  { type: 'result', subtype: 'success', result: 'Done.' },
]
await Bun.write(path.join(home, 'threads', `${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
await Bun.write(path.join(home, 'settings.json'), JSON.stringify({ lastThreadId: id }))

const opened = path.join(home, 'opened.log')
await Bun.write(opened, '')
let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function run(size: string, wide: boolean) {
  const app = await launch({ command: 'bun', args: ['app.tsx'], env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home'), VELLUM_WINDOW: size, VELLUM_OPEN_LOG: opened } })
  const shot = (n: string) => app.screenshot({ path: `screenshots/preview-${n}.png` })
  const count = (t: string) => app.getByTestId(t).count()
  try {
    await app.getByTestId('composer').waitFor({ timeoutMs: 60_000 })
    await wait(2000)
    const before = await app.getByTestId('page').bounds()
    await app.getByTestId('chip-0').click()
    await wait(700)
    expect(`${size}: a file chip opens the file`, (await count('file-preview')) === 1 && (await app.getByTestId('file-preview-name').textContent()) === 'printed.ts')
    expect(`${size}: …not the paragraph's editor`, (await count('read-' + (await firstUserBlock(app)))) === 1)
    const pane = await app.getByTestId('file-preview').bounds()
    const page = await app.getByTestId('page').bounds()
    if (wide) expect(`${size}: the note narrows beside it`, page.width < before.width - 300 && page.x + page.width <= pane.x + 1, `page ${Math.round(page.width)} of ${Math.round(before.width)}, pane at ${Math.round(pane.x)}`)
    else expect(`${size}: it slides over the note`, Math.round(page.width) === Math.round(before.width) && pane.x < page.x + page.width)
    if (!wide) return await shot('narrow')
    expect(`${size}: the chip's line is washed`, (await count('file-preview-line')) === 1)
    await shot('1-code')

    // A row's middle, from the gutter's painted top: every row is 18 high.
    const g = await app.getByTestId('file-preview-gutter').bounds()
    const row = (n: number) => ({ x: g.x + g.width / 2, y: g.y + (n - 1) * 18 + 9 })
    // The pick's label, once it says `want` (or after a second, whatever it says).
    const picked = async (want?: string) => {
      let text = ''
      for (let i = 0; i < 10; i++) {
        text = await app.getByTestId('file-preview-picked').textContent().catch(() => '')
        if (!want || text === want) break
        await wait(100)
      }
      return text
    }
    // Off to the right of the numbers on the way: the pick still follows.
    await app.mouse.drag(row(20), { x: g.x + 200, y: row(24).y })
    await wait(400)
    expect('dragging down the line numbers picks lines', (await picked('Lines 20–24')) === 'Lines 20–24' && (await count('file-preview-pick')) === 1, await picked())
    await shot('4-pick')
    await app.getByTestId('file-preview-mention').click()
    await wait(500)
    // drafts.json is written a moment after the draft changes: wait for what's expected.
    const saved = async () => {
      try { return JSON.parse(await Bun.file(path.join(home, 'drafts.json')).text())[id] ?? {} } catch { return {} }
    }
    const draftText = async () => ((await saved()).text ?? '') as string
    const draftTags = async () => ((await saved()).tags ?? []) as { value: string; endLine?: number }[]
    const draft = async (want: string) => {
      for (let i = 0; i < 30 && !(await draftText()).includes(want); i++) await wait(100)
      return (await draftText())
    }
    expect('"Add to note" puts the lines on the draft, by the file’s name', (await draft('#printed.ts:20-24')).includes('#printed.ts:20-24') && (await draftTags()).some((t) => t.value === 'core/printed.ts' && t.endLine === 24), (await draftText()))
    expect('…and clears the pick', (await count('file-preview-mention-bar')) === 0)
    await shot('5-mentioned')

    await app.mouse.click(row(22))
    await wait(300)
    await app.mouse.click(row(19), { modifiers: 'shift' })
    await wait(300)
    expect('⇧-click stretches the pick, up too', (await picked('Lines 19–22')) === 'Lines 19–22', await picked())
    await app.getByTestId('file-preview').press('escape')
    await wait(300)
    expect('Esc clears a pick first', (await count('file-preview-mention-bar')) === 0 && (await count('file-preview')) === 1)
    await app.mouse.click(row(21))
    await wait(300)
    await app.getByTestId('file-preview').press('enter')
    await wait(500)
    expect('↵ adds one line', (await draft('#printed.ts:21 ')).includes('#printed.ts:21 '), (await draftText()))

    expect('the pane is a card of its own, apart from the note’s', pane.x - (page.x + page.width) >= 3, `gap ${Math.round(pane.x - page.x - page.width)}`)
    // Crumbs can come back with zero-width breaks between them.
    const where = (await app.getByTestId('file-preview-path').textContent()).replace(/[^\x20-\x7e]/g, '')
    expect('the header shows where the file is', where.endsWith('coreprinted.ts'), JSON.stringify(where))
    await app.getByTestId('file-preview-changes').click()
    await wait(500)
    expect('"Show changes" swaps in the note’s edit to the file', (await count('file-preview-diff')) === 1 && (await count('file-preview-code')) === 0)
    await shot('6-changes')
    await app.getByTestId('file-preview-changes').click()
    await wait(400)
    expect('…and back to the file', (await count('file-preview-code')) === 1)
    await app.getByTestId('open-in-menu-button').click()
    await app.getByTestId('open-in-menu').waitFor({ timeoutMs: 5_000 })
    await wait(500)
    await app.getByTestId('open-in-finder').click()
    await wait(300)
    expect('Open › Finder shows that file', (await Bun.file(opened).text()).includes('"reveal"') && (await Bun.file(opened).text()).includes('core/printed.ts'))

    await app.getByTestId('file-preview').press('shift-cmd-e')
    await wait(700)
    const withTree = await app.getByTestId('file-preview').bounds()
    expect('the tree opens on the file', (await count('file-tree')) === 1 && (await count('file-tree-row-core/printed.ts')) === 1)
    expect('…and the pane widens for it', withTree.width > pane.width + 100, `${Math.round(pane.width)} → ${Math.round(withTree.width)}`)
    expect('git’s status marks a folder holding a change', (await count('file-tree-mark-core')) === 1)
    // Rows are mounted a window at a time, so search brings the file in.
    await app.getByTestId('file-tree-search').click()
    await wait(300)
    await app.getByTestId('file-tree-query').fill('scratch-git')
    await wait(700)
    expect('…and the file, U for one git doesn’t track', (await app.getByTestId('file-tree-mark-core/scratch-git.ts').textContent().catch(() => '')) === 'U')
    await app.getByTestId('file-tree-query').press('escape')
    await wait(300)
    const treeBox = await app.getByTestId('file-tree').bounds()
    expect('the tree runs down the pane’s left side', treeBox.x < withTree.x + 12, `${Math.round(treeBox.x)} vs ${Math.round(withTree.x)}`)
    expect('beside the tree the file is a tab', (await app.getByTestId('file-preview-path').textContent()).replace(/[^\x20-\x7e]/g, '') === 'printed.ts')
    await shot('7-tree')
    await app.getByTestId('file-tree-row-core/tags.ts').click()
    await wait(600)
    expect('a file in the tree opens in the pane', (await app.getByTestId('file-preview-name').textContent()) === 'tags.ts', await app.getByTestId('file-preview-name').textContent())
    await app.getByTestId('file-tree-search').click()
    await wait(400)
    await app.getByTestId('file-tree-query').fill('tags.te')
    await wait(800)
    expect('search opens the folders holding a match', (await count('file-tree-row-core/tags.test.ts')) === 1)
    expect('…and closes the ones that don’t', (await count('file-tree-row-assets/check-image.png')) === 0 && (await count('file-tree-row-assets')) === 1)
    await shot('9-search')
    await app.getByTestId('file-tree-query').press('escape')
    await wait(400)
    expect('Esc ends the search, not the pane', (await count('file-tree-query')) === 0 && (await count('file-preview')) === 1)

    // A right click on a row: its menu.
    await app.getByTestId('file-tree-row-core/tags.ts').click({ button: 2 })
    await wait(500)
    expect('a right click opens the row’s menu', (await count('file-tree-menu')) === 1 && (await count('file-tree-menu-rename')) === 1 && (await count('file-tree-menu-mention')) === 1)
    await shot('14-menu')
    await app.getByTestId('file-tree-menu-mention').click()
    // drafts.json is written a moment after the draft changes.
    let drafted: { tags?: { value: string }[] } | undefined
    for (let i = 0; i < 20 && !drafted?.tags?.some((t) => t.value === 'core/tags.ts'); i++) {
      await wait(150)
      drafted = JSON.parse(await Bun.file(path.join(home, 'drafts.json')).text())[id]
    }
    expect('Add to note puts the file in the draft', drafted?.tags?.some((t: { value: string }) => t.value === 'core/tags.ts') ?? false, JSON.stringify(drafted?.tags))
    await app.getByTestId('file-tree-search').click()
    await wait(300)
    await app.getByTestId('file-tree-query').fill('scratch-git')
    await wait(700)
    await app.getByTestId('file-tree-row-core/scratch-git.ts').click({ button: 2 })
    await wait(500)
    await app.getByTestId('file-tree-menu-rename').click()
    await wait(400)
    await app.getByTestId('file-tree-name').fill('scratch-renamed.ts')
    await app.getByTestId('file-tree-name').press('enter')
    await wait(700)
    expect('Rename renames it in place', await present(path.join(workspace, 'core/scratch-renamed.ts')) && !await present(path.join(workspace, 'core/scratch-git.ts')) && (await count('file-tree-row-core/scratch-renamed.ts')) === 1)
    await remove(path.join(workspace, 'core/scratch-renamed.ts'))

    // The pane's edge and the tree's drag; the pane stops where the note would get too narrow,
    // the tree at its widest.
    const paneBefore = await app.getByTestId('file-preview').bounds()
    await app.mouse.drag(app.getByTestId('file-preview-edge'), { x: paneBefore.x + 80, y: paneBefore.y + paneBefore.height / 2 }, { steps: 12 })
    await wait(500)
    const paneAfter = await app.getByTestId('file-preview').bounds()
    expect('dragging the pane’s edge narrows it', paneAfter.width < paneBefore.width - 40, `${Math.round(paneBefore.width)} → ${Math.round(paneAfter.width)}`)
    await app.mouse.drag(app.getByTestId('file-preview-edge'), { x: paneAfter.x - 600, y: paneAfter.y + paneAfter.height / 2 }, { steps: 12 })
    await wait(500)
    const widest = await app.getByTestId('file-preview').bounds()
    const note = await app.getByTestId('page').bounds()
    expect('…and widens it only as far as the note can spare', widest.width > paneAfter.width + 40 && note.width >= 556, `${Math.round(widest.width)}, note ${Math.round(note.width)}`)
    const tree0 = await app.getByTestId('file-tree').bounds()
    await app.mouse.drag(app.getByTestId('file-tree-edge'), { x: tree0.x + tree0.width + 400, y: tree0.y + 200 }, { steps: 12 })
    await wait(500)
    const tree1 = await app.getByTestId('file-tree').bounds()
    expect('dragging the tree’s edge widens it, up to its widest', tree1.width > tree0.width + 40 && Math.round(tree1.width) <= 360, `${Math.round(tree0.width)} → ${Math.round(tree1.width)}`)
    const sizes = JSON.parse(await Bun.file(path.join(home, 'settings.json')).text())
    expect('…and both sizes are kept', typeof sizes.previewWidth === 'number' && sizes.fileTreeWidth === Math.round(tree1.width), JSON.stringify({ previewWidth: sizes.previewWidth, fileTreeWidth: sizes.fileTreeWidth }))
    await shot('15-resized')
    await app.getByTestId('file-tree-new-file').click()
    await wait(400)
    await app.getByTestId('file-tree-name').fill('scratch-note.md')
    await app.getByTestId('file-tree-name').press('enter')
    await wait(700)
    expect('New file makes it in the open file’s folder, and opens it', await present(path.join(workspace, 'core/scratch-note.md')) && (await app.getByTestId('file-preview-name').textContent()) === 'scratch-note.md')
    await remove(path.join(workspace, 'core/scratch-note.md'))
    await app.getByTestId('file-tree-new-folder').click()
    await wait(400)
    await app.getByTestId('file-tree-name').fill('printed.ts')
    await app.getByTestId('file-tree-name').press('enter')
    await wait(400)
    expect('…and never over something that’s there', (await count('file-tree-error')) === 1)
    await shot('10-exists')
    await app.getByTestId('file-tree-name').press('escape')
    await wait(300)
    await app.getByTestId('file-tree-search').click()
    await wait(300)
    await app.getByTestId('file-tree-query').fill('check-image')
    await wait(700)
    await app.getByTestId('file-tree-row-assets/check-image.png').click()
    await wait(700)
    const info = await app.getByTestId('file-preview-image-info').textContent().catch(() => '')
    expect('an image shows as itself, with its size', (await count('file-preview-image')) === 1 && /^PNG · \d+ × \d+ · /.test(info), info)
    await shot('12-image')
    await app.getByTestId('file-preview-image-open').click()
    await wait(600)
    expect('…and opens full size', (await count('image-viewer-image')) === 1)
    await app.getByTestId('image-viewer-image').press('escape')
    await wait(500)
    await app.getByTestId('file-tree-query').fill('Geist-Medium.ttf')
    await wait(700)
    await app.getByTestId('file-tree-row-assets/fonts/Geist-Medium.ttf').click()
    await wait(700)
    const bin = await app.getByTestId('file-preview-binary-info').textContent().catch(() => '')
    expect('another binary file shows as hex, from its start', (await count('file-preview-binary')) === 1 && bin.includes('the first 4.0 KB'), bin)
    await shot('13-binary')

    // A long file is mounted a block at a time, its numbers counting on across blocks.
    await app.getByTestId('file-tree-query').fill('app.tsx')
    await wait(700)
    await app.getByTestId('file-tree-row-app.tsx').click()
    await wait(800)
    const total = Math.ceil((await Bun.file(path.join(workspace, 'app.tsx')).text()).split('\n').length / 100)
    const mounted = (await Promise.all(Array.from({ length: total }, (_, i) => count(i ? `file-preview-gutter-${i}` : 'file-preview-gutter')))).filter(Boolean).length
    expect('a long file mounts only the blocks near the top', mounted >= 1 && mounted < total, `${mounted} of ${total}`)
    await app.getByTestId('file-tree-query').press('escape')
    await wait(300)
    await app.getByTestId('file-preview').press('shift-cmd-e')
    await wait(500)
    expect('⇧⌘E hides the tree, the file stays', (await count('file-tree')) === 0 && (await count('file-preview')) === 1)
    await app.getByTestId('file-preview').press('escape')
    await wait(500)
    await app.getByTestId('open-files').click()
    await wait(700)
    expect('Files on the strip opens the pane on the tree and the file the note changed last', (await count('file-tree')) === 1 && (await app.getByTestId('file-preview-name').textContent()) === 'printed.ts')
    await shot('8-files')
    await app.getByTestId('file-tree-search').click()
    await wait(300)
    await app.getByTestId('file-tree-query').fill('NOTES.md')
    await wait(700)
    await app.getByTestId('file-tree-row-NOTES.md').click()
    await wait(600)
    expect('…and a pick opens the file', (await app.getByTestId('file-preview-name').textContent()) === 'NOTES.md')
    await app.getByTestId('open-files').click()
    await wait(500)
    expect('Files again hides the tree', (await count('file-tree')) === 0 && (await count('file-preview')) === 1)
    await app.getByTestId('file-preview').press('escape')
    await wait(500)

    await app.getByTestId('chip-1').click()
    await wait(700)
    expect('the markdown chip swaps it for the rendered page', (await count('file-preview-markdown')) === 1 && (await app.getByTestId('file-preview-name').textContent()) === 'MOTION-CONTRACT.md')
    await shot('2-markdown')
    await app.getByTestId('file-preview-mode-source').click()
    await wait(500)
    expect('Source shows its text', (await count('file-preview-code')) === 1)
    await app.getByTestId('chip-1').click()
    await wait(500)
    expect('the same chip again closes it', (await count('file-preview')) === 0)

    await app.getByTestId('chip-2').click()
    await wait(600)
    expect('a missing file says why', (await count('file-preview-unavailable')) === 1)
    await shot('3-missing')
    await app.getByTestId('file-preview').press('escape')
    await wait(500)
    expect('Esc closes it', (await count('file-preview')) === 0)
    expect('…and the note has its width back', Math.round((await app.getByTestId('page').bounds()).width) === Math.round(before.width))
  } finally {
    await app.close()
  }
}

async function firstUserBlock(app: Awaited<ReturnType<typeof launch>>) {
  const ids = (await app.getByType('div').all()).map((n) => n.testId ?? '').filter((t) => t.startsWith('read-'))
  return ids[0]?.slice(5) ?? ''
}

// A file git doesn't track, for the tree's marks.
await Bun.write(path.join(workspace, 'core/scratch-git.ts'), '')
try {
  await run('1280x800', true)
  // The narrow run starts from the pane's own sizes, not the ones dragged above.
  await Bun.write(path.join(home, 'settings.json'), JSON.stringify({ lastThreadId: id, fileTree: false }))
  await run('900x700', false)
} finally {
  for (const f of ['core/scratch-git.ts', 'core/scratch-renamed.ts']) await remove(path.join(workspace, f))
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
