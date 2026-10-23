// Thin binding over the libghostty-vt wasm module that libghostty-vt-node ships.
//
// libghostty-vt-node only wraps feed/format, but the same wasm exports the whole
// C API. We reuse its loader (VtModule: memory, ABI manifest, opaque slots) and
// bind the parts a renderer needs: render state (per-cell grid), the key encoder,
// and the write_pty effect for replies (DA, DSR, CPR...).
//
// Everything here runs on the main JS thread only; libghostty-vt is not thread-safe.

import { VtModule } from '../node_modules/libghostty-vt-node/dist/module.js'

type Mod = VtModule & { exports: Record<string, any>; manifest: any }

let mod: Mod | undefined
function vt(): Mod {
  return (mod ??= VtModule.load() as Mod)
}

const enc = new TextEncoder()
const dec = new TextDecoder()

// ---------------------------------------------------------------- write_pty effect

// C callbacks in wasm are indices into the module's function table, and a table
// only holds wasm functions. So we compile a 4-instruction wasm shim that imports
// one JS function and re-exports it with the C signature
// (terminal, userdata, data_ptr, len) -> void, and put that in the table.
const writePtyHandlers = new Map<number, (bytes: Uint8Array) => void>()
let writePtyIndex: number | undefined

function writePtyFnIndex(): number {
  if (writePtyIndex !== undefined) return writePtyIndex
  const m = vt()
  const bytes = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    0x01, 0x08, 0x01, 0x60, 0x04, 0x7f, 0x7f, 0x7f, 0x7f, 0x00, // type: (i32 i32 i32 i32) -> ()
    0x02, 0x09, 0x01, 0x03, 0x65, 0x6e, 0x76, 0x01, 0x66, 0x00, 0x00, // import env.f
    0x03, 0x02, 0x01, 0x00, // one function of type 0
    0x07, 0x05, 0x01, 0x01, 0x67, 0x00, 0x01, // export "g" = func 1
    0x0a, 0x0e, 0x01, 0x0c, 0x00, 0x20, 0x00, 0x20, 0x01, 0x20, 0x02, 0x20, 0x03, 0x10, 0x00, 0x0b,
  ])
  const shim = new WebAssembly.Instance(new WebAssembly.Module(bytes), {
    env: {
      f: (_term: number, userdata: number, ptr: number, len: number) => {
        const copy = m.bytes().slice(ptr, ptr + len)
        writePtyHandlers.get(userdata)?.(copy)
      },
    },
  })
  const table: WebAssembly.Table = m.exports.__indirect_function_table
  writePtyIndex = table.grow(1)
  table.set(writePtyIndex, shim.exports.g as any)
  return writePtyIndex
}

// ---------------------------------------------------------------- grid types

/** A cell colour: undefined = terminal default, number = ANSI palette index 0-15, string = '#rrggbb'. */
export type CellColor = undefined | number | string

export type Run = {
  text: string
  fg: CellColor
  bg: CellColor
  bold: boolean
  italic: boolean
  underline: boolean
  inverse: boolean
  faint: boolean
}

export type Grid = {
  cols: number
  rows: Run[][]
  cursor: { row: number; col: number; visible: boolean }
  alternate: boolean
}

const MODS = { shift: 1 << 0, ctrl: 1 << 1, alt: 1 << 2, super: 1 << 3 }

// GPUI key names → GhosttyKey enum names. Printable keys are mapped from the character.
const NAMED_KEYS: Record<string, string> = {
  enter: 'ENTER', return: 'ENTER', tab: 'TAB', backspace: 'BACKSPACE', escape: 'ESCAPE', space: 'SPACE',
  up: 'ARROW_UP', down: 'ARROW_DOWN', left: 'ARROW_LEFT', right: 'ARROW_RIGHT',
  home: 'HOME', end: 'END', pageup: 'PAGE_UP', pagedown: 'PAGE_DOWN', delete: 'DELETE', insert: 'INSERT',
}
const PUNCT_KEYS: Record<string, string> = {
  '-': 'MINUS', '=': 'EQUAL', '[': 'BRACKET_LEFT', ']': 'BRACKET_RIGHT', '\\': 'BACKSLASH',
  ';': 'SEMICOLON', "'": 'QUOTE', ',': 'COMMA', '.': 'PERIOD', '/': 'SLASH', '`': 'BACKQUOTE',
}

