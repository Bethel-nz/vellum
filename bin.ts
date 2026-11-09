// The compiled Vellum binary's entry (scripts/build-app.ts): one executable for the app and its
// helpers, picked by its first argument:
//
//   Vellum                the app
//   Vellum --agent        the Claude ACP adapter (core/agents.ts)
//   Vellum --agent codex  the Codex ACP adapter
//   Vellum --termd SOCK   the terminal holder (core/termd.ts)
//   Vellum --run FILE     a script from disk: the fake agents checks swap in with VELLUM_AGENT
//
// macOS on Apple silicon only, for now.

import { existsSync } from 'node:fs'
import path from 'node:path'
import { compiled, loginShellPath } from './core/platform'

if (compiled) {
  const addon = path.join(path.dirname(process.execPath), 'helpers', 'gpuix-native.node')
  if (!existsSync(addon)) throw new Error(`Missing GPUIX native addon: ${addon}`)
  process.env.NAPI_RS_NATIVE_LIBRARY_PATH ??= addon
}
const [part, arg] = process.argv.slice(2)
if (part === '--agent' && arg === 'codex') await import('@agentclientprotocol/codex-acp/dist/index.js')
else if (part === '--agent') await import('@agentclientprotocol/claude-agent-acp/dist/index.js')
else if (part === '--termd') await (await import('./core/termd')).serve(arg!)
else if (part === '--run') await import(arg!)
else if (part === '--browser') await (await import('./scripts/browser')).runBrowser(process.argv.slice(3))
else {
  if (!process.env.TERM) process.env.PATH = loginShellPath() ?? process.env.PATH
  await import('./app')
}
