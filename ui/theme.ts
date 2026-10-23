// Every colour, radius, font and easing in Vellum. Components read tokens only.
//
// Two materials with identical keys:
//   smoke — black glass over the blurred desktop, near-white text
//   frost — cool off-white glass, near-black text
// Colour lives behind the glass; the glass itself stays grayscale with alpha hairlines.
// oklch sources were converted with culori (scripts/oklch.ts).

import type { GpuixTheme } from '@gpuix/react'

export type MaterialName = 'smoke' | 'frost'

export const shellInset = 4
export const radiusBase = 10
export const radiusXl = 14
export const windowRadius = radiusXl + shellInset

/** Radius for a panel inset by `inset` inside a parent of radius `parentRadius`, sharing its centre. */
export function concentric(parentRadius: number, inset: number) {
  return Math.max(0, parentRadius - inset)
}

export const readingWidth = 720
export const headerHeight = 36

export const font = {
  sans: 'Inter',
  mono: 'SF Mono',
  monoFallback: 'Menlo',
}

export const type = {
  // Size-specific tracking is not available in GPUI text, so hierarchy comes
  // from size + weight + leading as a set.
  body: { fontSize: 14, lineHeight: 22 },
  user: { fontSize: 14.5, lineHeight: 23 },
  meta: { fontSize: 11.5, lineHeight: 16 },
  title: { fontSize: 13, lineHeight: 18 },
  mono: { fontSize: 12, lineHeight: 18 },
}

export const motion = {
  duration: { xs: 0.1, sm: 0.15, md: 0.2, lg: 0.3, xl: 0.4 },
  expoOut: [0.22, 1, 0.36, 1] as [number, number, number, number],
  standard: [0.2, 0.8, 0.2, 1] as [number, number, number, number],
  material: [0.4, 0, 0.2, 1] as [number, number, number, number],
  /** Popovers materialise: opacity 0→1 plus a 4px rise. */
  popoverRise: 4,
}

/** 16 ANSI colours, retuned per material so yellow and white stay legible on frost. */
type Ansi = [string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string]

export type Material = {
  name: MaterialName
  appearance: 'dark' | 'light'
  // shell
  rootTint: string
  pane: string
  paneHighlight: string
  // text
  text: string
  textMuted: string
  textFaint: string
  // lines and states
  border: string
  borderFaint: string
  hover: string
  pressed: string
  popup: string
  popupHover: string
  scrim: string
  codeBg: string
  // accents
  accent: string
  focusRing: string
  success: string
  danger: string
  dangerBg: string
  // diff
  diffAdd: string
  diffDel: string
  diffHunkBg: string
  // terminal
  termBg: string
  termFg: string
  termCursor: string
  ansi: Ansi
  scrollbar: string
  shadow: string
}

export const smoke: Material = {
  name: 'smoke',
  appearance: 'dark',
  rootTint: '#00000099',
  pane: '#0000004d',
  paneHighlight: '#ffffff0f',
  text: '#fafafa',
  textMuted: '#8e8e95', // oklch(65% .01 286)
  textFaint: '#8e8e9580',
  border: '#ffffff1a',
  borderFaint: '#ffffff06',
  hover: '#ffffff14',
  pressed: '#ffffff1f',
  popup: '#1f1f1f',
  popupHover: '#2a2a2a',
  scrim: '#00000066',
  codeBg: '#ffffff08',
  accent: '#1447e6', // oklch(48.8% .243 264.4)
  focusRing: '#d8c7d9', // oklch(85% .03 325)
  success: '#5fb98a',
  danger: '#e5766b',
  dangerBg: '#e5766b14',
  diffAdd: '#3fb95026',
  diffDel: '#f8514926',
  diffHunkBg: '#ffffff06',
  termBg: '#ffffff05',
  termFg: '#d9d9de',
  termCursor: '#fafafa',
  ansi: [
    '#3a3a40', '#e5766b', '#7cc49a', '#d9b56c', '#7aa2e8', '#c39ae0', '#6cc2c9', '#d9d9de',
    '#66666e', '#f0938a', '#97d8b0', '#ecca85', '#98b9f2', '#d6b3ee', '#8ad6dc', '#fafafa',
  ],
  scrollbar: '#ffffff1a',
  shadow: '#00000066',
}

