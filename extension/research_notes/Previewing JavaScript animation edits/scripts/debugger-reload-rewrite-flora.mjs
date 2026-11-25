// PROVES (by execution on https://flora.so/, each step needs a RELOAD except the last revert):
//   (1) page facts that constrain rewriting: SRI attributes, service worker, CSP, how the Motion chunk loads
//   (2) Fetch.enable(requestStage Response) + getResponseBody + fulfillRequest rewrites the Motion chunk
//       (spring duration x3) only when the reload bypasses the cache (Page.reload ignoreCache): a plain
//       reload serves the immutable chunk from cache and is never paused; Fetch.disable + plain reload reverts
//   (3) Page.enable + Page.addScriptToEvaluateOnNewDocument installs globalThis.__MOTION_INSPECT__ before Motion runs
//       (bounce 0.3); removeScriptToEvaluateOnNewDocument + reload reverts
//   (4) Debugger.setBreakpointByUrl survives a reload (re-binds to the new script by URL) and a client's
//       breakpoints are removed when it detaches, reverting live without a reload
// Run: node debugger-reload-rewrite-flora.mjs   (~90 s; network to flora.so)
import { launchFlora, installRecorder, waitEpisode, pageNow, findSpring, fmt, TRACK } from './debugger-common.mjs'

const log = (...a) => console.log(...a)
const { browser, ctx, page, cdp, version } = await launchFlora()
log('Chromium', version)
const results = []
const measure = async label => { const e = await waitEpisode(page, { after: await pageNow(page), timeout: 20000 }); results.push({ label, ...e }); log(`  ${label.padEnd(46)} ${fmt(e)}`); return e }
const reload = async ({ ignoreCache = false } = {}) => { const t = Date.now(); if (ignoreCache) { const loaded = page.waitForEvent('load'); await cdp.send('Page.reload', { ignoreCache: true }); await loaded } else await page.reload({ waitUntil: 'load', timeout: 60000 }); await page.evaluate(() => scrollTo(0, 500)); await page.waitForSelector(TRACK, { state: 'attached' }); await installRecorder(page); return Date.now() - t }

// (1) facts
const facts = await page.evaluate(() => ({
  scriptsWithIntegrity: document.querySelectorAll('script[integrity],link[integrity]').length,
  swController: !!navigator.serviceWorker?.controller,
  motionChunkTag: [...document.scripts].filter(s => s.src.includes('43t38g6et1zz8')).map(s => ({ async: s.async, defer: s.defer, type: s.type, crossOrigin: s.crossOrigin })),
  motionChunkPreload: [...document.querySelectorAll('link[rel=preload],link[rel=modulepreload]')].filter(l => l.href.includes('43t38g6et1zz8')).length,
  cspMeta: !!document.querySelector('meta[http-equiv="Content-Security-Policy" i]')
}))
const docHeaders = (await page.request.get('https://flora.so/')).headers()
log('(1) facts', JSON.stringify(facts), 'doc CSP header:', docHeaders['content-security-policy'] || 'none')
const sp = await findSpring(cdp)
log('    Motion chunk', sp.url, 'fn', sp.fnName, 'sourceMapURL', sp.sourceMapURL)
await cdp.send('Debugger.disable')
await installRecorder(page)
await measure('baseline (warm load)')

// (2) Fetch rewrite of the Motion chunk on reload
const p = sp.optParam
const patchBody = src => src.replace(`{visualDuration:${p},keyframes:[0,1],bounce:${sp.source.slice(sp.fnStart).match(/bounce:([\w$]+)\}:/)[1]}}:${p},`, m => m.slice(0, -(p.length + 1)) + `(.16===${p}.bounce?{...${p},duration:3*${p}.duration}:${p}),`)
let intercepted = []
cdp.on('Fetch.requestPaused', async ev => {
  try {
    const body = await cdp.send('Fetch.getResponseBody', { requestId: ev.requestId })
    const src = body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body
    const out = patchBody(src)
    const headers = (ev.responseHeaders || []).filter(h => !/^(content-length|content-encoding)$/i.test(h.name))
    intercepted.push({ url: ev.request.url.split('/').pop(), status: ev.responseStatusCode, changed: out !== src, bytes: src.length })
    await cdp.send('Fetch.fulfillRequest', { requestId: ev.requestId, responseCode: ev.responseStatusCode || 200, responseHeaders: headers, body: Buffer.from(out).toString('base64') })
  } catch (e) { log('    fetch handler error', e.message); cdp.send('Fetch.continueRequest', { requestId: ev.requestId }).catch(() => {}) }
})
await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/_next/static/*' + sp.url.split('/').pop(), resourceType: 'Script', requestStage: 'Response' }] })
log('(2) Fetch.enable + plain reload took', await reload(), 'ms; intercepted', JSON.stringify(intercepted), '(immutable chunk served from cache, never paused)')
await measure('(2) Fetch rewrite, plain reload (cache hit)')
log('    Fetch.enable + Page.reload(ignoreCache) took', await reload({ ignoreCache: true }), 'ms; intercepted', JSON.stringify(intercepted))
await measure('(2) Fetch rewrite x3 (ignoreCache reload)')
await cdp.send('Fetch.disable')
intercepted = []
log('    Fetch.disable + reload took', await reload(), 'ms')
await measure('(2) reverted: Fetch.disable + reload')

// (3) inspector hook installed before any page script (needs Page.enable on this session, else it silently never runs)
await cdp.send('Page.enable')
const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `globalThis.__MOTION_INSPECT__=r=>{if(r.kind==='animation-start'&&r.options&&r.options.bounce===.16&&r.options.name==='x'&&typeof r.animation.initAnimation==='function'){r.options.bounce=.3;r.animation.initAnimation()}}` })
log('(3) addScriptToEvaluateOnNewDocument id', identifier, '+ reload', await reload(), 'ms')
await measure('(3) pre-load __MOTION_INSPECT__ bounce 0.3')
await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier })
log('    removeScriptToEvaluateOnNewDocument + reload', await reload(), 'ms')
await measure('(3) reverted: removed + reload')

// (4) breakpoint by URL survives reload; detaching the client reverts live
const cdp2 = await ctx.newCDPSession(page)
await cdp2.send('Debugger.enable')
const bp = await cdp2.send('Debugger.setBreakpointByUrl', { url: sp.url, lineNumber: sp.lineNumber, columnNumber: sp.columnNumber, condition: `(${p}&&"object"==typeof ${p}&&.16===${p}.bounce&&(${p}.bounce=.5),false)` })
let resolved = []; cdp2.on('Debugger.breakpointResolved', e => resolved.push(e.location))
log('(4) breakpoint', bp.breakpointId, 'bound', JSON.stringify(bp.locations), '+ reload', await reload(), 'ms; re-resolved after reload:', JSON.stringify(resolved))
await measure('(4) bp-by-URL after reload bounce 0.5')
await cdp2.detach()
await measure('(4) reverted live: CDP client detached')
log('JSON', JSON.stringify(results))
await browser.close()
