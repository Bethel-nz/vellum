// PROVES (by execution on https://flora.so/): a Fetch.fulfillRequest rewrite of an immutable Next.js chunk
// is written to the HTTP cache with the original `cache-control: public,max-age=31536000,immutable`, so it
// outlives Fetch.disable, plain reloads and new tabs (preview leaks after "revert"). Shows two fixes:
// (a) revert by Page.reload({ignoreCache:true}) after Fetch.disable; (b) fulfil with `cache-control: no-store`
// so the patched body is never cached and a plain reload reverts.
// Run: node debugger-fetch-cache-poisoning-flora.mjs   (~120 s; network to flora.so)
import { launchFlora, installRecorder, waitEpisode, pageNow, findSpring, TRACK } from './debugger-common.mjs'

const { browser, ctx, page, cdp } = await launchFlora()
const sp = await findSpring(cdp); await cdp.send('Debugger.disable')
const p = sp.optParam; const bArg = sp.source.slice(sp.fnStart).match(/bounce:([\w$]+)\}:/)[1]
const patch = src => src.replace(`{visualDuration:${p},keyframes:[0,1],bounce:${bArg}}:${p},`, `{visualDuration:${p},keyframes:[0,1],bounce:${bArg}}:(.16===${p}.bounce?{...${p},duration:3*${p}.duration}:${p}),`)
let noStore = false
cdp.on('Fetch.requestPaused', async ev => {
  const b = await cdp.send('Fetch.getResponseBody', { requestId: ev.requestId })
  const src = b.base64Encoded ? Buffer.from(b.body, 'base64').toString() : b.body
  let headers = ev.responseHeaders.filter(h => !/^(content-length|content-encoding)$/i.test(h.name))
  if (noStore) headers = headers.filter(h => !/^cache-control$/i.test(h.name)).concat([{ name: 'cache-control', value: 'no-store' }])
  await cdp.send('Fetch.fulfillRequest', { requestId: ev.requestId, responseCode: 200, responseHeaders: headers, body: Buffer.from(patch(src)).toString('base64') })
})
const pattern = { patterns: [{ urlPattern: '*' + sp.url.split('/').pop(), resourceType: 'Script', requestStage: 'Response' }] }
const prep = async pg => { await pg.evaluate(() => scrollTo(0, 500)); await pg.waitForSelector(TRACK, { state: 'attached' }); await installRecorder(pg) }
const step = async (label, pg = page) => { const e = await waitEpisode(pg, { after: await pageNow(pg), timeout: 20000 }); console.log(label.padEnd(58), e.durationMs, 'ms', e.overshootPx, 'px', e.durationMs > 1000 ? 'PATCHED' : 'original') }
const hardReload = async () => { const l = page.waitForEvent('load'); await cdp.send('Page.reload', { ignoreCache: true }); await l; await prep(page) }
const softReload = async () => { await page.reload({ waitUntil: 'load' }); await prep(page) }

for (const mode of ['default headers', 'cache-control: no-store']) {
  noStore = mode !== 'default headers'
  console.log(`--- fulfil with ${mode}`)
  await cdp.send('Fetch.enable', pattern); await hardReload(); await step('Fetch on, ignoreCache reload')
  await cdp.send('Fetch.disable'); await softReload(); await step('Fetch off, plain reload')
  const tab = await ctx.newPage(); await tab.goto('https://flora.so/', { waitUntil: 'load' }); await prep(tab); await step('Fetch off, NEW TAB same profile', tab); await tab.close()
  await hardReload(); await step('Fetch off, Page.reload ignoreCache')
  await softReload(); await step('Fetch off, plain reload after that')
}
await browser.close()
