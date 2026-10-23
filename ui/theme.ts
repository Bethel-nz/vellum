// Every colour, radius, font and easing in Vellum. Components read tokens only.
//
// Three materials with identical keys:
//   groknight — the default: opaque near-black from the user's Zed / Ghostty theme
//               (~/dotfiles/themes/editors/zed/groknight.json), violet for agent identity,
//               blue for selection and focus
//   smoke     — black glass over the blurred desktop, near-white text
//   frost     — cool off-white glass, near-black text
// smoke/frost oklch sources were converted with culori (scripts/oklch.ts).

import type { GpuixTheme } from '@gpuix/react'

export type MaterialName = 'groknight' | 'smoke' | 'frost'
export const materialNames: MaterialName[] = ['groknight', 'smoke', 'frost']

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
/** Space from the top of the pane to the first line of the note: the header band plus 16. Set once. */
export const contentInset = headerHeight + 16

export const font = {
  sans: 'Geist',
  mono: 'Geist Mono',
  /** Terminal grid, as in the Ghostty theme. Installed system-wide; SF Mono metrics. */
  term: 'Liga SFMono Nerd Font',
  /** Cell advance of `term` in em: 1266/2048 from its hmtx table (spikes/mono-advance.py). */
  termAdvance: 1266 / 2048,
  /** If a family fails to register, GPUI falls back per glyph; these are the named fallbacks. */
  sansFallback: 'Inter',
  monoFallback: 'SF Mono',
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
  /** The tab strip band at the top of the pane. */
  titleBar: string
  panel: string
  // text
  text: string
  /** Chrome labels: slightly below body text. */
  textUi: string
  textMuted: string
  textFaint: string
  // lines and states
  border: string
  borderFaint: string
  borderFocused: string
  hover: string
  pressed: string
  /** Active tab, selected row. */
  selected: string
  popup: string
  popupHover: string
  scrim: string
  codeBg: string
  // accents
  /** Agent / skill identity (violet in groknight). Never plain focus. */
  accent: string
  /** Links, permission, selection family. */
  blue: string
  focusRing: string
  /** Text selection wash. */
  selection: string
  /** Hover wash behind a #file:line slice. */
  lineWash: string
  chipBg: string
  skillBg: string
  success: string
  warning: string
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
  scrollbarHover: string
  shadow: string
  /** Syntax colours for <code>, <markdown> and <diff>. */
  syntax: { keyword: string; function: string; string: string; comment: string; number: string; typeName: string; constant: string; tag: string; variable: string; punctuation: string; link: string }
  /** Account dots, in profile order. */
  accents: string[]
}

const accents = ['#BBB0FF', '#7aa2f7', '#9ece6a', '#ff9e64', '#7dcfff', '#e0af68', '#f7768e']

export const groknight: Material = {
  name: 'groknight',
  appearance: 'dark',
  rootTint: '#0a0a0a',
  pane: '#141414',
  paneHighlight: '#ffffff0f',
  titleBar: '#0c0c0c',
  panel: '#111111',
  text: '#e5e5e5',
  textUi: '#d4d4d4',
  textMuted: '#9d9d9d',
  textFaint: '#4d4d4d',
  border: '#1c1c1e',
  borderFaint: '#141414',
  borderFocused: '#2e2e32',
  hover: '#2c2c2c',
  pressed: '#363636',
  selected: '#363636',
  popup: '#1c1c1c',
  popupHover: '#26262a',
  scrim: '#00000080',
  codeBg: '#1c1c1c',
  accent: '#BBB0FF',
  blue: '#7aa2f7',
  focusRing: '#7aa2f7aa',
  selection: '#7aa2f744',
  lineWash: '#7aa2f728',
  chipBg: '#242424',
  skillBg: '#BBB0FF1a',
  success: '#9ece6a',
  warning: '#f8ca73',
  danger: '#fe6767',
  dangerBg: '#fe676714',
  diffAdd: '#9ece6a26',
  diffDel: '#fe676726',
  diffHunkBg: '#ffffff06',
  termBg: '#0a0a0a',
  termFg: '#e5e5e5',
  termCursor: '#BBB0FF',
  ansi: [
    '#141414', '#fe6767', '#9ece6a', '#f8ca73', '#7aa2f7', '#BBB0FF', '#7dcfff', '#e5e5e5',
    '#4d4d4d', '#ff8f8f', '#C8E997', '#FFA86B', '#a3bffa', '#f6a9ff', '#b3e8ff', '#ffffff',
  ],
  scrollbar: '#242424',
  scrollbarHover: '#363636',
  shadow: '#00000099',
  syntax: {
    keyword: '#BBB0FF', function: '#FFA86B', string: '#C8E997', comment: '#60e67d', number: '#f8ca73',
    typeName: '#f8ca73', constant: '#fe6767', tag: '#fe6767', variable: '#ffffff', punctuation: '#d6d3d1', link: '#f6a9ff',
  },
  accents,
}

