// The compiled Vellum binary's entry (scripts/build-app.ts). From source, `bun app.tsx` runs the
// app and Bun runs its helpers; a compiled binary has no Bun beside it, so the one executable is
// all of them, picked by its first argument:
//
//   Vellum                the app
//   Vellum --agent        the Claude ACP adapter (core/agent.ts)
//   Vellum --termd SOCK   the terminal holder (core/termd.ts)
//   Vellum --run FILE     a script from disk: the fake agents checks swap in with VELLUM_AGENT
//
// The GPUIX addon rides along as a file; napi-rs's override variable points its loader there,
// since by itself it looks in node_modules. macOS on Apple silicon only, for now.

import addon from '@gpuix/native-darwin-arm64/gpuix-native.darwin-arm64.node' with { type: 'file' }
import { loginShellPath } from './core/platform'

process.env.NAPI_RS_NATIVE_LIBRARY_PATH ??= addon
const [part, arg] = process.argv.slice(2)
if (part === '--agent') await import('@agentclientprotocol/claude-agent-acp/dist/index.js')
else if (part === '--termd') await (await import('./core/termd')).serve(arg!)
else if (part === '--run') await import(arg!)
else {
  // Opened from Finder or the Dock there's no terminal behind it, and launchd's PATH finds no `claude`.
  if (!process.env.TERM) process.env.PATH = loginShellPath() ?? process.env.PATH
  await import('./app')
}
