// Self-check for the note's column: capped at 720 in every window, so prose stays scannable.
// Measures the composer, which spans the column less its padding.
//   bun scripts/check-width.ts
import path from 'node:path'
import { launch } from '@gpuix/react/automation'
import { readingWidthFor } from '../ui/theme'
import { scratchDir } from './scratch'

const home = await scratchDir('vellum-width-')
await Bun.spawn(['bun', 'scripts/fixture.ts'], { env: { ...process.env, VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home') } }).exited

let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}
const column = async (width: number) => {
  const app = await launch({ command: 'bun', args: ['app.tsx'], env: { GPUIX_BACKGROUND: '1', VELLUM_HOME: home, VELLUM_CLAUDE_HOME: path.join(home, 'claude-home'), VELLUM_WINDOW: `${width}x900` } })
  try {
    await app.getByTestId('composer').waitFor({ timeoutMs: 60_000 })
    await new Promise((r) => setTimeout(r, 2000))
    await app.screenshot({ path: `screenshots/width-${width}.png` })
    return (await app.getByTestId('composer').bounds())?.width ?? 0
  } finally {
    await app.close()
  }
}
// The composer sits in the column's 28px side padding.
for (const width of [1080, 1360, 1800]) {
  const got = await column(width)
  const want = readingWidthFor(width) - 56
  expect(`a ${width}pt window has a ${want + 56}pt column`, Math.abs(got - want) <= 2, `composer ${got}`)
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
