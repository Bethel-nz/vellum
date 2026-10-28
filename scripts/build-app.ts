// Builds Vellum.app: bin.ts compiled into one executable (dist/Vellum), assets/icon.png turned
// into an .icns, and cargo-packager wrapping both in a bundle (packager.json), signed ad hoc.
// macOS only; needs cargo-packager (`cargo install cargo-packager --locked`).
//   bun scripts/build-app.ts      → dist/bundle/Vellum.app
import { homedir } from 'node:os'
import { cpSync } from 'node:fs'
import path from 'node:path'
import pkg from '../package.json'
import config from '../packager.json'
import { remove } from './scratch'
import { prepareNotificationHelper } from './notification-helper'
import { prepareAgentBrowser } from './agent-browser-runtime'

const root = path.resolve(import.meta.dir, '..')
const dist = path.join(root, 'dist')
if (config.version !== pkg.version) throw new Error(`packager.json says ${config.version}, package.json ${pkg.version}`)

const run = (argv: string[]) => {
  const r = Bun.spawnSync(argv, { cwd: root, stdout: 'inherit', stderr: 'inherit', env: { ...process.env, PATH: `${process.env.PATH}:${homedir()}/.cargo/bin` } })
  if (r.exitCode !== 0) throw new Error(`${argv.join(' ')} exited with ${r.exitCode}`)
}

// libghostty-vt-node reads its wasm from beside its own file, which a bundle has no notion of:
// import it as a file instead, so the binary carries it.
const ghosttyWasm: import('bun').BunPlugin = {
  name: 'ghostty-wasm',
  setup(build) {
    build.onLoad({ filter: /libghostty-vt-node\/dist\/module\.js$/ }, async ({ path: file }) => {
      const source = await Bun.file(file).text()
      const out = source.replace('new URL("../wasm/ghostty-vt.wasm", import.meta.url)', 'wasmFile')
      if (out === source) throw new Error('libghostty-vt-node no longer loads its wasm the way this expects')
      return { contents: `import wasmFile from "../wasm/ghostty-vt.wasm" with { type: "file" };\n${out}`, loader: 'js' }
    })
  },
}

console.log('compiling dist/Vellum')
const built = await Bun.build({
  entrypoints: [path.join(root, 'bin.ts')],
  compile: { outfile: path.join(dist, 'Vellum') },
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [ghosttyWasm],
})
if (!built.success) throw new AggregateError(built.logs, 'bun build failed')

const helpers = path.join(dist, 'helpers')
await prepareAgentBrowser({ platform: process.platform, arch: process.arch })
await prepareNotificationHelper(path.join(helpers, 'Vellum Notifications.app'))
await Bun.write(path.join(helpers, 'browser'), Bun.file(path.join(root, 'bin/browser')))
await Bun.$`chmod 755 ${path.join(helpers, 'browser')}`.quiet()
await Bun.write(path.join(helpers, 'vellum-mcp.ts'), Bun.file(path.join(root, 'scripts/vellum-mcp.ts')))
// The simulator addon loads its native binary and three helpers beside its CommonJS entry.
const simulatorPackage = path.dirname(Bun.resolveSync('simdriver', root))
await remove(path.join(helpers, 'simdriver'))
cpSync(simulatorPackage, path.join(helpers, 'simdriver'), { recursive: true })

console.log('making dist/AppIcon.icns')
const iconset = path.join(dist, 'AppIcon.iconset')
await remove(iconset)
await Bun.$`mkdir -p ${iconset}`.quiet()
for (const size of [16, 32, 128, 256, 512]) {
  for (const [scale, suffix] of [[1, ''], [2, '@2x']] as const) {
    run(['sips', '-z', String(size * scale), String(size * scale), 'assets/icon.png', '--out', path.join(iconset, `icon_${size}x${size}${suffix}.png`)])
  }
}
run(['iconutil', '-c', 'icns', iconset, '-o', path.join(dist, 'AppIcon.icns')])

console.log('bundling dist/bundle/Vellum.app')
await remove(path.join(dist, 'bundle', 'Vellum.app'))
run(['cargo', 'packager', '--release', '--config', 'packager.json'])
const bundledHelpers = path.join(dist, 'bundle/Vellum.app/Contents/MacOS/helpers')
cpSync(path.join(helpers, 'Vellum Notifications.app'), path.join(bundledHelpers, 'Vellum Notifications.app'), { recursive: true })
for (const file of ['browser', 'vellum-mcp.ts', 'agent-browser', 'agent-browser.manifest.json', 'agent-browser.LICENSE']) await Bun.write(path.join(bundledHelpers, file), Bun.file(path.join(helpers, file)))
cpSync(path.join(helpers, 'simdriver'), path.join(bundledHelpers, 'simdriver'), { recursive: true })
await Bun.$`chmod 755 ${path.join(bundledHelpers, 'browser')} ${path.join(bundledHelpers, 'agent-browser')}`.quiet()
// Ad hoc: enough to open on this Mac. Handing it to someone else needs a Developer ID and notarizing.
run(['codesign', '--force', '--deep', '--sign', '-', path.join(dist, 'bundle', 'Vellum.app')])
console.log('dist/bundle/Vellum.app')
