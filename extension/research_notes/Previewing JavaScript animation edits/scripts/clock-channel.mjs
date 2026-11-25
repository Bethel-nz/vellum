// clock-channel.mjs - PROVES (Chromium 158, CDP isolated world standing in for Snapshot's ISOLATED content
// script): a CustomEvent dispatched on document crosses ISOLATED -> MAIN with its detail intact (object or
// JSON string) and MAIN -> ISOLATED likewise; isTrusted is false for ours and for the page's, so the page can
// spoof commands; a page that hooked EventTarget.prototype.addEventListener first learns the "secret" event
// name; neither world sees the other's globals.
// Run: node "research_notes/Previewing JavaScript animation edits/scripts/clock-channel.mjs"  (from extension/; needs
//   require('playwright') resolvable, network access to https://flora.so/; Playwright 1.63 / Chromium 158 used)

import { chromium } from './clock-lib.mjs'
const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('https://flora.so/', { waitUntil: 'load', timeout: 60000 })
const cdp = await page.context().newCDPSession(page)
const { frameTree } = await cdp.send('Page.getFrameTree')
const { executionContextId } = await cdp.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'snapshot-isolated' })
const iso = async (expression) => (await cdp.send('Runtime.evaluate', { expression, contextId: executionContextId, returnByValue: true, awaitPromise: true })).result.value
// A hostile page hooks addEventListener before any extension code runs.
await page.evaluate(() => { const add = EventTarget.prototype.addEventListener; window.__sniffed = []; EventTarget.prototype.addEventListener = function (type, ...r) { window.__sniffed.push(type); return add.call(this, type, ...r) } })
// MAIN-world clock registers a secret-named command listener (token came in via executeScript args).
await page.evaluate(() => { const token = 'vellum-clock:' + crypto.randomUUID(); window.__token = token; document.addEventListener(token, (e) => { (window.__got ||= []).push({ detailType: typeof e.detail, detail: e.detail, isTrusted: e.isTrusted }) }) })
const token = await page.evaluate(() => window.__token)
await iso(`document.dispatchEvent(new CustomEvent(${JSON.stringify(token)}, { detail: { cmd: 'rate', value: 0.25 } })); 1`)
await iso(`document.dispatchEvent(new CustomEvent(${JSON.stringify(token)}, { detail: JSON.stringify({ cmd: 'pause' }) })); 1`)
await page.evaluate((t) => document.dispatchEvent(new CustomEvent(t, { detail: { cmd: 'spoofed by page' } })), token)
console.log('MAIN received:', JSON.stringify(await page.evaluate(() => window.__got)))
console.log('page sniffed listener types include the secret token:', await page.evaluate(() => window.__sniffed.includes(window.__token)))
// Reverse direction: MAIN status event, isolated listener.
await iso(`document.addEventListener('vellum-clock-status', (e) => { (window.__status ||= []).push({ detailType: typeof e.detail, detail: e.detail, isTrusted: e.isTrusted }) }); 1`)
await page.evaluate(() => document.dispatchEvent(new CustomEvent('vellum-clock-status', { detail: { rate: 0.25, lag: 1234 } })))
console.log('ISOLATED received:', JSON.stringify(await iso('window.__status')))
console.log('isolated world sees MAIN globals?', await iso('typeof window.__token'), '| MAIN sees isolated globals?', await page.evaluate(() => typeof window.__status))
await browser.close()
