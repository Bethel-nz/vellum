// Loads a test copy of extension/dist (run `bun run build` first) into Playwright's full Chromium in
// new-headless mode and opens Snapshot on flora.so. Needs the global `playwright` package and network access.
// Test-only changes to the copy: <all_urls> host access (automation can't click the toolbar button that
// grants activeTab) and an open shadow root (so the test can reach the panel's controls).
import { createRequire } from 'node:module'
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
export const HERE = import.meta.dirname
/** Screenshots and the browser's temporary copies go here, outside the repo. */
export const S = mkdtempSync(path.join(tmpdir(), 'vellum-script-motion-'))
export const TRACK = '.journal-carousel .t-panel-slide > div'
export async function open({ dist = path.resolve(HERE, '../../dist'), url = 'https://flora.so/', ready = TRACK, scroll = '.journal-carousel' } = {}) {
  const ext = path.join(S, 'ext'); cpSync(dist, ext, { recursive: true })
  const manifest = JSON.parse(readFileSync(path.join(ext, 'manifest.json'), 'utf8')); manifest.host_permissions = ['<all_urls>']
  writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(manifest))
  const content = readFileSync(path.join(ext, 'content.js'), 'utf8'); const open = content.replace('attachShadow({mode:`closed`})', 'attachShadow({mode:`open`})')
  if (open === content) throw new Error('shadow root patch did not apply'); writeFileSync(path.join(ext, 'content.js'), open)
  const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(S, 'profile-')), { channel: 'chromium', viewport: { width: 1440, height: 900 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] })
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker')
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForSelector(ready, { state: 'attached' })
  await page.evaluate((selector) => document.querySelector(selector).scrollIntoView({ block: 'nearest' }), scroll)
  await page.waitForTimeout(800) // the page may scroll smoothly; a click during it lands on a moving target
  const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url?.startsWith(url)).id, url)
  await sw.evaluate(async (tabId) => { await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }); await chrome.tabs.sendMessage(tabId, { type: 'toggle' }) }, tabId)
  await page.waitForSelector('[data-vellum-capture]', { state: 'attached' })
  return { ctx, sw, page, tabId, errors }
}
// Samples the carousel track's translateX every frame in the page's own world.
export async function startSampler(page) {
  await page.evaluate((sel) => {
    const track = document.querySelector(sel); const rows = []; window.__trackRows = rows
    const loop = () => { rows.push([performance.now(), new DOMMatrix(getComputedStyle(track).transform).m41]); requestAnimationFrame(loop) }
    requestAnimationFrame(loop)
  }, TRACK)
}
// The last completed move: overshoot past its final value and the time to settle within 0.5 px.
export async function lastMove(page) {
  return page.evaluate(() => {
    const rows = window.__trackRows; const moves = []; let start = null
    for (let i = 1; i < rows.length; i++) {
      const moving = Math.abs(rows[i][1] - rows[i - 1][1]) > 0.05
      if (moving && start === null) start = i - 1
      if (!moving && start !== null) {
        let j = i; while (j < rows.length && Math.abs(rows[j][1] - rows[i][1]) <= 0.05) j++
        if (j - i >= 12 || j === rows.length) { moves.push([start, i]); start = null }
      }
    }
    let [a, b] = moves.at(-1) ?? []; if (a === undefined) return null
    // A replay starts with a one-frame jump back to where the move began; the move starts after it.
    let first = a; for (let i = a + 1; i < Math.min(b, a + 4); i++) if (Math.abs(rows[i][1] - rows[i - 1][1]) > 100) first = i
    a = first
    const from = rows[a][1], to = rows[b][1], dir = Math.sign(to - from)
    let peak = 0, settle = rows[a][0]
    for (let i = a; i <= b; i++) { peak = Math.max(peak, dir * (rows[i][1] - to)); if (Math.abs(rows[i][1] - to) > 0.5) settle = rows[i + 1]?.[0] ?? rows[i][0] }
    return { from: +from.toFixed(1), to: +to.toFixed(1), overshootPx: +peak.toFixed(2), settleMs: Math.round(settle - rows[a][0]), endedAgoMs: Math.round(performance.now() - rows[b][0]), moves: moves.length, startedAt: rows[a][0] }
  })
}
