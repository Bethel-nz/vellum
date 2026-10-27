// The Dock icon while Vellum runs from `bun app.tsx`: macOS would show Bun's (or a blank) icon,
// because only a .app bundle names one. AppKit's setApplicationIconImage swaps it at runtime, the
// way Electron's app.dock.setIcon does, called through bun:ffi since GPUIX has no option for it.
// macOS only, main thread only; anywhere else it does nothing.

import { dlopen, FFIType, ptr } from 'bun:ffi'

const cstr = (s: string) => ptr(Buffer.from(s + '\0', 'utf8'))

/** Show `png` (or any image AppKit reads) as the Dock icon. Returns whether it took. */
export function setDockIcon(png: string): boolean {
  if (process.platform !== 'darwin' || Bun.file(png).size === 0) return false
  try {
    const main = dlopen('/usr/lib/libSystem.B.dylib', { pthread_main_np: { args: [], returns: FFIType.i32 } })
    if (main.symbols.pthread_main_np() !== 1) return false
    const lib = '/usr/lib/libobjc.A.dylib'
    const base = dlopen(lib, {
      objc_getClass: { args: [FFIType.ptr], returns: FFIType.ptr },
      sel_registerName: { args: [FFIType.ptr], returns: FFIType.ptr },
      objc_msgSend: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
    }).symbols
    // objc_msgSend takes whatever the method does: one binding per shape.
    const send1 = dlopen(lib, { objc_msgSend: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.ptr } }).symbols.objc_msgSend
    const cls = (name: string) => base.objc_getClass(cstr(name))
    const sel = (name: string) => base.sel_registerName(cstr(name))

    const path = send1(cls('NSString'), sel('stringWithUTF8String:'), cstr(png))
    const image = send1(base.objc_msgSend(cls('NSImage'), sel('alloc')), sel('initWithContentsOfFile:'), path)
    if (!image) return false
    const app = base.objc_msgSend(cls('NSApplication'), sel('sharedApplication'))
    send1(app, sel('setApplicationIconImage:'), image)
    return true
  } catch {
    return false
  }
}

/** AppKit fallback for builds without GPUIX window activation callbacks. */
let focusedWindow: (() => boolean) | undefined
export function appIsActive(): boolean {
  if (process.platform !== 'darwin') return true
  try {
    if (focusedWindow) return focusedWindow()
    const lib = '/usr/lib/libobjc.A.dylib'
    const base = dlopen(lib, {
      objc_getClass: { args: [FFIType.ptr], returns: FFIType.ptr },
      sel_registerName: { args: [FFIType.ptr], returns: FFIType.ptr },
      objc_msgSend: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
    }).symbols
    const isActive = dlopen(lib, { objc_msgSend: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.bool } }).symbols.objc_msgSend
    const app = base.objc_msgSend(base.objc_getClass(cstr('NSApplication')), base.sel_registerName(cstr('sharedApplication')))
    const active = base.sel_registerName(cstr('isActive'))
    const key = base.sel_registerName(cstr('keyWindow'))
    const keyWindow = base.sel_registerName(cstr('isKeyWindow'))
    focusedWindow = () => {
      if (!isActive(app, active)) return false
      const window = base.objc_msgSend(app, key)
      return Boolean(window && isActive(window, keyWindow))
    }
    return focusedWindow()
  } catch {
    return false
  }
}

/** Pending requests stay visible on Vellum's Dock icon until they are answered. */
export function setDockBadge(count: number) {
  if (process.platform !== 'darwin' || process.env.GPUIX_BACKGROUND) return
  try {
    const lib = '/usr/lib/libobjc.A.dylib'
    const base = dlopen(lib, {
      objc_getClass: { args: [FFIType.ptr], returns: FFIType.ptr },
      sel_registerName: { args: [FFIType.ptr], returns: FFIType.ptr },
      objc_msgSend: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
    }).symbols
    const send = dlopen(lib, { objc_msgSend: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.ptr } }).symbols.objc_msgSend
    const cls = (name: string) => base.objc_getClass(cstr(name))
    const sel = (name: string) => base.sel_registerName(cstr(name))
    const app = base.objc_msgSend(cls('NSApplication'), sel('sharedApplication'))
    const tile = base.objc_msgSend(app, sel('dockTile'))
    const label = count ? send(cls('NSString'), sel('stringWithUTF8String:'), cstr(String(count))) : null
    send(tile, sel('setBadgeLabel:'), label)
  } catch { /* The inbox remains usable without a Dock badge. */ }
}
