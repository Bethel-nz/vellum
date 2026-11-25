// Vellum research probe (Nov 2026): the only code that runs is this service worker. It attaches with
// chrome.debugger to the active tab, finds Motion's spring generator, sets a side-effecting conditional
// breakpoint (bounce 0.16 -> 0.5), tries setScriptSource (expected to fail), and exposes self.detach().
// Driven by ../debugger-extension-probe-flora.mjs.
// Probe: everything below goes through chrome.debugger only (no host permissions, no scripting).
const send = (tabId, m, p) => chrome.debugger.sendCommand({ tabId }, m, p)
self.probe = async () => {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  const out = { tabId: tab.id, targets: (await chrome.debugger.getTargets()).filter(t => t.tabId === tab.id).map(t => ({ type: t.type, attached: t.attached })) }
  await chrome.debugger.attach({ tabId: tab.id }, '1.3')
  try { await chrome.debugger.attach({ tabId: tab.id }, '1.3') } catch (e) { out.secondAttach = e.message }
  const scripts = []
  const onEvent = (src, method, params) => { if (method === 'Debugger.scriptParsed') scripts.push(params) }
  chrome.debugger.onEvent.addListener(onEvent)
  await send(tab.id, 'Debugger.enable')
  await new Promise(r => setTimeout(r, 300))
  chrome.debugger.onEvent.removeListener(onEvent)
  for (const s of scripts) {
    if (!s.url || s.length < 20000) continue
    const { scriptSource: src } = await send(tab.id, 'Debugger.getScriptSource', { scriptId: s.scriptId })
    const a = src.search(/keyframes:\[0,1\],bounce:/); if (a < 0 || !src.includes('restDelta')) continue
    const f = src.lastIndexOf('function ', a); const m = /^function [\w$]+\(([\w$]+)=[^,]+,[\w$]+=[^)]+\)\{/.exec(src.slice(f, f + 80))
    const body = f + m[0].length; const before = src.slice(0, body); const line = before.split('\n').length - 1; const col = body - before.lastIndexOf('\n') - 1
    const p = m[1]
    out.bp = await send(tab.id, 'Debugger.setBreakpointByUrl', { url: s.url, lineNumber: line, columnNumber: col, condition: `(${p}&&"object"==typeof ${p}&&.16===${p}.bounce&&(${p}.bounce=.5),false)` })
    try { await send(tab.id, 'Debugger.setScriptSource', { scriptId: s.scriptId, scriptSource: src }) ; out.setScriptSource = 'ok' } catch (e) { out.setScriptSource = e.message }
    break
  }
  out.evaluate = (await send(tab.id, 'Runtime.evaluate', { expression: '1+1', returnByValue: true })).result.value
  self.detach = () => chrome.debugger.detach({ tabId: tab.id })
  return out
}
chrome.debugger.onDetach.addListener((src, reason) => { self.lastDetach = reason })