export const smoke: Material = {
  name: 'smoke',
  appearance: 'dark',
  rootTint: '#00000099',
  pane: '#0000004d',
  paneHighlight: '#ffffff0f',
  titleBar: '#00000000',
  panel: '#ffffff05',
  text: '#fafafa',
  textUi: '#e4e4e7',
  textMuted: '#8e8e95', // oklch(65% .01 286)
  textFaint: '#8e8e9580',
  border: '#ffffff1a',
  borderFaint: '#ffffff06',
  borderFocused: '#ffffff2e',
  hover: '#ffffff14',
  pressed: '#ffffff1f',
  selected: '#ffffff1f',
  popup: '#1f1f1f',
  popupHover: '#2a2a2a',
  scrim: '#00000066',
  codeBg: '#ffffff08',
  accent: '#1447e6', // oklch(48.8% .243 264.4)
  blue: '#7aa2e8',
  focusRing: '#d8c7d9', // oklch(85% .03 325)
  selection: '#7aa2e855',
  lineWash: '#7aa2e828',
  chipBg: '#ffffff0f',
  skillBg: '#c39ae01f',
  success: '#5fb98a',
  warning: '#d9b56c',
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
  scrollbarHover: '#ffffff2e',
  shadow: '#00000066',
  syntax: {
    keyword: '#c39ae0', function: '#98b9f2', string: '#97d8b0', comment: '#66666e', number: '#ecca85',
    typeName: '#8ad6dc', constant: '#ecca85', tag: '#e5766b', variable: '#fafafa', punctuation: '#a1a1aa', link: '#98b9f2',
  },
  accents,
}

export const frost: Material = {
  name: 'frost',
  appearance: 'light',
  rootTint: '#f4f4f6d9',
  pane: '#ffffff66',
  paneHighlight: '#ffffffb3',
  titleBar: '#00000000',
  panel: '#00000005',
  text: '#171717',
  textUi: '#27272a',
  textMuted: '#57575f', // oklch(46% .012 286)
  textFaint: '#57575f80',
  border: '#00000014',
  borderFaint: '#00000008',
  borderFocused: '#00000029',
  hover: '#0000000d',
  pressed: '#00000014',
  selected: '#00000014',
  popup: '#fbfbfc',
  popupHover: '#efeff2',
  scrim: '#0000001f',
  codeBg: '#0000000a',
  accent: '#1447e6',
  blue: '#1447e6',
  focusRing: '#d8c7d9',
  selection: '#1447e633',
  lineWash: '#1447e61a',
  chipBg: '#0000000a',
  skillBg: '#8040b014',
  success: '#2f8a5b',
  warning: '#8a6200',
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
  scrollbarHover: '#00000033',
  shadow: '#0000001f',
  syntax: {
    keyword: '#8040b0', function: '#2457c5', string: '#1f7a4a', comment: '#8a8a92', number: '#8a6200',
    typeName: '#1a7680', constant: '#8a6200', tag: '#b4372d', variable: '#171717', punctuation: '#57575f', link: '#2457c5',
  },
  accents,
}

export const materials: Record<MaterialName, Material> = { groknight, smoke, frost }

/** Solid fallback (VELLUM_SOLID=1): opaque window, same keys. Groknight is already opaque. */
export function solid(m: Material): Material {
  if (m.name === 'groknight') return m
  return m.name === 'smoke'
    ? { ...m, rootTint: '#171717', pane: '#262626', paneHighlight: '#ffffff0a' }
    : { ...m, rootTint: '#f5f5f5', pane: '#ffffff', paneHighlight: '#ffffff' }
}

/**
 * The opt-in translucent look (settings `translucent`). Groknight takes alpha off its solid
 * ramp; smoke and frost are translucent already.
 */
export function translucent(m: Material): Material {
  if (m.name !== 'groknight') return m
  return { ...m, rootTint: '#0a0a0ae6', pane: '#141414d9', titleBar: '#0c0c0cd9' }
}

/** Whether a material wants the blurred window background. */
export const wantsBlur = (m: Material) => m.rootTint.length === 9 && !m.rootTint.endsWith('ff')

function syntaxTheme(m: Material): GpuixTheme['syntax'] {
  const x = m.syntax
  // SyntaxTheme has a `constructor` field, which object literals clash with in TS.
  return {
    keyword: x.keyword, function: x.function, functionBuiltin: x.function, string: x.string, stringSpecial: x.string,
    comment: x.comment, number: x.number, boolean: x.number, typeName: x.typeName, typeBuiltin: x.typeName,
    attribute: x.number, constant: x.constant, tag: x.tag, variable: x.variable, property: x.variable,
    punctuation: x.punctuation, operator: x.punctuation,
  } as unknown as GpuixTheme['syntax']
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
    accent: m.blue,
    caret: m.name === 'groknight' ? m.termCursor : dark ? m.text : m.accent,
    codeText: m.termFg,
    codeWash: m.codeBg,
    diffAdd: m.diffAdd,
    diffDel: m.diffDel,
    diffHunkBg: m.diffHunkBg,
    fontSans: font.sans,
    fontMono: font.mono,
    // SyntaxTheme has a `constructor` field, which object literals clash with in TS.
    syntax: syntaxTheme(m),
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
      // Below ~20 the native hunk header paints over the file header row.
      diffFileHeaderHeight: 22,
      diffRowPaddingX: 10,
    },
  }
}
