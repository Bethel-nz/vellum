import { createHash } from 'node:crypto'
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const bundleId = 'dev.vellum.app.notifications'
/** A separate accessory app gives source runs the same Vellum name/icon as a packaged app. */
export async function prepareNotificationHelper(destination: string) {
  const source = path.resolve(import.meta.dir, '../native/Notifications.swift')
  const icon = await Bun.file(path.resolve(import.meta.dir, '../assets/icon.png')).bytes()
  const digest = createHash('sha256').update(await Bun.file(source).bytes()).update(icon).update(await Bun.file(import.meta.path).bytes()).update(process.arch).digest('hex')
  const executable = path.join(destination, 'Contents/MacOS/VellumNotifications')
  if (await Bun.file(executable).exists() && await Bun.file(path.join(destination, 'Contents/Resources/version')).text().catch(() => '') === digest) return executable
  const temporary = `${destination}.${crypto.randomUUID()}.app`
  const contents = path.join(temporary, 'Contents')
  mkdirSync(path.join(contents, 'MacOS'), { recursive: true, mode: 0o700 })
  mkdirSync(path.join(contents, 'Resources'), { recursive: true, mode: 0o700 })
  try {
    writeFileSync(path.join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${bundleId}</string><key>CFBundleName</key><string>Vellum</string><key>CFBundleDisplayName</key><string>Vellum</string><key>CFBundleExecutable</key><string>VellumNotifications</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string><key>CFBundleIconFile</key><string>AppIcon.icns</string><key>LSUIElement</key><true/><key>NSUserNotificationAlertStyle</key><string>banner</string></dict></plist>`)
    const png = Buffer.from(icon)
    const kind = ({ 128: 'ic07', 256: 'ic08', 512: 'ic09', 1024: 'ic10' } as Record<number, string>)[png.readUInt32BE(16)]
    if (!kind) throw new Error('The notification icon must be a 128, 256, 512 or 1024 pixel PNG')
    const header = Buffer.alloc(16)
    header.write('icns', 0); header.writeUInt32BE(png.length + 16, 4)
    header.write(kind, 8); header.writeUInt32BE(png.length + 8, 12)
    writeFileSync(path.join(contents, 'Resources/AppIcon.icns'), Buffer.concat([header, png]))
    const run = async (args: string[]) => {
      const child = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe', timeout: 60_000 })
      const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text()])
      if (code !== 0) throw new Error(error.trim() || `${args[0]} failed`)
    }
    await run(['/usr/bin/xcrun', 'swiftc', source, '-o', path.join(contents, 'MacOS/VellumNotifications'), '-framework', 'AppKit', '-framework', 'UserNotifications', '-framework', 'CoreServices'])
    writeFileSync(path.join(contents, 'Resources/version'), digest)
    await run(['/usr/bin/codesign', '--force', '--sign', '-', temporary])
    rmSync(destination, { recursive: true, force: true })
    renameSync(temporary, destination)
    return executable
  } catch (error) { rmSync(temporary, { recursive: true, force: true }); throw error }
}