export const frost: Material = {
  name: 'frost',
  appearance: 'light',
  rootTint: '#f4f4f6d9',
  pane: '#ffffff66',
  paneHighlight: '#ffffffb3',
  text: '#171717',
  textMuted: '#57575f', // oklch(46% .012 286)
  textFaint: '#57575f80',
  border: '#00000014',
  borderFaint: '#00000008',
  hover: '#0000000d',
  pressed: '#00000014',
  popup: '#fbfbfc',
  popupHover: '#efeff2',
  scrim: '#0000001f',
  codeBg: '#0000000a',
  accent: '#1447e6',
  focusRing: '#d8c7d9',
  success: '#2f8a5b',
  danger: '#c2453a',
  dangerBg: '#c2453a12',
  diffAdd: '#1a7f3720',
  diffDel: '#cf222e1c',
  diffHunkBg: '#00000006',
  termBg: '#00000006',
  termFg: '#2a2a30',
  termCursor: '#171717',
  ansi: [
    '#2a2a30', '#b4372d', '#1f7a4a', '#8a6200', '#2457c5', '#8040b0', '#1a7680', '#6c6c74',
    '#57575f', '#c94a3f', '#2a8f59', '#9c7000', '#3468d6', '#9352c2', '#218791', '#3a3a40',
  ],
  scrollbar: '#0000001f',
  shadow: '#0000001f',
}

/** Solid fallback (VELLUM_SOLID=1): opaque window, same keys. */
export function solid(m: Material): Material {
  return m.name === 'smoke'
    ? { ...m, rootTint: '#171717', pane: '#262626', paneHighlight: '#ffffff0a' }
    : { ...m, rootTint: '#f5f5f5', pane: '#ffffff', paneHighlight: '#ffffff' }
}

/** Theme for the native <markdown>, <code>, <diff> and editors. */
export function nativeTheme(m: Material): GpuixTheme {
  const dark = m.appearance === 'dark'
  return {
    appearance: m.appearance,
    bg: '#00000000',
    border: m.border,
    text: m.textMuted,
    textMuted: m.textMuted,
    textFaint: m.textFaint,
    textDim: m.textMuted,
    accent: dark ? '#7aa2e8' : m.accent,
    caret: dark ? m.text : m.accent,
    codeText: m.termFg,
    codeWash: m.codeBg,
    diffAdd: m.diffAdd,
    diffDel: m.diffDel,
    diffHunkBg: m.diffHunkBg,
    fontSans: font.sans,
    fontMono: font.mono,
    // SyntaxTheme has a `constructor` field, which object literals clash with in TS.
    syntax: (dark
      ? { keyword: '#c39ae0', string: '#97d8b0', comment: '#66666e', number: '#ecca85', function: '#98b9f2', typeName: '#8ad6dc', constant: '#ecca85' }
      : { keyword: '#8040b0', string: '#1f7a4a', comment: '#8a8a92', number: '#8a6200', function: '#2457c5', typeName: '#1a7680', constant: '#8a6200' }) as unknown as GpuixTheme['syntax'],
    metrics: {
      mdTextSize: type.body.fontSize,
      mdLineHeight: type.body.lineHeight,
      mdBlockGap: 12,
      mdHeadingSizes: [19, 16, 14.5, 14],
      mdHeadingLineHeights: [26, 23, 22, 22],
      mdCodeRadius: concentric(radiusBase, 2),
      codeTextSize: type.mono.fontSize,
      codeLineHeight: type.mono.lineHeight,
      diffTextSize: type.mono.fontSize,
      diffLineHeight: 19,
      diffFileHeaderHeight: 0,
      diffRowPaddingX: 10,
    },
  }
}
