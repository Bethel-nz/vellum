// Native page/project check, using private homes and the fake agent. No paid turns.
// bun scripts/check-new-note.ts
import path from 'node:path'
import { spawn } from 'node:child_process'
import { connectStdio } from '@gpuix/react/automation'
import { names, scratchDir } from './scratch'

const home = await scratchDir('vellum-new-page-')
const projectA = path.join(home, 'vellum'), projectB = path.join(home, 'other')
await Bun.$`mkdir -p ${path.join(home, 'threads')} ${path.join(projectA, '.claude/skills/preview-skill')} ${projectB}`.quiet()
await Bun.write(path.join(projectA, 'README.md'), 'Project A\n')
await Bun.write(path.join(projectA, '.claude/skills/preview-skill/SKILL.md'), '---\nname: preview-skill\ndescription: Preview skill\n---\nKeep this example concise.\n')
await Bun.write(path.join(home, 'profiles.json'), JSON.stringify([
  { id: 'main', name: 'Default', color: '#1447e6', configDir: null, workspaces: [projectA, projectB] },
  { id: 'work', name: 'Work', color: '#c2453a', configDir: path.join(home, 'work'), workspaces: [] },
]))
await Bun.write(path.join(home, 'settings.json'), JSON.stringify({ onboardingComplete: true, helpShown: true, atLaunch: 'new', lastProject: projectA, material: 'dark', motion: 'reduce' }))
const log = path.join(home, 'fake-acp.log')
await Bun.write(log, '')
const env = { ...process.env, GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home'), VELLUM_BRIDGE_PORT: '0', VELLUM_AGENT: path.resolve(import.meta.dir, 'fake-acp.ts'), FAKE_ACP_LOG: log }
const open = async () => {
  const child = spawn('bun', ['app.tsx'], { cwd: path.resolve(import.meta.dir, '..'), env, stdio: ['pipe', 'pipe', 'inherit'] })
  return connectStdio({ write: (chunk) => child.stdin.write(chunk), feed: (receive) => child.stdout.on('data', (data) => receive(data.toString())), close: async () => { child.kill() } })
}
let app = await open()
const c = () => app.getByTestId('composer')
const records = async () => (await Promise.all(names(path.join(home, 'threads'), '*.jsonl').map((file) => Bun.file(path.join(home, 'threads', file)).text()))).flatMap((text) => text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)))
const metas = async () => (await records()).filter((record) => record.type === 'vellum/meta').map((record) => record.meta)
const sent = async () => (await Bun.file(log).text()).split('\n').filter(Boolean).map((line) => JSON.parse(line).in).filter((message) => message?.method === 'session/prompt')
const check = (label: string, okay: boolean) => { if (!okay) throw new Error(label); console.log(`ok  ${label}`) }
const until = async (okay: () => Promise<boolean>, label: string) => {
  const start = Date.now()
  while (!(await okay())) { if (Date.now() - start > 15000) throw new Error(label); await Bun.sleep(100) }
}
const chooseProject = async (query: string) => {
  await app.getByTestId('project-picker').click()
  await app.getByTestId('project-search').waitFor()
  await app.getByTestId('project-search').fill(query)
  await app.getByTestId('project-recent-0').click()
  await Bun.sleep(150)
}
try {
  await c().waitFor({ timeoutMs: 60000 })
  check('At launch creates a blank page in the selected project', (await metas()).length === 1 && (await metas())[0].workspace === projectA)
  const first = (await metas())[0].id
  await c().fill('Read #readme')
  await app.getByTestId('tag-0').waitFor()
  await c().press('enter')
  check('Enter completes a file tag before sending', (await sent()).length === 0)
  await c().press('shift-enter')
  check('Shift+Enter does not send', (await sent()).length === 0)
  await c().fill('stream #README.md @skill:preview-skill')
  await app.getByTestId('tag-0').waitFor()
  await c().press('tab')
  await c().press('enter')
  await until(async () => (await sent()).length === 1, 'First Enter did not reach the agent')
  const user = (await records()).find((record) => record.type === 'vellum/user')
  check('First Enter sends once with file and skill context', user.tags.some((tag: { type: string }) => tag.type === 'file') && user.tags.some((tag: { type: string }) => tag.type === 'skill'))
  await c().fill('Keep this draft')
  await c().press('cmd-n')
  await until(async () => (await metas()).length === 2, '⌘N did not create a note')
  const second = (await metas()).find((meta) => meta.id !== first).id
  await c().fill('Draft in the second note')
  await chooseProject('other')
  await until(async () => (await metas()).length === 3, 'New project did not open a page')
  check('Project switch hides other project tabs', await app.getByTestId(`tab-${first}`).count() === 0 && await app.getByTestId(`tab-${second}`).count() === 0)
  await c().fill('Other project draft')
  await chooseProject('vellum')
  check('Project switch restores the last note', await app.getByTestId(`tab-${second}`).count() === 1)
  await c().press('cmd-n')
  await until(async () => (await metas()).length === 4, 'New note did not inherit project')
  check('New notes inherit the selected project and account', (await metas()).every((meta) => meta.profileId === 'main') && (await metas()).filter((meta) => meta.workspace === projectA).length === 3)
  await until(() => Bun.file(path.join(home, 'drafts.json')).exists(), 'Drafts did not save')
  await Bun.sleep(350)
  const drafts = await Bun.file(path.join(home, 'drafts.json')).json()
  check('Changing notes preserves both drafts', drafts[first].text === 'Keep this draft' && drafts[second].text === 'Draft in the second note')
  await app.getByTestId('account-pill').click()
  await app.getByTestId('move-work').click()
  await app.getByTestId('mode-pill').click()
  await app.getByTestId('mode-plan').click()
  await app.getByTestId('model-pill').click()
  await app.getByTestId('model-opus').waitFor()
  await app.getByTestId('model-opus').click()
  await c().fill('stream from the send button')
  await app.getByTestId('send-message').click()
  await until(async () => (await sent()).length === 2, 'Send button did not reach the agent')
  check('Agent/model/permission selections persist', (await records()).some((r) => r.type === 'vellum/profile' && r.profileId === 'work') && (await records()).some((r) => r.type === 'vellum/mode' && r.mode === 'plan') && (await records()).some((r) => r.type === 'vellum/model' && r.model === 'opus'))
  await until(async () => await app.getByTestId('stop').count() === 0, 'Reply did not finish')
  await app.getByTestId('project-picker').click()
  await Bun.sleep(200)
  await app.screenshot({ path: 'screenshots/new-page-project-dark.png' })
  await app.getByTestId('project-search').press('escape')
  await c().press('cmd-shift-l')
  await c().press('cmd-n')
  await Bun.sleep(200)
  await app.screenshot({ path: 'screenshots/new-page-light.png' })
  const before = (await metas()).length
  await app.close()
  await Bun.sleep(200)
  const settings = await Bun.file(path.join(home, 'settings.json')).json()
  settings.atLaunch = 'last'
  await Bun.write(path.join(home, 'settings.json'), JSON.stringify(settings))
  app = await open()
  await c().waitFor({ timeoutMs: 60000 })
  await chooseProject('other')
  check('Restart restores project drafts without creating extra notes', (await metas()).length === before && JSON.stringify(await Bun.file(path.join(home, 'drafts.json')).json()).includes('Other project draft'))
  console.log(`Native checks passed · ${home}`)
} finally { await app.close() }
