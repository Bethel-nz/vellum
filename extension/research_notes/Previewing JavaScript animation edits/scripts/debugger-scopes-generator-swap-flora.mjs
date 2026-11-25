// PROVES (by execution, live on https://flora.so/, no reload, no breakpoint, no pause): the closest
// substitute for LiveEdit now that Debugger.setScriptSource is gone. Runtime.queryObjects(Function.prototype)
// finds Motion's spring generator; Runtime.getProperties exposes its [[Scopes]] (the bundle's module closure);
// in that scope sits Motion's generator table {decay, inertia, tween, keyframes, spring} that JSAnimation
// looks up on every animation start. Swapping table.spring for a wrapper (duration x3) changes every new
// spring on the page; putting the original function back reverts.
// Run: node debugger-scopes-generator-swap-flora.mjs   (~30 s; network to flora.so)
import { launchFlora, installRecorder, waitEpisode, pageNow, fmt } from './debugger-common.mjs'

const { browser, page, cdp } = await launchFlora()
await installRecorder(page)
console.log(fmt(await waitEpisode(page, { after: await pageNow(page) })), ' <- baseline')
const fp = (await cdp.send('Runtime.evaluate', { expression: 'Function.prototype' })).result.objectId
const all = await cdp.send('Runtime.queryObjects', { prototypeObjectId: fp, objectGroup: 'v' })
const spring = (await cdp.send('Runtime.callFunctionOn', { objectId: all.objects.objectId, objectGroup: 'v', functionDeclaration: `function(){return this.find(f=>{try{const s=Function.prototype.toString.call(f);return s.includes('keyframes:[0,1],bounce:')&&s.includes('restDelta')&&'applyToOptions' in f}catch{return false}})}` })).result
console.log('spring fn:', spring.description.slice(0, 40))
const props = await cdp.send('Runtime.getProperties', { objectId: spring.objectId, ownProperties: true })
const scopes = props.internalProperties.find(p => p.name === '[[Scopes]]')
const scopeList = (await cdp.send('Runtime.getProperties', { objectId: scopes.value.objectId, ownProperties: true })).result.filter(r => /^\d+$/.test(r.name))
console.log('[[Scopes]]:', scopeList.map(s => s.value.description).join(' | '))
let table = null
for (const s of scopeList) {
  const vars = (await cdp.send('Runtime.getProperties', { objectId: s.value.objectId, ownProperties: true })).result
  console.log(`  ${s.value.description}: ${vars.length} variables`)
  for (const v of vars) {
    if (v.value?.type !== 'object' || !v.value.objectId) continue
    const ok = (await cdp.send('Runtime.callFunctionOn', { objectId: v.value.objectId, returnByValue: true, functionDeclaration: 'function(){return ["decay","inertia","tween","keyframes","spring"].every(k=>typeof this[k]==="function")}' })).result.value
    if (ok) { table = v; break }
  }
  if (table) break
}
console.log('generator table found as closure variable:', table?.name)
await cdp.send('Runtime.callFunctionOn', { objectId: table.value.objectId, functionDeclaration: `function(){const orig=this.spring;const w=function(o,b){return orig(o&&typeof o==='object'&&o.bounce===.16?{...o,duration:3*o.duration}:o,b)};w.applyToOptions=orig.applyToOptions;w.__vellumOriginal=orig;this.spring=w;return true}` })
console.log(fmt(await waitEpisode(page, { after: await pageNow(page) })), ' <- table.spring swapped (duration x3)')
await cdp.send('Runtime.callFunctionOn', { objectId: table.value.objectId, functionDeclaration: 'function(){this.spring=this.spring.__vellumOriginal;return true}' })
console.log(fmt(await waitEpisode(page, { after: await pageNow(page) })), ' <- original restored')
await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'v' })
await browser.close()
