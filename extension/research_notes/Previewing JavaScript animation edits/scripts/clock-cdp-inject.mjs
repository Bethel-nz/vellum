// clock-cdp-inject.mjs - PROVES: the document-start route open to an extension holding only "debugger":
// Page.enable + Page.addScriptToEvaluateOnNewDocument + Page.reload installs the clock before page scripts;
// it survives detaching the session (infobar can go), and the registration dies with the session (the next
// reload is clean). Also shows Emulation.setVirtualTimePolicy is not undone by detach or reload.
// Run: node "research_notes/Previewing JavaScript animation edits/scripts/clock-cdp-inject.mjs"  (from extension/; needs
//   require('playwright') resolvable, network access to https://flora.so/; Playwright 1.63 / Chromium 158 used)

import { chromium, clockSource, installSampler } from './clock-lib.mjs'

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 1700 } })
let page = await context.newPage()
await page.goto('https://flora.so/', { waitUntil: 'load', timeout: 60000 })
const cdp = await context.newCDPSession(page)
await cdp.send('Page.enable')
const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${installSampler})();(${clockSource})({ waapi: true, translateStartTime: true })` })
const loaded = new Promise((r) => cdp.once('Page.loadEventFired', r))
await cdp.send('Page.reload'); await loaded
const state = () => page.evaluate(() => ({ clock: !!window.__vclock, setIntervalWrapped: !/native code/.test(String(window.setInterval)) }))
console.log('addScriptToEvaluateOnNewDocument + Page.enable + Page.reload:', identifier, await state())
await cdp.detach()
console.log('after detaching that session:', await state())
await page.reload({ waitUntil: 'load' })
console.log('after a later reload, session gone:', await state())
await page.close()

// Virtual time pause, measured several ways on a fresh tab.
page = await context.newPage(); await page.goto('https://flora.so/', { waitUntil: 'load', timeout: 60000 })
const t = () => page.evaluate(() => performance.now())
const s = await context.newCDPSession(page)
const span = async (label) => { const a = await t(); await page.waitForTimeout(1000); const b = await t(); console.log(`${label}: performance.now advanced ${Math.round(b - a)} ms in 1000 ms wall`) }
console.log(await s.send('Emulation.setVirtualTimePolicy', { policy: 'pause' }))
await span('pause #1, immediately')
await span('pause #1, a second later')
console.log(await s.send('Emulation.setVirtualTimePolicy', { policy: 'pause' }))
await span('pause sent again')
console.log(await s.send('Emulation.setVirtualTimePolicy', { policy: 'pause', initialVirtualTime: Date.now() / 1000 }).catch((e) => String(e).slice(0, 120)))
await span('pause with initialVirtualTime')
await browser.close()
