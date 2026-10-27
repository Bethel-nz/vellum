import { chmodSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import manifest from '../assets/agent-browser/manifest.json'

export async function prepareAgentBrowser(target: { platform: string; arch: string }) {
  const key = `${target.platform}-${target.arch}` as keyof typeof manifest.targets
  const pin = manifest.targets[key]
  if (!pin) throw new Error(`No verified agent-browser release for ${key}`)
  const file = path.resolve(import.meta.dir, '../dist/helpers', target.platform === 'win32' ? 'agent-browser.exe' : 'agent-browser')
  let bytes = await Bun.file(file).exists() ? await Bun.file(file).bytes() : undefined
  if (!bytes || new Bun.CryptoHasher('sha256').update(bytes).digest('hex') !== pin.sha256) {
    const response = await fetch(pin.url)
    if (!response.ok) throw new Error(`agent-browser download failed (${response.status})`)
    bytes = new Uint8Array(await response.arrayBuffer())
  }
  if (new Bun.CryptoHasher('sha256').update(bytes).digest('hex') !== pin.sha256) throw new Error('agent-browser checksum mismatch')
  mkdirSync(path.dirname(file), { recursive: true })
  await Bun.write(file, bytes)
  chmodSync(file, 0o755)
  await Bun.write(`${file}.manifest.json`, JSON.stringify({ version: manifest.version, target: key, ...pin }))
  await Bun.write(`${file}.LICENSE`, Bun.file(path.resolve(import.meta.dir, '../assets/agent-browser/LICENSE')))
  return { path: file, version: manifest.version, sha256: pin.sha256 }
}
