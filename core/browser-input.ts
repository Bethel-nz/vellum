const keys: Record<string, [string, string, number]> = {
  backspace: ['Backspace', 'Backspace', 8], tab: ['Tab', 'Tab', 9], enter: ['Enter', 'Enter', 13], escape: ['Escape', 'Escape', 27],
  space: [' ', 'Space', 32], pageup: ['PageUp', 'PageUp', 33], pagedown: ['PageDown', 'PageDown', 34], end: ['End', 'End', 35], home: ['Home', 'Home', 36],
  left: ['ArrowLeft', 'ArrowLeft', 37], up: ['ArrowUp', 'ArrowUp', 38], right: ['ArrowRight', 'ArrowRight', 39], down: ['ArrowDown', 'ArrowDown', 40], delete: ['Delete', 'Delete', 46],
}

export function browserKeyboardKey(raw: string, char?: string) {
  const special = keys[raw.toLowerCase()]
  if (special) return { key: special[0], code: special[1], windowsVirtualKeyCode: special[2] }
  const upper = raw.toUpperCase(), letter = /^[A-Z]$/.test(upper), digit = /^[0-9]$/.test(raw)
  return { key: char && char.length === 1 ? char : raw, code: letter ? `Key${upper}` : digit ? `Digit${raw}` : raw, windowsVirtualKeyCode: letter || digit ? upper.charCodeAt(0) : 0 }
}
