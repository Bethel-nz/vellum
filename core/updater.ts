// Updates from GitHub Releases through GPUIX's updater (cargo-packager format, signed .sig beside each asset).
import path from 'node:path'
import { checkUpdate, type AvailableUpdate } from '@gpuix/native'
import pkg from '../package.json'
import { compiled } from './platform'

/** The updater's public key, baked in at build time (scripts/build-app.ts); updates stay off without it. */
export const UPDATE_PUBKEY = process.env.VELLUM_UPDATE_PUBKEY ?? ''
const FEED = 'https://github.com/Bethel-nz/vellum/releases/latest'

export type PendingUpdate = { version: string; ready: boolean; apply: () => Promise<void> }

/**
 * The newer release, if any. On macOS it is downloaded and swapped in at once, so a restart
 * picks it up. On Windows installing quits Vellum, so it waits for `apply`.
 */
export async function findUpdate(): Promise<PendingUpdate | null> {
  if (!compiled || !UPDATE_PUBKEY || !['darwin', 'win32'].includes(process.platform)) return null
  let update: AvailableUpdate | null
  try {
    update = await checkUpdate(pkg.version, { endpoints: [FEED], pubkey: UPDATE_PUBKEY, timeoutMs: 15_000 })
  } catch {
    return null
  }
  if (!update) return null
  const found = update
  if (process.platform === 'win32') return { version: found.version, ready: false, apply: async () => { await found.downloadAndInstall() } }
  try {
    await found.downloadAndInstall()
    reseal()
  } catch {
    return null
  }
  return { version: found.version, ready: true, apply: async () => relaunch() }
}

const bundle = () => path.resolve(path.dirname(process.execPath), '../..')

/**
 * The tarball drops the xattrs that hold the signatures of non-code files in Contents/MacOS,
 * so the swapped-in bundle is sealed again, ad hoc like the build (scripts/build-app.ts).
 */
function reseal() {
  const r = Bun.spawnSync(['/usr/bin/codesign', '--force', '--deep', '--sign', '-', bundle()], { stdout: 'ignore', stderr: 'pipe' })
  if (r.exitCode !== 0) throw new Error(`codesign: ${r.stderr.toString().trim()}`)
}

/** Opens the swapped-in bundle as a new instance, then quits this one. */
function relaunch() {
  Bun.spawn(['open', '-n', bundle()], { stdout: 'ignore', stderr: 'ignore' })
  setTimeout(() => process.exit(0), 300)
}
