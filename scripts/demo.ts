// Records Vellum end to end on OpenCode's free model, in scratch homes: nothing billed.
//   bun scripts/demo.ts [out.mp4]
import path from 'node:path'
import { tmpdir } from 'node:os'
import { launch } from '@gpuix/react/automation'
import { mkdtempSync } from 'node:fs'

const out = path.resolve(process.argv[2] ?? 'screenshots/demo.mp4')
// Short on purpose: the terminal socket path must stay under macOS's 104 characters.
const root = mkdtempSync(path.join(tmpdir(), 'vd-'))
const home = path.join(root, 'vellum')
const ws = path.join(root, 'shop')
const frames = path.join(root, 'frames')
await Bun.$`mkdir -p ${path.join(home, 'threads')} ${path.join(ws, 'src')} ${frames}`.quiet()

await Bun.write(path.join(ws, 'src/cart.ts'), `export type Item = { name: string; price: number; quantity: number }

export function total(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price, 0)
}
`)
await Bun.write(path.join(ws, 'src/cart.test.ts'), `import { expect, test } from 'bun:test'
import { total } from './cart'

test('total counts every unit', () => {
  expect(total([{ name: 'pen', price: 2, quantity: 3 }, { name: 'pad', price: 5, quantity: 1 }])).toBe(11)
})
`)
await Bun.write(path.join(ws, 'package.json'), '{ "name": "shop", "private": true }\n')
await Bun.$`git init -q && git add -A && git -c user.name=demo -c user.email=demo@example.com commit -qm init`.cwd(ws).quiet()

const id = 'demo'
await Bun.write(path.join(home, 'profiles.json'), JSON.stringify([{ id: 'main', name: 'OpenCode', color: '#1447e6', configDir: null, workspaces: [ws], agent: 'opencode' }]))
await Bun.write(path.join(home, 'threads', `${id}.jsonl`), JSON.stringify({ type: 'vellum/meta', meta: { id, title: 'Untitled', profileId: 'main', workspace: ws, createdAt: new Date().toISOString() } }) + '\n')
await Bun.write(path.join(home, 'settings.json'), JSON.stringify({ lastThreadId: id, onboardingComplete: true, helpShown: true, material: process.env.MATERIAL ?? 'dark', exportFolder: path.join(root, 'export') }))

const app = await launch({
  command: 'bun',
  args: ['app.tsx'],
  env: {
    GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home'), VELLUM_BRIDGE_PORT: '0',
    XDG_DATA_HOME: path.join(root, 'data'), XDG_STATE_HOME: path.join(root, 'state'), XDG_CACHE_HOME: path.join(root, 'cache'),
  },
})

const log = path.join(home, 'threads', `${id}.jsonl`)
// Frames are taken between actions, never during one: a capture that overlaps input takes seconds.
const shots: { file: string; at: number; size: number; hold?: number; fast?: boolean }[] = []
let fast = false
const shot = async (hold?: number) => {
  const file = path.join(frames, `${String(shots.length).padStart(5, '0')}.png`)
  await app.screenshot({ path: file })
  shots.push({ file, at: Date.now(), size: Bun.file(log).size, hold, fast })
}
const film = async (ms: number) => {
  const until = Date.now() + ms
  do await shot()
  while (Date.now() < until)
}
const composer = app.getByTestId('composer')
const keyName = (ch: string) => (ch === ' ' ? 'space' : ch === '\n' ? 'enter' : ch)
// Keystrokes straight to the composer, a word per frame: a locator call re-reads the whole tree.
const type = async (text: string) => {
  const elementId = (await composer.element()).id
  for (const word of text.split(/(?<= )/)) {
    await app.call('keystrokes', { elementId, keys: [...word].map(keyName).join(' ') })
    await shot(0.11)
  }
}
const ended = async () => /"type":"(acp\/end|vellum\/error)"/.test(await Bun.file(log).text())
const step = async (label: string, run: () => Promise<unknown>, ms = 60_000) => {
  const t = Date.now()
  await Promise.race([run(), Bun.sleep(ms).then(() => { throw new Error(`${label}: no answer in ${ms} ms`) })])
  console.log(`${label} ${Math.round((Date.now() - t) / 1000)} s`)
}

try {
  await step('open', () => composer.waitFor({ timeoutMs: 60_000 }), 70_000)
  await step('type', async () => {
    await film(1200)
    await composer.click()
    await type('The test in src/cart.test.ts fails. Fix total() in src/cart.ts so it counts quantity, then run bun test and tell me in one line what changed.')
    await film(900)
  }, 180_000)
  await composer.press('cmd-enter')

  fast = true
  const started = Date.now()
  while (!(await ended()) && Date.now() - started < 300_000) {
    await film(500)
    if ((await app.getByTestId('approval-allow').count()) === 1) {
      await film(900)
      await app.getByTestId('approval-allow').click()
    }
  }
  fast = false
  console.log('turn', Math.round((Date.now() - started) / 1000), 's')
  await film(2000)

  await step('file pane', async () => {
    await app.getByTestId('edit-open').click()
    await film(4500)
    await app.getByTestId('open-files').click()
    await film(900)
  })
  await step('export', async () => {
    await app.getByTestId(`tab-${id}`).click()
    await app.getByTestId('menu-export-md').waitFor({ timeoutMs: 10_000 })
    await film(1200)
    await app.getByTestId('menu-export-md').click()
    await film(2500)
  })
} finally {
  await app.close()
}

// Real speed, except the agent's turn plays 6x, and 12x while the note sits unchanged for over 2 s.
let changed = 0
const seconds = shots.map((s, i) => {
  if (i === 0 || s.size !== shots[i - 1].size) changed = s.at
  if (s.hold !== undefined) return s.hold
  const real = ((shots[i + 1]?.at ?? s.at + 1000) - s.at) / 1000
  return s.fast ? real / (s.at - changed > 2000 ? 12 : 6) : real
})
const list = shots.map((s, i) => `file '${s.file}'\nduration ${seconds[i].toFixed(3)}`).join('\n') + `\nfile '${shots.at(-1)!.file}'\n`
await Bun.write(path.join(root, 'frames.txt'), list)
await Bun.$`mkdir -p ${path.dirname(out)}`.quiet()
const fit = 'fps=30,scale=1920:1200:force_original_aspect_ratio=decrease,pad=1920:1200:(ow-iw)/2:(oh-ih)/2:color=0x0a0a0a,format=yuv420p'
await Bun.$`ffmpeg -y -loglevel error -f concat -safe 0 -i ${path.join(root, 'frames.txt')} -vf ${fit} -c:v libx264 -crf 20 -movflags +faststart ${out}`
console.log(`${shots.length} frames →`, out)
console.log('export:', (await Bun.$`ls ${path.join(root, 'export')}`.nothrow().quiet().text()).trim() || 'none', '\nroot', root)
