import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import manifest from '../assets/agent-browser/manifest.json'
import { compiled } from './platform'

export const helperDir = () => compiled ? path.join(path.dirname(process.execPath), 'helpers') : path.resolve(import.meta.dir, '../bin')
export function browserExecutable(): string {
  const name = process.platform === 'win32' ? 'agent-browser.exe' : 'agent-browser'
  const bundled = path.join(helperDir(), name)
  if (compiled) {
    if (!existsSync(bundled)) throw new Error('The bundled browser helper is missing. Reinstall Vellum.')
    return bundled
  }
  if (process.env.VELLUM_BROWSER_EXECUTABLE) return path.resolve(process.env.VELLUM_BROWSER_EXECUTABLE)
  const target = `${process.platform}-${process.arch}` as keyof typeof manifest.targets
  const pin = manifest.targets[target]
  // Development resolves an installed native binary once, then verifies the official release digest.
  const wrapper = Bun.which('agent-browser')
  const candidates = [bundled, path.resolve(import.meta.dir, '../dist/helpers', name), wrapper, wrapper && path.resolve(path.dirname(wrapper), '../lib/node_modules/agent-browser/bin', `agent-browser-${target}`), process.platform === 'darwin' && `/opt/homebrew/Cellar/agent-browser/${manifest.version}/libexec/lib/node_modules/agent-browser/bin/agent-browser-${target}`].filter((p): p is string => Boolean(p))
  for (const candidate of candidates) {
    if (pin && existsSync(candidate) && new Bun.CryptoHasher('sha256').update(readFileSync(candidate)).digest('hex') === pin.sha256) return candidate
  }
  throw new Error('agent-browser 0.39.1 is required. Set VELLUM_BROWSER_EXECUTABLE to an explicit development binary or package the pinned helper.')
}
export { stopBrowserSession as closeBrowser, closeAllBrowserSessions as closeAllBrowsers } from './browser-runtime'
