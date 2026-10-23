// Self-check for the note: two tabs, editing your own text, editing a reply, the title menu,
// rename, ⇧⌘W / ⌘1, and the trust warning for a folder with project config.
//   bun scripts/check-note.ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launch } from '@gpuix/react/automation'
const home = mkdtempSync(path.join(tmpdir(), 'vellum-note-'))
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } }).exited
// A third note in a folder that ships an MCP config, so it shows up under recent folders.
const risky = path.join(home, 'risky-project')
mkdirSync(risky, { recursive: true })
writeFileSync(path.join(risky, '.mcp.json'), '{"mcpServers":{}}\n')
const meta = { id: '20261001-risky', title: 'Risky folder', profileId: 'main', workspace: risky, createdAt: '2026-10-01T09:00:00.000Z' }
writeFileSync(path.join(home, 'threads', `${meta.id}.jsonl`), JSON.stringify({ type: 'vellum/meta', meta }) + '\n')
const app = await launch({ command: 'bun', args: ['app.tsx'], env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const shot = (n: string) => app.screenshot({ path: 'screenshots/note-' + n + '.png' })
try {
  const c = app.getByTestId('composer')
  await c.waitFor({ timeoutMs: 60_000 })
  await wait(1500)
  await shot('1-note')
  // open the second note from the switcher so there are two tabs
  await app.getByTestId('open-switcher').click()
  await wait(1500)
  await app.getByTestId('thread-20261022-demo02').click()
  await wait(1200)
  await shot('2-two-tabs')
  // back to the first tab, edit an earlier paragraph of mine
  await app.getByTestId('tab-20261023-demo01').click()
  await wait(1200)
  const para = app.getByTestId('para-u-6')
  await para.click()
  await para.fill('Thanks. What changed in git, and why?')
  await wait(900)
  await c.click()
  await wait(400)
  await shot('3-edited')
  // click a reply to edit its source
  await app.getByTestId('reply-a-5').click()
  await wait(800)
  await shot('4-reply-editing')
  await c.click()
  await wait(400)
  // title menu
  await app.getByTestId('title-menu').click()
  await wait(1500)
  await shot('5-menu')
  // rename from the menu
  await app.getByTestId('menu-rename').click()
  await wait(600)
  const title = app.getByTestId('title-input')
  await title.fill('Concentric radius')
  await title.press('enter')
  await wait(800)
  console.log('renamed tab:', await app.getByText('Concentric radius').count())
  await shot('6-renamed')
  // ⇧⌘W closes the active tab, ⌘1 goes to the first
  await c.click()
  await c.press('cmd-shift-w')
  await wait(800)
  console.log('tabs after ⇧⌘W:', await app.getByTestId('tab-20261023-demo01').count(), await app.getByTestId('tab-20261022-demo02').count())
  await c.press('cmd-1')
  await wait(600)
  // trust warning in the New note dialog
  await c.press('cmd-n')
  await wait(1500)
  // Rows show the last two path segments; the full path is in the tooltip.
  await app.getByText(`…/${path.basename(home)}/risky-project`).click()
  await wait(800)
  console.log('trust warning shown:', await app.getByTestId('trust-warning').count())
  await shot('7-trust-warning')
} finally {
  await app.close()
}
