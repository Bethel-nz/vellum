#!/usr/bin/env bun
// Test subprocess fixture: speaks the pinned CLI's JSON contract, never starts Chrome.
import { appendFileSync } from 'node:fs'
import path from 'node:path'
const argv = process.argv.slice(2), configIndex = argv.indexOf('--config')
const config = JSON.parse(await Bun.file(argv[configIndex + 1]!).text())
const args = argv.slice(configIndex + 2).filter(arg => arg !== '--json')
const log = process.env.VELLUM_BROWSER_FIXTURE_LOG
if (log) appendFileSync(log, JSON.stringify({ args, at: Date.now(), event: 'start' }) + '\n')
let data: any = {}
let exitCode = 0
if (args[0] === 'session' && args[1] === 'info') data = { active: true, pid: 12345 }
else if (args[0] === 'stream') data = { enabled: true, port: Number(process.env.VELLUM_BROWSER_FIXTURE_PORT || 49123) }
else if (args[0] === 'get') data = { url: 'https://example.com' }
else if (args[0] === 'wait') await Bun.sleep(Number(args[1]) || 150)
else if (args[0] === 'screenshot') { const file = args[1] || path.join(config.screenshotDir, 'fixture.png'); await Bun.write(file, Bun.file(path.resolve(import.meta.dir, '../assets/icon.png'))); data = { path: file } }
else if (args[0] === 'fail' || process.env.VELLUM_BROWSER_FIXTURE_FAIL === '1') { exitCode = 1; data = null }
if (log) appendFileSync(log, JSON.stringify({ args, at: Date.now(), event: 'end' }) + '\n')
console.log(JSON.stringify({ success: !exitCode, data, ...(exitCode ? { error: 'fixture action failed' } : {}) }))
process.exitCode = exitCode
