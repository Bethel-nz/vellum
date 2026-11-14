// Windows agent fixture: reports whether its process owns a visible console, then answers status or ACP.
import { dlopen, FFIType } from 'bun:ffi'
import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const kernel = dlopen('kernel32.dll', { GetConsoleWindow: { args: [], returns: FFIType.ptr } })
const user = dlopen('user32.dll', { IsWindowVisible: { args: [FFIType.ptr], returns: FFIType.i32 } })
const hwnd = kernel.symbols.GetConsoleWindow()
const visible = Boolean(hwnd && user.symbols.IsWindowVisible(hwnd))
appendFileSync(process.env.FAKE_AGENT_CONSOLE_LOG!, JSON.stringify({ args: process.argv.slice(2), hasConsole: Boolean(hwnd), visible }) + '\n')
kernel.close()
user.close()

const args = process.argv.slice(2)
if (args.includes('logout')) process.exit(0)
if (args.includes('status')) {
  console.log(args[0] === 'login' ? 'Logged in using ChatGPT' : JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', subscriptionType: 'max' }))
  process.exit(0)
}
if (args.includes('list')) {
  console.log(JSON.stringify([{ id: 'fixture', connections: [{ type: 'credential' }] }]))
  process.exit(0)
}
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line)
  console.log(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { authMethods: [{ id: 'fixture', name: 'Fixture', type: 'terminal', args: ['login'] }] } }))
}
