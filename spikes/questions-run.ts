// Launches spikes/questions.tsx and shoots it to screenshots/spike-questions-<tag>.png: as it
// opens, with the field focused and typed into, and on the free-text-only second question.
import { launch } from '@gpuix/react/automation'
const tag = process.argv[2] ?? 'now'
const app = await launch({ command: 'bun', args: ['spikes/questions.tsx'], env: { GPUIX_BACKGROUND: '1' } })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
try {
  await app.getByTestId('user-questions').waitFor({ timeoutMs: 30_000 })
  await wait(900)
  await app.screenshot({ path: `screenshots/spike-questions-${tag}-1.png` })
  await app.getByTestId('question-free-text').click()
  await app.call('keystrokes' as never, { keys: 'tabs' } as never)
  await wait(300)
  await app.screenshot({ path: `screenshots/spike-questions-${tag}-2.png` })
  await app.getByTestId('question-skip').click()
  await wait(600)
  await app.screenshot({ path: `screenshots/spike-questions-${tag}-3.png` })
} finally {
  await app.close()
}
