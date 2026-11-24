// Builds Vellum's executable, helpers, and host bundle: a macOS .app or a Windows NSIS installer.
// Needs cargo-packager; run bun scripts/build-app.ts.
import { homedir } from 'node:os'
import { cpSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import pkg from '../package.json'
import config from '../packager.json'
import windowsConfig from '../packager.windows.json'
import { remove } from './scratch'
import { prepareNotificationHelper } from './notification-helper'
import { prepareAgentBrowser } from './agent-browser-runtime'
import { buildOpener } from '../core/opener'

const root = path.resolve(import.meta.dir, '..')
const dist = path.join(root, 'dist')
if (config.version !== pkg.version) throw new Error(`packager.json says ${config.version}, package.json ${pkg.version}`)
if (windowsConfig.version !== pkg.version) throw new Error(`packager.windows.json says ${windowsConfig.version}, package.json ${pkg.version}`)

const run = (argv: string[]) => {
  const cargoBin = path.join(homedir(), '.cargo', 'bin')
  const r = Bun.spawnSync(argv, { cwd: root, stdout: 'inherit', stderr: 'inherit', env: { ...process.env, PATH: [process.env.PATH, cargoBin].filter(Boolean).join(path.delimiter) } })
  if (r.exitCode !== 0) throw new Error(`${argv.join(' ')} exited with ${r.exitCode}`)
}

// The wasm is imported as a file, so the binary carries it.
const ghosttyWasm: import('bun').BunPlugin = {
  name: 'ghostty-wasm',
  setup(build) {
    build.onLoad({ filter: /libghostty-vt-node[/\\]dist[/\\]module\.js$/ }, async ({ path: file }) => {
      const source = await Bun.file(file).text()
      const out = source.replace('new URL("../wasm/ghostty-vt.wasm", import.meta.url)', 'wasmFile')
      if (out === source) throw new Error('libghostty-vt-node no longer loads its wasm the way this expects')
      return { contents: `import wasmFile from "../wasm/ghostty-vt.wasm" with { type: "file" };\n${out}`, loader: 'js' }
    })
  },
}

// The updater's public key: VELLUM_UPDATE_PUBKEY (a repo variable in CI), else your local key's.
const localPubkey = Bun.file(path.join(homedir(), '.config/vellum/updater.key.pub'))
const updatePubkey = process.env.VELLUM_UPDATE_PUBKEY?.trim() || (await localPubkey.exists() ? (await localPubkey.text()).trim() : '')
if (!updatePubkey) console.log('no VELLUM_UPDATE_PUBKEY: this build will not look for updates')

const executable = path.join(dist, process.platform === 'win32' ? 'Vellum.exe' : 'Vellum')
console.log(`compiling ${path.relative(root, executable)}`)
const built = await Bun.build({
  entrypoints: [path.join(root, 'bin.ts')],
  compile: { outfile: executable, ...(process.platform === 'win32' ? { windows: { hideConsole: true } } : {}) },
  define: { 'process.env.NODE_ENV': '"production"', 'process.env.VELLUM_UPDATE_PUBKEY': JSON.stringify(updatePubkey) },
  plugins: [ghosttyWasm],
})
if (!built.success) throw new AggregateError(built.logs, 'bun build failed')

const helpers = path.join(dist, 'helpers')
mkdirSync(helpers, { recursive: true })
const nativePackage = process.platform === 'darwin' && process.arch === 'arm64'
  ? '@gpuix/native-darwin-arm64'
  : process.platform === 'win32' && process.arch === 'x64'
    ? '@gpuix/native-win32-x64-msvc'
    : process.platform === 'win32' && process.arch === 'arm64'
      ? '@gpuix/native-win32-arm64-msvc'
      : process.platform === 'linux' && process.arch === 'x64'
        ? '@gpuix/native-linux-x64-gnu'
        : undefined
if (!nativePackage) throw new Error(`No GPUIX native addon for ${process.platform}-${process.arch}`)
await Bun.write(path.join(helpers, 'gpuix-native.node'), Bun.file(Bun.resolveSync(nativePackage, root)))
await prepareAgentBrowser({ platform: process.platform, arch: process.arch })
await Bun.write(path.join(helpers, 'vellum-mcp.ts'), Bun.file(path.join(root, 'scripts/vellum-mcp.ts')))
if (process.platform === 'win32') {
  await Bun.write(path.join(helpers, 'browser.cmd'), '@echo off\r\n"%VELLUM_EXEC_PATH%" --browser %*\r\n')
  run(['cargo', 'packager', '--release', '--config', 'packager.windows.json'])
  console.log(path.relative(root, executable))
  console.log(path.relative(root, path.join(dist, 'bundle')))
  process.exit(0)
}
await prepareNotificationHelper(path.join(helpers, 'Vellum Notifications.app'))
await Bun.write(path.join(helpers, 'browser'), Bun.file(path.join(root, 'bin/browser')))
await Bun.$`chmod 755 ${path.join(helpers, 'browser')}`.quiet()
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
await buildOpener(path.join(helpers, 'Vellum Opener.app'), { appId: config.identifier, icon: path.join(dist, 'AppIcon.icns') })

console.log('bundling dist/bundle/Vellum.app')
await remove(path.join(dist, 'bundle', 'Vellum.app'))
run(['cargo', 'packager', '--release', '--config', 'packager.json'])
const bundledHelpers = path.join(dist, 'bundle/Vellum.app/Contents/MacOS/helpers')
cpSync(path.join(helpers, 'Vellum Notifications.app'), path.join(bundledHelpers, 'Vellum Notifications.app'), { recursive: true })
cpSync(path.join(helpers, 'Vellum Opener.app'), path.join(bundledHelpers, 'Vellum Opener.app'), { recursive: true })
for (const file of ['gpuix-native.node', 'browser', 'vellum-mcp.ts', 'agent-browser', 'agent-browser.manifest.json', 'agent-browser.LICENSE']) await Bun.write(path.join(bundledHelpers, file), Bun.file(path.join(helpers, file)))
cpSync(path.join(helpers, 'simdriver'), path.join(bundledHelpers, 'simdriver'), { recursive: true })
cpSync(path.join(helpers, 'agent-browser-skills'), path.join(bundledHelpers, 'agent-browser-skills'), { recursive: true })
await Bun.$`chmod 755 ${path.join(bundledHelpers, 'browser')} ${path.join(bundledHelpers, 'agent-browser')}`.quiet()
// Ad hoc: enough to open on this Mac. Handing it to someone else needs a Developer ID and notarizing.
run(['codesign', '--force', '--deep', '--sign', '-', path.join(dist, 'bundle', 'Vellum.app')])
console.log('dist/bundle/Vellum.app')

// The updater's download: the signed bundle under one top-level Vellum.app/, no AppleDouble files.
// Packed here, after the helpers and codesign, because cargo-packager's own tarball predates both.
const tarball = path.join(dist, 'bundle', 'Vellum.app.tar.gz')
await remove(tarball)
await remove(`${tarball}.sig`)
await Bun.$`tar -czf ${tarball} -C ${path.join(dist, 'bundle')} Vellum.app`.env({ ...process.env, COPYFILE_DISABLE: '1' }).quiet()
if (process.env.CARGO_PACKAGER_SIGN_PRIVATE_KEY) run(['cargo', 'packager', 'signer', 'sign', tarball])
else console.log('no CARGO_PACKAGER_SIGN_PRIVATE_KEY: the update tarball is unsigned, so installed apps will not take it')
console.log(path.relative(root, tarball))

// The download people install from: the app beside an Applications link to drag it onto.
const staging = path.join(dist, 'dmg')
const dmg = path.join(dist, 'bundle', 'Vellum.dmg')
await remove(staging)
await remove(dmg)
mkdirSync(staging, { recursive: true })
run(['ditto', path.join(dist, 'bundle', 'Vellum.app'), path.join(staging, 'Vellum.app')])
await Bun.$`ln -s /Applications ${path.join(staging, 'Applications')}`.quiet()
run(['hdiutil', 'create', '-volname', 'Vellum', '-srcfolder', staging, '-ov', '-format', 'UDZO', dmg])
await remove(staging)
console.log(path.relative(root, dmg))
