import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = mkdtempSync(path.join(tmpdir(), 'vellum-export-'))
process.env.VELLUM_HOME = path.join(root, 'home')
const { paths } = await import('./store')
const { handoffContext, readThread } = await import('./threads')
const { agentMarkdown, readVel, writeVel } = await import('./export')

const image = path.join(paths.home, 'images', 'shot.png')
mkdirSync(path.dirname(image), { recursive: true })
writeFileSync(image, 'png-bytes')
const workspace = mkdtempSync(path.join(tmpdir(), 'vellum-export-ws-'))
const records = [
  { type: 'vellum/meta', meta: { id: 'n1', title: 'Fix: the radius', profileId: 'main', workspace, createdAt: '2026-11-07T09:00:00.000Z' } },
  { type: 'acp/session', sessionId: 's-123', agent: 'claude', profileId: 'main' },
  { type: 'vellum/user', text: 'Tighten concentric.', tags: [], at: '2026-11-07T09:00:30.000Z', images: [image] },
  { type: 'vellum/shell', termId: 't1', command: 'bun test', at: '2026-11-07T09:01:00.000Z' },
  { type: 'vellum/shell-exit', termId: 't1', exitCode: 0, output: '2 pass', grid: { rows: [] } },
]
writeFileSync(path.join(paths.threads, 'n1.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n')
const note = (await readThread(path.join(paths.threads, 'n1.jsonl')))!
const out = path.join(root, 'out')

test('a .vel carries the records and the files they point at', async () => {
  const file = await writeVel(note, out)
  expect(path.basename(file)).toBe('Fix  the radius.vel')
  const lines = (await Bun.file(file).text()).trim().split('\n').map((l) => JSON.parse(l))
  expect(lines[0].type).toBe('vellum/export')
  expect(lines.find((l) => l.type === 'vellum/asset')).toMatchObject({ path: 'images/shot.png', data: Buffer.from('png-bytes').toString('base64') })
  expect(lines.filter((l) => l.type !== 'vellum/export' && l.type !== 'vellum/asset')).toHaveLength(records.length)
  expect(path.basename(await writeVel(note, out))).toBe('Fix  the radius 2.vel')
})

test('opened on its own account it resumes; on another it carries the note', async () => {
  const file = await writeVel(note, out)
  const same = (await readThread(path.join(paths.threads, `${await readVel(file, { profiles: ['main'], profileId: 'main', known: [workspace] })}.jsonl`)))!
  expect(same.id).not.toBe('n1')
  expect(same.claudeSessionId).toBe('s-123')
  expect(same.handoff).toBeUndefined()
  const other = (await readThread(path.join(paths.threads, `${await readVel(file, { profiles: ['work'], profileId: 'work', known: [workspace] })}.jsonl`)))!
  expect(other.profileId).toBe('work')
  expect(other.claudeSessionId).toBeUndefined()
  expect(other.handoff).toBe(true)
  expect(handoffContext(other)).toStartWith('This note was opened from an export')
})

test('a file that isn’t an export is refused', async () => {
  const bad = path.join(root, 'bad.vel')
  writeFileSync(bad, '{"type":"vellum/meta"}\n')
  await expect(readVel(bad, { profiles: [], profileId: 'main', known: [] })).rejects.toThrow('isn’t a Vellum export')
})

test('a crafted export can only add a note’s own files, in a project you already have', async () => {
  const file = path.join(root, 'crafted.vel')
  const asset = (p: string) => ({ type: 'vellum/asset', path: p, data: Buffer.from('evil').toString('base64') })
  const lines = [
    { type: 'vellum/export', version: 1, home: '/elsewhere', title: 'x', exportedAt: '' },
    asset('mcp-servers.json'), asset('../outside.txt'), asset('C:\\outside.txt'), asset('\\\\server\\share\\outside.txt'), asset('captures/other-note/a.png'), asset('images/ok.png'), asset('captures/n9/shot.png'),
    { ...records[0], meta: { ...(records[0] as { meta: object }).meta, id: 'n9', workspace: '/' } },
  ]
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n'))
  const id = await readVel(file, { profiles: ['main'], profileId: 'main', workspace, known: [workspace] })
  expect(await Bun.file(path.join(paths.home, 'mcp-servers.json')).exists()).toBe(false)
  expect(await Bun.file(path.join(paths.home, 'C:', 'outside.txt')).exists()).toBe(false)
  expect(await Bun.file(path.join(paths.home, 'server', 'share', 'outside.txt')).exists()).toBe(false)
  expect(await Bun.file(path.join(paths.home, '..', 'outside.txt')).exists()).toBe(false)
  expect(await Bun.file(path.join(paths.captures, 'other-note', 'a.png')).exists()).toBe(false)
  expect(await Bun.file(path.join(paths.home, 'images', 'ok.png')).exists()).toBe(true)
  expect(await Bun.file(path.join(paths.captures, id, 'shot.png')).exists()).toBe(true)
  const t = (await readThread(path.join(paths.threads, `${id}.jsonl`)))!
  expect(t.workspace).toBe(workspace)
  expect(t.handoff).toBe(true)
})

test('Windows and POSIX export paths remap on import', async () => {
  const foreign = [
    { home: 'C:\\Users\\alice\\.vellum', file: 'C:\\Users\\alice\\.vellum\\images\\from-windows.png', workspace: 'C:\\Users\\alice\\repo', name: 'from-windows.png' },
    { home: '/Users/alice/.vellum', file: '/Users/alice/.vellum/images/from-mac.png', workspace: '/Users/alice/repo', name: 'from-mac.png' },
  ]
  for (const [index, source] of foreign.entries()) {
    const file = path.join(root, `${index}.vel`)
    const lines = [
      { type: 'vellum/export', version: 1, home: source.home, title: 'x', exportedAt: '' },
      { type: 'vellum/asset', path: `images/${source.name}`, data: Buffer.from(source.name).toString('base64') },
      { ...records[0], meta: { ...(records[0] as { meta: object }).meta, id: `n-${index}`, profileId: 'foreign', workspace: source.workspace } },
      { ...records[2], images: [source.file] },
      { type: 'assistant', message: { content: [{ type: 'tool_use', input: { file_path: `${source.workspace}${source.workspace.startsWith('C:') ? '\\' : '/'}src/main.ts` } }] } },
    ]
    writeFileSync(file, lines.map((line) => JSON.stringify(line)).join('\n') + '\n')
    const id = await readVel(file, { profiles: ['main'], profileId: 'main', workspace, known: [workspace] })
    const imported = (await Bun.file(path.join(paths.threads, `${id}.jsonl`)).text()).trim().split('\n').map((line) => JSON.parse(line))
    const local = path.join(paths.home, 'images', source.name)
    expect(imported.find((line) => line.type === 'vellum/user')?.images).toEqual([local])
    expect(imported.find((line) => line.type === 'assistant')?.message.content[0].input.file_path).toBe(path.join(workspace, 'src', 'main.ts'))
    expect(await Bun.file(local).text()).toBe(source.name)
  }
})

test('markdown for another agent tags each component', () => {
  const md = agentMarkdown(note, 'Claude')
  expect(md).toContain('## You\n\nTighten concentric.')
  expect(md).toContain('<shell command="bun test" exit="0">\n```console\n2 pass\n```\n</shell>')
})
