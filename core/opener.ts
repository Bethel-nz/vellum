// Files the OS opens with Vellum land in ~/.vellum/inbox. macOS hands them to a small AppleScript
// app (GPUIX drops the open-documents event); Windows passes them as arguments to a new Vellum.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, watch, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { helperDir } from './browser'
import { compiled, os } from './platform'
import { paths, readSettings, updateSettings } from './store'

export const inbox = () => path.join(paths.home, 'inbox')

const script = (inboxDir: string | undefined, appId: string) => `
on open theItems
  set inbox to ${inboxDir ? `"${inboxDir}"` : '(POSIX path of (path to home folder)) & ".vellum/inbox"'}
  do shell script "mkdir -p " & quoted form of inbox
  repeat with f in theItems
    do shell script "printf %s " & quoted form of (POSIX path of f) & " > " & quoted form of (inbox & "/" & (do shell script "uuidgen") & ".open")
  end repeat
  try
    do shell script "open -b ${appId}"
  end try
end open
on run
  try
    do shell script "open -b ${appId}"
  end try
end run
`

const documentTypes = [
  { CFBundleTypeName: 'Vellum note', CFBundleTypeRole: 'Editor', LSHandlerRank: 'Owner', LSItemContentTypes: ['dev.vellum.note'] },
  { CFBundleTypeName: 'Text', CFBundleTypeRole: 'Viewer', LSHandlerRank: 'Alternate', LSItemContentTypes: ['public.plain-text', 'public.source-code', 'net.daringfireball.markdown', 'public.json'] },
]
const noteType = [{ UTTypeIdentifier: 'dev.vellum.note', UTTypeDescription: 'Vellum note', UTTypeConformsTo: ['public.data', 'public.content'], UTTypeTagSpecification: { 'public.filename-extension': ['vel'] } }]

/** Builds the opener app at `out`, named Vellum, for `appId`; `inboxDir` defaults to ~/.vellum/inbox. */
export async function buildOpener(out: string, opts: { appId: string; icon?: string; inboxDir?: string }) {
  rmSync(out, { recursive: true, force: true })
  const source = path.join(path.dirname(out), 'opener.applescript')
  await Bun.write(source, script(opts.inboxDir, opts.appId))
  await Bun.$`osacompile -o ${out} ${source}`.quiet()
  rmSync(source)
  const plist = path.join(out, 'Contents', 'Info.plist')
  const set = (key: string, value: unknown) => Bun.$`plutil -replace ${key} -json ${JSON.stringify(value)} ${plist}`.quiet()
  await set('CFBundleIdentifier', `${opts.appId}.opener`)
  await set('CFBundleName', 'Vellum')
  await set('LSUIElement', true)
  await set('CFBundleDocumentTypes', documentTypes)
  await set('UTExportedTypeDeclarations', noteType)
  if (opts.icon) await Bun.write(path.join(out, 'Contents', 'Resources', 'applet.icns'), Bun.file(opts.icon))
}

/** Tells LaunchServices about the opener, so Finder offers it; a new copy needs this once. */
export async function registerOpener(app: string) {
  const ls = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
  await Bun.$`${ls} -f ${app}`.quiet().nothrow()
}

/** Every path waiting in the inbox, oldest first, taken out of it. */
export function takeInbox(): string[] {
  const dir = inbox()
  let names: string[]
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.open')).sort()
  } catch {
    return []
  }
  return names.flatMap((name) => {
    const file = path.join(dir, name)
    const text = readFileSync(file, 'utf8').trim()
    rmSync(file, { force: true })
    return text ? [text] : []
  })
}

const pidFile = () => path.join(paths.home, 'run', 'app.pid')

/** Files named on the command line, as Windows and Linux open documents. */
export const fileArgs = (argv: string[]) => argv.filter((a) => !a.startsWith('-') && existsSync(a) && statSync(a).isFile()).map((a) => path.resolve(a))

function running(): boolean {
  try {
    const pid = Number(readFileSync(pidFile(), 'utf8'))
    if (!pid || pid === process.pid || Date.now() - statSync(pidFile()).mtimeMs > 15_000) return false
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Leaves `files` in the inbox; true when a running Vellum will take them, so this launch can quit. */
export function handOff(files: string[]): boolean {
  mkdirSync(inbox(), { recursive: true })
  files.forEach((f, i) => writeFileSync(path.join(inbox(), `${Date.now()}-${String(i).padStart(4, '0')}-${randomUUID()}.open`), f, { flag: 'wx' }))
  return files.length > 0 && running()
}

/** Calls `onPaths` for what's waiting now and for every file opened later; returns a stop. */
export function watchInbox(onPaths: (files: string[]) => void): () => void {
  mkdirSync(path.dirname(pidFile()), { recursive: true })
  writeFileSync(pidFile(), String(process.pid))
  const beat = setInterval(() => utimesSync(pidFile(), new Date(), new Date()), 5000)
  mkdirSync(inbox(), { recursive: true })
  const drain = () => {
    const files = takeInbox()
    if (files.length) onPaths(files)
  }
  drain()
  const watcher = watch(inbox(), () => setTimeout(drain, 50))
  return () => {
    clearInterval(beat)
    watcher.close()
  }
}

const reg = (key: string, value: string, name?: string, type?: string) => Bun.$`reg add ${key} ${name === undefined ? '/ve' : ['/v', name]} ${type ? ['/t', type] : []} /d ${value} /f`.quiet()

/** Windows: register Vellum for Open with and Default Apps; the user chooses its defaults. */
async function registerWindows(exe: string) {
  const open = `"${exe}" "%1"`
  await reg('HKCU\\Software\\Classes\\Vellum.Note', 'Vellum note')
  await reg('HKCU\\Software\\Classes\\Vellum.Note\\DefaultIcon', `"${exe}",0`)
  await reg('HKCU\\Software\\Classes\\Vellum.Note\\shell\\open\\command', open)
  await reg('HKCU\\Software\\Classes\\Applications\\Vellum.exe\\shell\\open\\command', open)
  const extensions = ['.vel', '.txt', '.md', '.json', '.log']
  for (const ext of extensions) {
    await reg(`HKCU\\Software\\Classes\\${ext}\\OpenWithProgids`, '', 'Vellum.Note', 'REG_SZ')
    await reg('HKCU\\Software\\Classes\\Applications\\Vellum.exe\\SupportedTypes', '', ext, 'REG_SZ')
  }
  const capabilities = 'Software\\Vellum\\Capabilities'
  await reg(`HKCU\\${capabilities}`, 'Vellum', 'ApplicationName')
  await reg(`HKCU\\${capabilities}`, 'Open text notes and files with Vellum', 'ApplicationDescription')
  for (const ext of extensions) await reg(`HKCU\\${capabilities}\\FileAssociations`, 'Vellum.Note', ext)
  await reg('HKCU\\Software\\RegisteredApplications', capabilities, 'Vellum')
}

/** Once per install: tells the OS which files Vellum opens. Only the built app, never a dev run. */
export async function registerFileTypes() {
  const key = `${os}:${process.execPath}`
  if (!compiled || readSettings().fileTypes === key) return
  if (os === 'mac') await registerOpener(path.join(helperDir(), 'Vellum Opener.app'))
  else if (os === 'windows') await registerWindows(process.execPath)
  else return
  updateSettings({ fileTypes: key })
}
