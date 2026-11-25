// PROVES (by execution, live on https://flora.so/, no reload): three CDP techniques and one page hook
// change the spring of Motion's JS-driven carousel and revert cleanly, measured per frame.
//   (a) find Motion's spring generator via Debugger.scriptParsed + getScriptSource fingerprints
//   (b) side-effecting conditional breakpoint (logpoint pattern): bounce 0.16 -> 0.5, never pauses
//   (c) Debugger.setScriptSource (V8 LiveEdit) with dryRun / plain / allowTopFrameEditing: on Chromium 158
//       (V8 15.8) every call fails with "setScriptSource functionality no longer available" (logged verbatim);
//       if a build ever accepts it, the script measures the x3 duration and reverts with the original text
//   (d) Runtime.queryObjects: enumerate live Motion classes/instances; own-property override of
//       getDefaultTransition() on the carousel's VisualElement (duration 1.1 s, bounce 0.5)
//   (f) globalThis.__MOTION_INSPECT__ (motion-dom 14.x inspector hook): bounce 0.3 via initAnimation()
// Each patch is followed by a revert and a fresh measurement showing ~565 ms / ~2.2 px returns.
// Expected (Nov 2026): baseline ~565 ms/2.2 px; (b) ~547 ms/47 px; (d) ~1116 ms/47 px; (f) ~565 ms/13 px.
// Run: node debugger-live-patch-flora.mjs   (needs Playwright's bundled Chromium; ~70 s; network to flora.so)
import { launchFlora, installRecorder, waitEpisode, pageNow, findSpring, fmt, TRACK } from './debugger-common.mjs'

const log = (...a) => console.log(...a)
const { browser, page, cdp, version } = await launchFlora()
log('Chromium', version)
const consoleMsgs = []
cdp.on('Runtime.consoleAPICalled', e => { const t = e.args.map(a => a.value ?? a.description).join(' '); if (t.includes('[vellum]')) consoleMsgs.push(t) })
await cdp.send('Runtime.enable')

// (a) locate
const sp = await findSpring(cdp)
log(`(a) spring generator: function ${sp.fnName}(${sp.optParam}, ...) in ${sp.url} scriptId=${sp.scriptId} len=${sp.source.length} ` +
  `line=${sp.lineNumber} col=${sp.columnNumber} sourceMapURL=${sp.sourceMapURL} hits(restDelta,restSpeed,visualDuration,isResolvedFromDuration)=${sp.hits} ` +
  `scriptsSeen=${sp.scriptsSeen} discovery=${sp.elapsedMs} ms`)
const possible = await cdp.send('Debugger.getPossibleBreakpoints', { start: { scriptId: sp.scriptId, lineNumber: sp.lineNumber, columnNumber: sp.columnNumber }, end: { scriptId: sp.scriptId, lineNumber: sp.lineNumber, columnNumber: sp.columnNumber + 120 } })
log('    first breakable locations in body:', JSON.stringify(possible.locations.slice(0, 3)))

await installRecorder(page)
const results = []
const measure = async (label, after) => { const e = await waitEpisode(page, { after: after ?? await pageNow(page) }); results.push({ label, ...e }); log(`  ${label.padEnd(44)} ${fmt(e)}`); return e }

await measure('baseline')
await measure('baseline (2nd)')

// (b) conditional breakpoint whose condition mutates the options object and returns false
const p = sp.optParam
const condition = `(${p}&&"object"==typeof ${p}&&.16===${p}.bounce&&(console.debug("[vellum] spring opts in:",${p}.duration,${p}.bounce),${p}.bounce=.5),false)`
const bp = await cdp.send('Debugger.setBreakpointByUrl', { url: sp.url, lineNumber: sp.lineNumber, columnNumber: sp.columnNumber, condition })
log('(b) setBreakpointByUrl ->', JSON.stringify(bp), ' condition:', condition)
let paused = 0; cdp.on('Debugger.paused', () => { paused++; cdp.send('Debugger.resume').catch(() => {}) })
await measure('(b) breakpoint condition bounce 0.16->0.5')
await cdp.send('Debugger.removeBreakpoint', { breakpointId: bp.breakpointId })
await measure('(b) reverted: removeBreakpoint')
log('    Debugger.paused events during (b):', paused, ' console from condition:', JSON.stringify(consoleMsgs))

// (c) LiveEdit the spring generator's first statement: duration x3 when bounce is 0.16
const original = sp.source
const fnHead = original.slice(sp.fnStart, sp.fnStart + 400)
const lit = `"object"!=typeof ${p}?{visualDuration:${p},keyframes:[0,1],bounce:`
const k = fnHead.indexOf(lit); if (k < 0) throw new Error('literal not found')
const litEnd = fnHead.indexOf('}:' + p, k) + 2
const patchedHead = fnHead.slice(0, litEnd) + `(.16===${p}.bounce?{...${p},duration:3*${p}.duration}:${p})` + fnHead.slice(litEnd + p.length)
const patched = original.slice(0, sp.fnStart) + patchedHead + original.slice(sp.fnStart + 400)
log('(c) patched head:', patchedHead.slice(0, 140))
const trySet = async (label, params) => {
  const t = performance.now()
  try { const r = await cdp.send('Debugger.setScriptSource', params); log(`    ${label} -> ${JSON.stringify(r)} in ${Math.round(performance.now() - t)} ms`); return r } catch (e) { log(`    ${label} -> ERROR (verbatim): ${e.message.split('\n')[0]}`); return null }
}
await trySet('setScriptSource dryRun', { scriptId: sp.scriptId, scriptSource: patched, dryRun: true })
const live = await trySet('setScriptSource', { scriptId: sp.scriptId, scriptSource: patched })
await trySet('setScriptSource allowTopFrameEditing', { scriptId: sp.scriptId, scriptSource: patched, allowTopFrameEditing: true })
const after = await cdp.send('Debugger.getScriptSource', { scriptId: sp.scriptId })
log('    getScriptSource now returns patched text:', after.scriptSource.includes('duration:3*'))
if (live) {
  await measure('(c) setScriptSource duration x3')
  await trySet('revert setScriptSource(original)', { scriptId: sp.scriptId, scriptSource: original })
  await measure('(c) reverted: original source re-set')
} else {
  await measure('(c) after failed setScriptSource (unchanged)')
}

