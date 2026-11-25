// Registers Vellum's native messaging host with every Chromium browser on this machine, so Snapshot
// reaches the app without a port. Rewritten on each start, so it follows the app when it moves.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { extensionId } from './capture'
import { nativeHost } from './native-protocol'
import { compiled } from './platform'
import { paths } from './store'

type Browser = [name: string, dir: string]
const support = (base: string, list: Browser[]) => list.map(([name, dir]): Browser => [name, path.join(homedir(), base, dir)])
const browsers: Partial<Record<NodeJS.Platform, Browser[]>> = {
  darwin: support('Library/Application Support', [['Chrome', 'Google/Chrome'], ['Chrome Beta', 'Google/Chrome Beta'], ['Chrome Dev', 'Google/Chrome Dev'], ['Chrome Canary', 'Google/Chrome Canary'], ['Chrome for Testing', 'Google/Chrome for Testing'], ['Chromium', 'Chromium'], ['Brave', 'BraveSoftware/Brave-Browser'], ['Edge', 'Microsoft Edge'], ['Vivaldi', 'Vivaldi'], ['Arc', 'Arc/User Data'], ['Dia', 'Dia/User Data']]),
  linux: support('.config', [['Chrome', 'google-chrome'], ['Chrome Beta', 'google-chrome-beta'], ['Chrome Dev', 'google-chrome-unstable'], ['Chromium', 'chromium'], ['Brave', 'BraveSoftware/Brave-Browser'], ['Edge', 'microsoft-edge'], ['Vivaldi', 'vivaldi']]),
}
const registry: Browser[] = [['Chrome', 'Google\\Chrome'], ['Chromium', 'Chromium'], ['Brave', 'BraveSoftware\\Brave-Browser'], ['Edge', 'Microsoft\\Edge'], ['Vivaldi', 'Vivaldi']]

const write = (file: string, text: string, mode = 0o644) => {
  if (!existsSync(file) || readFileSync(file, 'utf8') !== text) writeFileSync(file, text, { mode })
  chmodSync(file, mode)
}

/** The browsers the host is registered with. Empty for scratch homes. */
export function installNativeHost(): string[] {
  // Checks run on scratch homes; they must never repoint your browsers at one.
  if (process.env.VELLUM_HOME) return []
  const windows = process.platform === 'win32'
  const dir = path.join(paths.home, 'native-host')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  // Chrome passes the caller's origin as the first argument; bin.ts routes it to core/native-host.ts.
  const command = compiled ? [process.execPath] : [process.execPath, path.resolve(import.meta.dir, '../bin.ts')]
  const launcher = path.join(dir, windows ? 'vellum-native-host.bat' : 'vellum-native-host')
  write(launcher, windows ? `@echo off\r\n${command.map((part) => `"${part}"`).join(' ')} %*\r\n` : `#!/bin/sh\nexec ${command.map((part) => `'${part.replaceAll("'", `'\\''`)}'`).join(' ')} "$@"\n`, 0o755)
  const manifest = `${JSON.stringify({ name: nativeHost, description: 'Vellum', path: launcher, type: 'stdio', allowed_origins: [`chrome-extension://${extensionId}/`] }, null, 2)}\n`
  if (windows) {
    const file = path.join(dir, `${nativeHost}.json`)
    write(file, manifest)
    for (const [, key] of registry) Bun.spawn(['reg', 'add', `HKCU\\Software\\${key}\\NativeMessagingHosts\\${nativeHost}`, '/ve', '/t', 'REG_SZ', '/d', file, '/f'], { stdout: 'ignore', stderr: 'ignore', windowsHide: true })
    return registry.map(([name]) => name)
  }
  const installed: string[] = []
  for (const [name, browser] of browsers[process.platform] ?? []) {
    if (!existsSync(browser)) continue
    const hosts = path.join(browser, 'NativeMessagingHosts')
    mkdirSync(hosts, { recursive: true })
    write(path.join(hosts, `${nativeHost}.json`), manifest)
    installed.push(name)
  }
  return installed
}
