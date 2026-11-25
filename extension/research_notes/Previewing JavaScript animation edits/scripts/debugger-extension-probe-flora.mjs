// PROVES (by execution, full Chromium in new-headless mode with a real unpacked MV3 extension that has only
// the "debugger" permission): chrome.debugger can attach to flora.so while another CDP client (Playwright)
// is attached; a second attach from the same extension is refused (verbatim error); the conditional-breakpoint
// spring patch works through chrome.debugger.sendCommand; setScriptSource is refused there too; detach reverts.
// Run: node debugger-extension-probe-flora.mjs [ext-dir]   (default ./debugger-extension-probe next to this file:
// manifest.json + sw.js probe; uses Playwright's full Chromium via channel 'chromium' because the headless
// shell cannot load extensions; ~40 s; network to flora.so)
import { chromium, installRecorder, waitEpisode, pageNow, fmt, TRACK } from './debugger-common.mjs'
import os from 'os'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url'
const ext = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), 'debugger-extension-probe'))
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vellum-prof-'))
const ctx = await chromium.launchPersistentContext(dir, { channel: 'chromium', viewport: { width: 1440, height: 900 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] })
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker')
const page = ctx.pages()[0] || await ctx.newPage()
console.log('browser', ctx.browser()?.version() ?? '(persistent)', 'ua', await page.evaluate(() => navigator.userAgent).catch(() => ''))
await page.goto('https://flora.so/', { waitUntil: 'load' }); await page.evaluate(() => scrollTo(0, 500)); await page.waitForSelector(TRACK, { state: 'attached' })
const pw = await ctx.newCDPSession(page); await pw.send('Debugger.enable') // a second, independent debugger client
await installRecorder(page)
console.log(fmt(await waitEpisode(page, { after: await pageNow(page) })), ' <- baseline')
console.log('probe:', JSON.stringify(await sw.evaluate(() => self.probe())))
console.log(fmt(await waitEpisode(page, { after: await pageNow(page) })), ' <- via chrome.debugger breakpoint (bounce 0.5)')
await sw.evaluate(() => self.detach())
console.log(fmt(await waitEpisode(page, { after: await pageNow(page) })), ' <- after chrome.debugger.detach')
await ctx.close()
