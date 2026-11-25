// PROVES (by execution, synthetic page, Playwright Chromium): (1) cost of a side-effecting conditional
// breakpoint on a hot function (ns per call) vs. no debugger / Debugger.enable only; (2) several CDP
// clients can hold Debugger breakpoints on one page at once; (3) a client's breakpoints vanish when it
// detaches (automatic revert), while heap mutations it made persist; (4) Debugger.setScriptSource fails on
// any script in this build, and --js-flags=--inspector-live-edit does not bring it back.
// Run: node debugger-breakpoint-cost-and-clients.mjs   (~20 s, no network needed)
import { chromium } from './debugger-common.mjs'

const SRC = `function hot(o){ return o.x * 2 + 1 }
function bench(n){ const o = { x: 1 }; let s = 0; const t = performance.now(); for (let i = 0; i < n; i++) s += hot(o); return { ms: performance.now() - t, s } }
window.counter = { a: 0, b: 0 }
//# sourceURL=hot.js`
const HOT_LINE = 0; const HOT_COL = 'function hot(o){ '.length

for (const jsFlags of [null, '--inspector-live-edit']) {
  const browser = await chromium.launch(jsFlags ? { args: ['--js-flags=' + jsFlags] } : {})
  const ctx = await browser.newContext(); const page = await ctx.newPage()
  await page.setContent('<!doctype html><title>t</title>')
  await page.addScriptTag({ content: SRC })
  const bench = async n => { await page.evaluate(n => bench(n), Math.min(n, 1e4)); const r = await page.evaluate(n => bench(n), n); return (r.ms * 1e6 / n).toFixed(1) + ' ns/call' }
  const A = await ctx.newCDPSession(page); const B = await ctx.newCDPSession(page)
  if (!jsFlags) {
    console.log('Chromium', browser.version())
    console.log('no Debugger domain        ', await bench(1e7))
    await A.send('Debugger.enable')
    console.log('Debugger.enable only      ', await bench(1e7))
    const bp = await A.send('Debugger.setBreakpointByUrl', { url: 'hot.js', lineNumber: HOT_LINE, columnNumber: HOT_COL, condition: 'false' })
    console.log('bp condition false        ', await bench(2e5), JSON.stringify(bp.locations))
    await A.send('Debugger.removeBreakpoint', { breakpointId: bp.breakpointId })
    const bp2 = await A.send('Debugger.setBreakpointByUrl', { url: 'hot.js', lineNumber: HOT_LINE, columnNumber: HOT_COL, condition: '(o.x = 1, window.counter.a++, false)' })
    console.log('bp condition mutates      ', await bench(2e5))
    await A.send('Debugger.removeBreakpoint', { breakpointId: bp2.breakpointId })
    console.log('after removeBreakpoint    ', await bench(1e7))
    await A.send('Debugger.disable')
    console.log('after Debugger.disable    ', await bench(1e7))
    // multiple clients
    await A.send('Debugger.enable'); await B.send('Debugger.enable')
    await page.evaluate(() => { window.counter = { a: 0, b: 0 } })
    await A.send('Debugger.setBreakpointByUrl', { url: 'hot.js', lineNumber: HOT_LINE, columnNumber: HOT_COL, condition: '(window.counter.a++, false)' })
    await B.send('Debugger.setBreakpointByUrl', { url: 'hot.js', lineNumber: HOT_LINE, columnNumber: HOT_COL, condition: '(window.counter.b++, false)' })
    await page.evaluate(() => bench(100))
    console.log('two clients, 100 calls    ', JSON.stringify(await page.evaluate(() => window.counter)))
    await A.send('Runtime.evaluate', { expression: 'window.heapPatchedByA = true' })
    await A.detach()
    await page.evaluate(() => bench(100))
    console.log('after A.detach, 100 calls ', JSON.stringify(await page.evaluate(() => window.counter)), 'heap mutation by A still there:', await page.evaluate(() => window.heapPatchedByA))
  }
  const S = jsFlags ? A : B
  await S.send('Debugger.enable')
  const id = await new Promise(async res => { S.on('Debugger.scriptParsed', e => e.url === 'hot.js' && res(e.scriptId)); await S.send('Debugger.disable'); await S.send('Debugger.enable') })
  const { scriptSource } = await S.send('Debugger.getScriptSource', { scriptId: id })
  try { console.log('setScriptSource', jsFlags || '(default flags)', JSON.stringify(await S.send('Debugger.setScriptSource', { scriptId: id, scriptSource: scriptSource.replace('* 2', '* 3') }))) } catch (e) { console.log('setScriptSource', jsFlags || '(default flags)', '-> ERROR (verbatim):', e.message.split('\n')[0]) }
  await browser.close()
}