function ghosttyKeyName(key: string): string | undefined {
  const k = key.toLowerCase()
  if (NAMED_KEYS[k]) return NAMED_KEYS[k]
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(k)) return k.toUpperCase()
  if (/^[a-z]$/.test(k)) return k.toUpperCase()
  if (/^[0-9]$/.test(k)) return `DIGIT_${k}`
  return PUNCT_KEYS[k]
}

export type KeyInput = {
  key: string
  keyChar?: string
  modifiers?: { shift?: boolean; ctrl?: boolean; alt?: boolean; cmd?: boolean }
}

// ---------------------------------------------------------------- terminal

let nextUserdata = 1

/** Longest grapheme cluster we decode; longer clusters render as U+FFFD instead of overflowing the buffer. */
const MAX_GRAPHEME = 32
const KEY_OUT = 1024

export class VtTerminal {
  #m = vt()
  #term = 0
  #render = 0
  #rows = 0
  #cells = 0
  #encoder = 0
  #event = 0
  #userdata = nextUserdata++
  #handleSlot = 0
  // Dedicated buffers, each sized for what libghostty writes into it.
  #keyOut = 0
  #cursorBuf = 0
  #styleBuf = 0
  #lenBuf = 0
  #cpBuf = 0
  #rgbBuf = 0
  #modeBuf = 0
  cols: number
  rowsCount: number