// (d) heap discovery without React: all functions -> Motion classes by fingerprint -> live instances
const fp = (await cdp.send('Runtime.evaluate', { expression: 'Function.prototype' })).result.objectId
let t = performance.now()
const allFns = await cdp.send('Runtime.queryObjects', { prototypeObjectId: fp, objectGroup: 'vellum' })
const qMs = Math.round(performance.now() - t)
const nFns = (await cdp.send('Runtime.callFunctionOn', { objectId: allFns.objects.objectId, functionDeclaration: 'function(){return this.length}', returnByValue: true })).result.value
log(`(d) queryObjects(Function.prototype): ${nFns} functions in ${qMs} ms`)
const pick = async test => (await cdp.send('Runtime.callFunctionOn', { objectId: allFns.objects.objectId, objectGroup: 'vellum', functionDeclaration: `function(){const s=f=>{try{return Function.prototype.toString.call(f)}catch{return''}};return this.find(f=>{const x=s(f);return ${test}})}` })).result
const classes = {
  VisualElement: await pick(`x.startsWith('class ')&&x.includes('scrapeMotionValuesFromProps')&&x.includes('getDefaultTransition()')`),
  MotionValue: await pick(`x.startsWith('class ')&&x.includes('this.canTrackVelocity=null')`),
  JSAnimation: await pick(`x.startsWith('class ')&&x.includes('initAnimation()')&&x.includes('this.state="idle"')`)
}
const inst = {}
for (const [name, cls] of Object.entries(classes)) {
  if (!cls.objectId) { log('    class not found:', name); continue }
  const proto = (await cdp.send('Runtime.callFunctionOn', { objectId: cls.objectId, objectGroup: 'vellum', functionDeclaration: 'function(){return this.prototype}' })).result.objectId
  t = performance.now()
  const q = await cdp.send('Runtime.queryObjects', { prototypeObjectId: proto, objectGroup: 'vellum' })
  const ms = Math.round(performance.now() - t)
  const n = (await cdp.send('Runtime.callFunctionOn', { objectId: q.objects.objectId, functionDeclaration: 'function(){return this.length}', returnByValue: true })).result.value
  inst[name] = q.objects.objectId
  log(`    ${name}: minified ${cls.description?.slice(0, 40)} -> ${n} live instances (queryObjects ${ms} ms)`)
}
const veInfo = await cdp.send('Runtime.callFunctionOn', { objectId: inst.VisualElement, returnByValue: true, functionDeclaration: `function(sel){const el=document.querySelector(sel);const v=this.find(v=>v.current===el);if(!v)return null;const x=v.values.get('x');return {tag:v.current.tagName,ctor:v.constructor.name,transition:v.props.transition,animate:v.props.animate,values:[...v.values.keys()],xValue:x&&x.get(),xIsMotionValue:!!x&&this.length>0,xHasAnimation:!!(x&&x.animation)}}`, arguments: [{ value: TRACK }] })
log('    carousel VisualElement:', JSON.stringify(veInfo.result.value))
const ve = (await cdp.send('Runtime.callFunctionOn', { objectId: inst.VisualElement, objectGroup: 'vellum', functionDeclaration: 'function(sel){const el=document.querySelector(sel);return this.find(v=>v.current===el)}', arguments: [{ value: TRACK }] })).result.objectId
await cdp.send('Runtime.callFunctionOn', { objectId: ve, functionDeclaration: `function(){const proto=Object.getPrototypeOf(this);this.getDefaultTransition=function(){const t=proto.getDefaultTransition.call(this);return t&&t.type==='spring'?{...t,duration:1.1,bounce:.5}:t};return true}` })
await measure('(d) instance override duration 1.1 bounce 0.5')
await cdp.send('Runtime.callFunctionOn', { objectId: ve, functionDeclaration: 'function(){return delete this.getDefaultTransition}' })
await measure('(d) reverted: delete own property')
await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'vellum' })

// (f) Motion's own inspector hook: re-run initAnimation() with new options before the first tick
await cdp.send('Runtime.evaluate', { expression: `globalThis.__MOTION_INSPECT__=r=>{if(r.kind==='animation-start'&&r.options&&r.options.bounce===.16&&r.options.name==='x'&&typeof r.animation.initAnimation==='function'){r.options.bounce=.3;r.animation.initAnimation();console.debug('[vellum] inspect hook patched',r.options.name,r.animation.constructor.name)}}` })
await measure('(f) __MOTION_INSPECT__ bounce 0.3')
await cdp.send('Runtime.evaluate', { expression: 'delete globalThis.__MOTION_INSPECT__' })
await measure('(f) reverted: delete hook')
log('console:', JSON.stringify(consoleMsgs.slice(-3)))
await cdp.send('Debugger.disable')
log('JSON', JSON.stringify(results))
await browser.close()
