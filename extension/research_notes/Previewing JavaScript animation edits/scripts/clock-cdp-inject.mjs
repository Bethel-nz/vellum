// clock-cdp-inject.mjs - PROVES: the document-start route open to an extension holding only "debugger":
// Page.enable + Page.addScriptToEvaluateOnNewDocument + Page.reload installs the clock before page scripts;
// it survives detaching the session (infobar can go), and the registration dies with the session (the next
// reload is clean). runImmediately installs into the current document. Also shows that
// Emulation.setVirtualTimePolicy is NOT undone by detaching or by reloading (both headless builds), and that
// 'pause' freezes performance.now on a fresh tab. WARNING: run only in a throwaway browser.
// Run: node "research_notes/Previewing JavaScript animation edits/scripts/clock-cdp-inject.mjs"  (from extension/; needs
//   require('playwright') resolvable, network access to https://flora.so/; Playwright 1.63 / Chromium 158 used)

import { chromium, clockSource, installSampler } from './clock-lib.mjs'

const url = 'https://flora.so/'
{ // 1. CDP document-start install
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 1700 } })
  const page = await context.newPage(); await page.goto(url, { waitUntil: 'load', timeout: 60000 })
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
  await browser.close()
}
for (const channel of [undefined, 'chromium']) { // 2. runImmediately + virtual-time stickiness
  const browser = await chromium.launch(channel ? { channel } : {})
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1700 } })).newPage()
  await page.goto(url, { waitUntil: 'load', timeout: 60000 })
  console.log(`\n=== ${channel ?? 'default headless shell'} ${browser.version()}`)
  const t = () => page.evaluate(() => performance.now())
  const span = async (label) => { const a = await t(); await page.waitForTimeout(1000); const b = await t(); console.log(`${label}: performance.now advanced ${Math.round(b - a)} ms in 1000 ms wall`) }
  const s1 = await page.context().newCDPSession(page)
  const r = await s1.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${clockSource})({ key: '__vclock2' })`, runImmediately: true })
  console.log('runImmediately:', r, '-> installed in current document:', await page.evaluate(() => !!window.__vclock2))
  await s1.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: r.identifier })
  await s1.send('Emulation.setVirtualTimePolicy', { policy: 'pause' })
  await span('pause (same session that ran runImmediately)')
  await s1.detach(); await span('after detach')
  const s2 = await page.context().newCDPSession(page)
  await s2.send('Emulation.setVirtualTimePolicy', { policy: 'advance' }); await span('policy advance')
  await s2.detach(); await span('after detach from advance')
  await page.reload({ waitUntil: 'load' }); await span('after page.reload')
  const fresh = await page.context().newPage(); await fresh.goto(url, { waitUntil: 'load', timeout: 60000 })
  const s3 = await page.context().newCDPSession(fresh)
  await s3.send('Emulation.setVirtualTimePolicy', { policy: 'pause' })
  const a = await fresh.evaluate(() => performance.now()); await fresh.waitForTimeout(1000); const b = await fresh.evaluate(() => performance.now())
  console.log(`fresh tab, pause: performance.now advanced ${Math.round(b - a)} ms in 1000 ms wall`)
  await browser.close()
}