  constructor(cols: number, rows: number, onReply: (bytes: Uint8Array) => void) {
    const m = this.#m
    const e = m.exports
    this.cols = cols
    this.rowsCount = rows
    m.check(e.ghostty_terminal_new(0, m.slot, cols, rows), 'terminal_new')
    this.#term = m.takeOpaque()
    m.check(e.ghostty_render_state_new(0, m.slot), 'render_state_new')
    this.#render = m.takeOpaque()
    m.check(e.ghostty_render_state_row_iterator_new(0, m.slot), 'row_iterator_new')
    this.#rows = m.takeOpaque()
    m.check(e.ghostty_render_state_row_cells_new(0, m.slot), 'row_cells_new')
    this.#cells = m.takeOpaque()
    m.check(e.ghostty_key_encoder_new(0, m.slot), 'key_encoder_new')
    this.#encoder = m.takeOpaque()
    m.check(e.ghostty_key_event_new(0, m.slot), 'key_event_new')
    this.#event = m.takeOpaque()
    this.#handleSlot = m.alloc(4)
    this.#keyOut = m.alloc(KEY_OUT)
    this.#cursorBuf = m.alloc(m.type('GhosttyRenderStateCursor').size)
    this.#styleBuf = m.alloc(m.type('GhosttyStyle').size)
    this.#lenBuf = m.alloc(4)
    this.#cpBuf = m.alloc(MAX_GRAPHEME * 4)
    this.#rgbBuf = m.alloc(Math.max(4, m.type('GhosttyColorRgb').size))
    this.#modeBuf = m.alloc(m.type('GhosttyTerminalModeConfig').size)

    writePtyHandlers.set(this.#userdata, onReply)
    const opt = (name: string) => m.enumValue('GhosttyTerminalOption', name)
    m.check(e.ghostty_terminal_set(this.#term, opt('USERDATA'), this.#userdata), 'set userdata')
    m.check(e.ghostty_terminal_set(this.#term, opt('WRITE_PTY'), writePtyFnIndex()), 'set write_pty')
  }

  feed(data: string | Uint8Array) {
    const m = this.#m
    const bytes = typeof data === 'string' ? enc.encode(data) : data
    if (bytes.length === 0) return
    const ptr = m.copyIn(bytes)
    try {
      m.exports.ghostty_terminal_vt_write(this.#term, ptr, bytes.length)
    } finally {
      m.free(ptr, bytes.length)
    }
  }

  resize(cols: number, rows: number) {
    if (cols === this.cols && rows === this.rowsCount) return
    this.#m.check(this.#m.exports.ghostty_terminal_resize(this.#term, cols, rows, 0, 0), 'resize')
    this.cols = cols
    this.rowsCount = rows
  }

  /** Bytes to write to the PTY for one key press, encoded by libghostty for the terminal's current modes. */
  encodeKey(input: KeyInput): Uint8Array {
    const m = this.#m
    const e = m.exports
    const name = ghosttyKeyName(input.key)
    const mods =
      (input.modifiers?.shift ? MODS.shift : 0) |
      (input.modifiers?.ctrl ? MODS.ctrl : 0) |
      (input.modifiers?.alt ? MODS.alt : 0) |
      (input.modifiers?.cmd ? MODS.super : 0)
    const ev = this.#event
    e.ghostty_key_event_set_action(ev, m.enumValue('GhosttyKeyAction', 'PRESS'))
    e.ghostty_key_event_set_key(ev, name ? m.enumValue('GhosttyKey', name) : 0)
    e.ghostty_key_event_set_mods(ev, mods)
    e.ghostty_key_event_set_consumed_mods(ev, 0)

    // Text the key produced. Control characters are never passed; the encoder
    // derives Ctrl sequences from the logical key instead.
    let text = input.keyChar ?? ''
    if (!text && input.key.length === 1) text = input.key
    if (input.key === 'space') text = ' '
    if ([...text].some((c) => c.codePointAt(0)! < 0x20 || c.codePointAt(0) === 0x7f)) text = ''
    const textBytes = enc.encode(text)
    const textPtr = textBytes.length ? m.copyIn(textBytes) : 0
    const base = input.key.length === 1 ? input.key.toLowerCase().codePointAt(0)! : 0
    e.ghostty_key_event_set_utf8(ev, textPtr, textBytes.length)
    e.ghostty_key_event_set_unshifted_codepoint(ev, base)
    if (mods & MODS.shift && text && text !== text.toLowerCase()) {
      e.ghostty_key_event_set_consumed_mods(ev, MODS.shift)
    }

    try {
      e.ghostty_key_encoder_setopt_from_terminal(this.#encoder, this.#term)
      const out = this.#keyOut
      const lenSlot = this.#handleSlot
      const result = e.ghostty_key_encoder_encode(this.#encoder, ev, out, KEY_OUT, lenSlot)
      if (result !== 0) return new Uint8Array()
      const len = m.view().getUint32(lenSlot, true)
      return m.bytes().slice(out, out + len)
    } finally {
      e.ghostty_key_event_set_utf8(ev, 0, 0)
      if (textPtr) m.free(textPtr, textBytes.length)
    }
  }

  /** Whether the program enabled bracketed paste (DEC mode 2004). */
  #bracketedPaste(): boolean {
    const m = this.#m
    const f = (name: string) => m.field('GhosttyTerminalModeConfig', name).offset
    m.bytes().fill(0, this.#modeBuf, this.#modeBuf + m.type('GhosttyTerminalModeConfig').size)
    m.view().setUint16(this.#modeBuf + f('mode'), 2004, true) // DEC private, not ANSI
    const r = m.exports.ghostty_terminal_get(this.#term, m.enumValue('GhosttyTerminalData', 'MODE'), this.#modeBuf)
    return r === 0 && m.bytes()[this.#modeBuf + f('value')] !== 0
  }

  /**
   * Bytes for pasting `text`, via libghostty: unsafe control bytes become spaces,
   * and the text is wrapped in ESC[200~ … ESC[201~ when the program asked for it,
   * so an embedded end marker or newline cannot run commands.
   */
  encodePaste(text: string): Uint8Array {
    const m = this.#m
    const e = m.exports
    const data = enc.encode(text)
    if (data.length === 0) return data
    const bracketed = this.#bracketedPaste()
    const cap = data.length * 2 + 16
    const inPtr = m.copyIn(data)
    const outPtr = m.alloc(cap)
    try {
      const r = e.ghostty_paste_encode(inPtr, data.length, bracketed, outPtr, cap, this.#lenBuf)
      if (r !== 0) return new Uint8Array()
      const len = m.view().getUint32(this.#lenBuf, true)
      return m.bytes().slice(outPtr, outPtr + len)
    } finally {
      m.free(inPtr, data.length)
      m.free(outPtr, cap)
    }
  }

  /** Plain text of the screen plus scrollback, via libghostty's formatter. */
  text(): string {
    const m = this.#m
    const e = m.exports
    const optsType = m.type('GhosttyFormatterTerminalOptions')
    const extraField = m.field('GhosttyFormatterTerminalOptions', 'extra')
    const screenField = m.field('GhosttyFormatterTerminalExtra', 'screen')
    const opts = m.alloc(optsType.size)
    let formatter = 0
    try {
      m.bytes().fill(0, opts, opts + optsType.size)
      const v = m.view()
      v.setUint32(opts + m.field('GhosttyFormatterTerminalOptions', 'size').offset, optsType.size, true)
      v.setInt32(opts + m.field('GhosttyFormatterTerminalOptions', 'emit').offset, m.enumValue('GhosttyFormatterFormat', 'PLAIN'), true)
      m.bytes()[opts + m.field('GhosttyFormatterTerminalOptions', 'trim').offset] = 1
      m.bytes()[opts + m.field('GhosttyFormatterTerminalOptions', 'unwrap').offset] = 1
      const extra = opts + extraField.offset
      v.setUint32(extra + m.field('GhosttyFormatterTerminalExtra', 'size').offset, m.type('GhosttyFormatterTerminalExtra').size, true)
      v.setUint32(extra + screenField.offset + m.field('GhosttyFormatterScreenExtra', 'size').offset, m.type('GhosttyFormatterScreenExtra').size, true)
      m.check(e.ghostty_formatter_terminal_new(0, m.slot, this.#term, opts), 'formatter_new')
      formatter = m.takeOpaque()
      m.check(e.ghostty_formatter_format_alloc(formatter, 0, m.scratch, m.scratch + 4), 'format_alloc')
      const ptr = m.view().getUint32(m.scratch, true)
      const len = m.view().getUint32(m.scratch + 4, true)
      const text = dec.decode(m.bytes().subarray(ptr, ptr + len))
      e.ghostty_free(0, ptr, len)
      return text
    } finally {
      if (formatter) e.ghostty_formatter_free(formatter)
      m.free(opts, optsType.size)
    }
  }

  /** Read the visible viewport as styled runs. */
  snapshot(): Grid {
    const m = this.#m
    const e = m.exports
    m.check(e.ghostty_render_state_update(this.#render, this.#term), 'render_state_update')

    const rsData = (name: string) => m.enumValue('GhosttyRenderStateData', name)
    const cellData = (name: string) => m.enumValue('GhosttyRenderStateRowCellsData', name)

    // Cursor.
    const cursorType = m.type('GhosttyRenderStateCursor')
    const cur = this.#cursorBuf
    m.bytes().fill(0, cur, cur + cursorType.size)
    m.view().setUint32(cur, cursorType.size, true)
    m.check(e.ghostty_render_state_get(this.#render, rsData('CURSOR'), cur), 'get cursor')
    const cf = (f: string) => cur + m.field('GhosttyRenderStateCursor', f).offset
    const cursor = {
      visible: m.bytes()[cf('visible')] !== 0 && m.bytes()[cf('viewport_has_value')] !== 0,
      col: m.view().getUint16(cf('viewport_x'), true),
      row: m.view().getUint16(cf('viewport_y'), true),
    }

    // Row iterator handle lives behind a pointer.
    m.view().setUint32(this.#handleSlot, this.#rows, true)
    m.check(e.ghostty_render_state_get(this.#render, rsData('ROW_ITERATOR'), this.#handleSlot), 'get rows')

    const styleType = m.type('GhosttyStyle')
    const sf = (f: string) => m.field('GhosttyStyle', f).offset
    const colorAt = (base: number): { tag: number; value: number } => ({
      tag: m.view().getInt32(base, true),
      value: base + 8,
    })
    const styleBuf = this.#styleBuf
    const lenBuf = this.#lenBuf
    const cpBuf = this.#cpBuf
    const rgbBuf = this.#rgbBuf
    const hex = (p: number) => {
      const b = m.bytes()
      return '#' + [b[p]!, b[p + 1]!, b[p + 2]!].map((x) => x.toString(16).padStart(2, '0')).join('')
    }

    const rows: Run[][] = []
    while (e.ghostty_render_state_row_iterator_next(this.#rows)) {
      m.view().setUint32(this.#handleSlot, this.#cells, true)
      m.check(e.ghostty_render_state_row_get(this.#rows, m.enumValue('GhosttyRenderStateRowData', 'CELLS'), this.#handleSlot), 'row cells')
      const runs: Run[] = []
      let last: Run | undefined
      while (e.ghostty_render_state_row_cells_next(this.#cells)) {
        m.view().setUint32(lenBuf, 0, true)
        e.ghostty_render_state_row_cells_get(this.#cells, cellData('GRAPHEMES_LEN'), lenBuf)
        const n = m.view().getUint32(lenBuf, true)
        let ch = ' '
        if (n > MAX_GRAPHEME) ch = '\uFFFD'
        else if (n > 0) {
          e.ghostty_render_state_row_cells_get(this.#cells, cellData('GRAPHEMES_BUF'), cpBuf)
          const cps: number[] = []
          for (let i = 0; i < n; i++) cps.push(m.view().getUint32(cpBuf + i * 4, true))
          ch = String.fromCodePoint(...cps)
        }
        m.bytes().fill(0, styleBuf, styleBuf + styleType.size)
        m.view().setUint32(styleBuf, styleType.size, true)
        e.ghostty_render_state_row_cells_get(this.#cells, cellData('STYLE'), styleBuf)
        const b = m.bytes()
        const resolve = (field: string, data: string): CellColor => {
          const c = colorAt(styleBuf + sf(field))
          if (c.tag === 1) {
            const idx = b[c.value]!
            if (idx < 16) return idx
          }
          if (c.tag === 0 && field === 'fg_color') return undefined
          if (e.ghostty_render_state_row_cells_get(this.#cells, cellData(data), rgbBuf) !== 0) return undefined
          return hex(rgbBuf)
        }
        const run: Run = {
          text: ch,
          fg: resolve('fg_color', 'FG_COLOR'),
          bg: resolve('bg_color', 'BG_COLOR'),
          bold: b[styleBuf + sf('bold')] !== 0,
          italic: b[styleBuf + sf('italic')] !== 0,
          faint: b[styleBuf + sf('faint')] !== 0,
          inverse: b[styleBuf + sf('inverse')] !== 0,
          underline: m.view().getInt32(styleBuf + sf('underline'), true) !== 0,
        }
        if (
          last && last.fg === run.fg && last.bg === run.bg && last.bold === run.bold &&
          last.italic === run.italic && last.faint === run.faint && last.inverse === run.inverse &&
          last.underline === run.underline
        ) {
          last.text += run.text
        } else {
          runs.push(run)
          last = run
        }
      }
      rows.push(runs)
    }
    e.ghostty_render_state_clean(this.#render)

    const screen = m.scratch
    e.ghostty_terminal_get(this.#term, m.enumValue('GhosttyTerminalData', 'ACTIVE_SCREEN'), screen)
    const alternate = m.view().getUint32(screen, true) === m.enumValue('GhosttyTerminalScreen', 'ALTERNATE')
    return { cols: this.cols, rows, cursor, alternate }
  }

  dispose() {
    const e = this.#m.exports
    if (!this.#term) return
    writePtyHandlers.delete(this.#userdata)
    e.ghostty_key_event_free(this.#event)
    e.ghostty_key_encoder_free(this.#encoder)
    e.ghostty_render_state_row_cells_free(this.#cells)
    e.ghostty_render_state_row_iterator_free(this.#rows)
    e.ghostty_render_state_free(this.#render)
    e.ghostty_terminal_free(this.#term)
    const m = this.#m
    m.free(this.#handleSlot, 4)
    m.free(this.#keyOut, KEY_OUT)
    m.free(this.#cursorBuf, m.type('GhosttyRenderStateCursor').size)
    m.free(this.#styleBuf, m.type('GhosttyStyle').size)
    m.free(this.#lenBuf, 4)
    m.free(this.#cpBuf, MAX_GRAPHEME * 4)
    m.free(this.#rgbBuf, Math.max(4, m.type('GhosttyColorRgb').size))
    m.free(this.#modeBuf, m.type('GhosttyTerminalModeConfig').size)
    this.#term = 0
  }
}
