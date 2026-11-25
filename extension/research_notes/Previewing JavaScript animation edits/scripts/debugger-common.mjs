// Shared helpers for the debugger-*.mjs proofs (Vellum Snapshot research, Nov 2026).
// Not a proof on its own. Loads Playwright via require so it works from any directory.
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
export const { chromium } = require('playwright')

export const TRACK = '.journal-carousel .t-panel-slide > div'
export const STEP = 288 // px per carousel page at a 1440x900 viewport (pageWidth 240 + gap 48)

export async function launchFlora ({ url = 'https://flora.so/', scrollY = 500 } = {}) {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await page.goto(url, { waitUntil: 'load', timeout: 60000 })
  await page.evaluate(y => scrollTo(0, y), scrollY)
  await page.waitForSelector(TRACK, { state: 'attached', timeout: 15000 }) // zero-size wrapper, so not 'visible'
  return { browser, ctx, page, cdp, version: browser.version() }
}

// Records every write to the track's inline transform (MutationObserver, so one sample per Motion render).
export async function installRecorder (page) {
  await page.evaluate(sel => {
    const track = document.querySelector(sel)
    const parse = () => { const m = /translateX\((-?[\d.]+)px\)/.exec(track.style.transform); return m ? +m[1] : 0 }
    window.__vellumRec = { samples: [[performance.now(), parse()]] }
    new MutationObserver(() => {
      const s = window.__vellumRec.samples; const v = parse()
      if (s[s.length - 1][1] !== v) s.push([performance.now(), v])
    }).observe(track, { attributes: true, attributeFilter: ['style'] })
  }, TRACK)
}

export const pageNow = page => page.evaluate(() => performance.now())

// Waits for the next carousel step that starts after `after` (page ms) and settles; returns duration/overshoot.
export async function waitEpisode (page, { after, timeout = 15000, quiet = 400 } = {}) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const r = await page.evaluate(({ after, quiet }) => {
      const s = window.__vellumRec.samples; const now = performance.now()
      const i = s.findIndex(([t], k) => k > 0 && t > after)
      if (i < 0) return null
      let j = i; while (j + 1 < s.length && s[j + 1][0] - s[j][0] < 250) j++
      if (now - s[j][0] < quiet) return null
      return { from: s[i - 1][1], frames: s.slice(i, j + 1) }
    }, { after, quiet })
    if (r) {
      const { from, frames } = r
      const to = frames[frames.length - 1][1]; const dir = Math.sign(to - from)
      let peak = -Infinity; let peakT = 0
      for (const [t, v] of frames) { const d = dir * (v - to); if (d > peak) { peak = d; peakT = t } }
      const start = frames[0][0]; const end = frames[frames.length - 1][0]
      const frameMs = frames.length > 1 ? (end - start) / (frames.length - 1) : 16.7
      return {
        from, to, distance: Math.abs(to - from),
        durationMs: Math.round(end - start + frameMs), // first write .. last write, plus one frame
        overshootPx: +Math.max(0, peak).toFixed(2),
        peakAtMs: Math.round(peakT - start),
        frames: frames.length,
        startedAt: Math.round(start)
      }
    }
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error('no carousel step observed within ' + timeout + ' ms')
}

export function lineCol (src, idx) {
  let line = 0; let last = -1
  for (let k = src.indexOf('\n'); k !== -1 && k < idx; k = src.indexOf('\n', k + 1)) { line++; last = k }
  return { lineNumber: line, columnNumber: idx - last - 1 }
}

// Debugger.enable replays scriptParsed for every live script; fetch sources and find Motion's spring generator.
export async function findSpring (cdp) {
  const scripts = []
  const onParsed = e => scripts.push(e)
  cdp.on('Debugger.scriptParsed', onParsed)
  const t0 = performance.now()
  await cdp.send('Debugger.enable')
  await new Promise(r => setTimeout(r, 300))
  cdp.off('Debugger.scriptParsed', onParsed)
  const candidates = []
  for (const s of scripts) {
    if (!s.url || s.length < 20000) continue
    const { scriptSource } = await cdp.send('Debugger.getScriptSource', { scriptId: s.scriptId })
    const hits = ['restDelta', 'restSpeed', 'visualDuration', 'isResolvedFromDuration'].map(k => scriptSource.split(k).length - 1)
    if (hits.every(n => n > 0)) candidates.push({ s, src: scriptSource, hits })
  }
  const elapsedMs = Math.round(performance.now() - t0)
  if (!candidates.length) throw new Error('Motion spring not found in ' + scripts.length + ' scripts')
  const { s, src, hits } = candidates[0]
  // Motion's springGenerator(optionsOrVisualDuration, bounce) builds {visualDuration, keyframes:[0,1], bounce} for the number form.
  const anchor = src.search(/keyframes:\[0,1\],bounce:/)
  const fnStart = src.lastIndexOf('function ', anchor)
  const m = /^function ([\w$]+)\(([\w$]+)=[^,]+,([\w$]+)=[^)]+\)\{/.exec(src.slice(fnStart, fnStart + 80))
  if (!m) throw new Error('spring signature not recognised near ' + fnStart)
  const bodyIdx = fnStart + m[0].length
  return { scriptId: s.scriptId, url: s.url, hash: s.hash, sourceMapURL: s.sourceMapURL || null, source: src, hits, fnName: m[1], optParam: m[2], fnStart, bodyIdx, ...lineCol(src, bodyIdx), scriptsSeen: scripts.length, elapsedMs }
}

export const fmt = e => `${e.durationMs} ms, overshoot ${e.overshootPx} px (peak at ${e.peakAtMs} ms), ${e.frames} frames, ${e.from} -> ${e.to}`
