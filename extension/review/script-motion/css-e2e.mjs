// Regression: an element with a CSS animation and no Motion keeps the CSS playback and timing dials, with no Motion note.
// Run from the repo: `cd extension && bun run build && node review/script-motion/css-e2e.mjs`.
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { HERE, open } from './harness.mjs'
const server = createServer((_request, response) => { response.setHeader('content-type', 'text/html'); response.end(readFileSync(path.join(HERE, 'site/index.html'))) })
await new Promise((resolve) => server.listen(8765, '127.0.0.1', resolve))
const { ctx, page, errors } = await open({ url: 'http://127.0.0.1:8765/', ready: '#box', scroll: '#box' })
try {
  const box = await page.locator('#box').boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.getByRole('button', { name: 'Show element controls' }).click()
  await page.waitForTimeout(800)
  console.log('motion note:', await page.locator('.vellum-motion-note').count())
  const folders = await page.locator('.dialkit-folder-header-top').evaluateAll((all) => all.map((el) => el.getAttribute('aria-label')))
  console.log('folders:', folders.join(', '))
  console.log('page errors:', errors)
} finally { await ctx.close(); server.close() }
