// Check the distributable extension without opening Chrome or touching agent accounts.
import path from 'node:path'
import { createHash } from 'node:crypto'

const root = path.resolve(import.meta.dir, '..')
const dist = path.resolve(process.argv[2] ?? path.join(root, 'extension/dist'))
const manifest = await Bun.file(path.join(dist, 'manifest.json')).json()
const pkg = await Bun.file(path.join(root, 'package.json')).json()
const identity = await Bun.file(path.join(root, 'extension/identity.json')).json()
if (manifest.manifest_version !== 3) throw new Error('Expected a Manifest V3 extension')
if (manifest.version !== pkg.version.split(/[-+]/)[0]) throw new Error('Extension version does not match Vellum')
const id = [...createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32)].map((char) => String.fromCharCode(97 + parseInt(char, 16))).join('')
if (manifest.key !== identity.key || id !== identity.id) throw new Error('Extension identity changed; desktop pairing would fail')
const files = new Set<string>([
  'content.js', 'INSTALL.txt', manifest.background.service_worker,
  ...Object.values(manifest.icons) as string[],
  ...(manifest.action?.default_popup ? [manifest.action.default_popup] : []),
  ...(manifest.content_scripts ?? []).flatMap((script: { js?: string[]; css?: string[] }) => [...(script.js ?? []), ...(script.css ?? [])]),
])
for (const name of files) {
  const file = Bun.file(path.join(dist, name))
  if (!await file.exists() || !file.size) throw new Error(`Missing extension output: ${name}`)
}
console.log(`ok Vellum Snapshot ${manifest.version}: manifest, runtime files, icons, and pairing identity`)
