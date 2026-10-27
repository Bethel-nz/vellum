// Every colour, radius, font and easing in Vellum. Components read tokens only.
//
// Two materials with identical keys, both opaque (no glass, no blurred window):
//   dark  — the default: near-black from the user's Zed / Ghostty theme (groknight,
//           ~/dotfiles/themes/editors/zed/groknight.json), violet for agent identity, blue for
//           links and focus; primary controls use Groknight violet
//   light — off-white frame, white page, near-black text; its oklch sources were converted with
//           culori (scripts/oklch.ts)

import type { GpuixTheme } from '@gpuix/react'
import { nerdFamily, preferredTerminalFamily } from '../core/fonts'

export type MaterialName = 'dark' | 'light'
export const materialNames: MaterialName[] = ['dark', 'light']

/** A saved material by its current name. The glass looks are gone: smoke opens as dark, frost as light. */
export function materialNamed(name: string | undefined): MaterialName {
  return name === 'light' || name === 'frost' ? 'light' : 'dark'
}

export const shellInset = 4
export const radiusBase = 10
export const radiusXl = 14
export const windowRadius = radiusXl + shellInset

/** Radius for a panel inset by `inset` inside a parent of radius `parentRadius`, sharing its centre. */
export function concentric(parentRadius: number, inset: number) {
  return Math.max(0, parentRadius - inset)
}

export const readingWidth = 720
/**
 * The note's column: capped at 720 + 28px gutters so prose stays scannable.
 * Terminal grid sizing keeps its own wider calc at the call site (app.tsx).
 */
export function readingWidthFor(_windowWidth: number) {
  return readingWidth
}
export const headerHeight = 36
/** Space from the top of the pane to the first line of the note: the header band plus 16. Set once. */
export const contentInset = headerHeight + 16

const nerd = await nerdFamily()
const hasTermFont = nerd === preferredTerminalFamily

export const font = {
  sans: 'Geist',
  mono: 'Geist Mono',
  /** Terminal grid, as in the Ghostty theme, when that Nerd Font is installed; else the bundled Geist Mono. */
  term: hasTermFont ? preferredTerminalFamily : 'Geist Mono',
  /** Cell advance of `term` in em, from its hmtx table (spikes/mono-advance.py): 1266/2048, Geist Mono 600/1000. */
  termAdvance: hasTermFont ? 1266 / 2048 : 0.6,
  /** File-type glyphs (components/FileIcon.tsx); undefined when no Nerd Font is installed. */
  icons: nerd,
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
  title: { fontSize: 15, lineHeight: 22 },
  titleLg: { fontSize: 17, lineHeight: 23 },
  label: { fontSize: 12.5, lineHeight: 16 },
  caption: { fontSize: 10.5, lineHeight: 14 },
  badge: { fontSize: 10.5, lineHeight: 12 },
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

/** 16 ANSI colours, retuned per material so yellow and white stay legible on light. */
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
  /** Agent / skill identity (violet in dark). Never plain focus. */
  accent: string
  /** Links, permission, selection family. */
  blue: string
  /** Primary controls: Groknight violet in dark, neutral ink in light. */
  action: { background: string; hover: string; pressed: string; text: string }
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
  /** Pierre syntax for <code>, fenced Markdown and <diff>; interface/prose stay Groknight. */
  syntax: typeof pierre.dark.syntax
  /** Account dots, in profile order. */
  accents: string[]
}

const pierre = {
  dark: {
    text: '#fafafa', lineNumber: '#737373', addInk: '#60d199', delInk: '#ff6762',
    syntax: {
      keyword: '#ff678d', function: '#9d6afb', string: '#5ecc71', comment: '#737373', number: '#68cdf2',
      typeName: '#d568ea', constant: '#ffd452', tag: '#ff855e', variable: '#ffa359', punctuation: '#636363', link: '#9d6afb', special: '#ffab16',
      operator: '#08c0ef', parameter: '#a3a3a3', attribute: '#60d199', escape: '#61d5c0',
    },
  },
  light: {
    text: '#0a0a0a', lineNumber: '#737373', addInk: '#07c480', delInk: '#ff2e3f',
    syntax: {
      keyword: '#d32a61', function: '#693acf', string: '#199f43', comment: '#737373', number: '#1ca1c7',
      typeName: '#a631be', constant: '#d5a910', tag: '#d5512f', variable: '#d47628', punctuation: '#636363', link: '#693acf', special: '#d5901c',
      operator: '#08c0ef', parameter: '#636363', attribute: '#18a46c', escape: '#16a994',
    },
  },
}

const accents = ['#BBB0FF', '#7aa2f7', '#9ece6a', '#ff9e64', '#7dcfff', '#e0af68', '#f7768e', '#1abc9c']

export const dark: Material = {
  name: 'dark',
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
  // A white hairline, not an opaque grey: #1c1c1c on the pane as before, and still a line on the
  // popup, where the old #1c1c1e matched the fill and menu separators vanished.
  border: '#ffffff09',
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
  action: { background: '#BBB0FF', hover: '#d4ccff', pressed: '#a89ee6', text: '#141414' },
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
  syntax: pierre.dark.syntax,
  accents,
}

export const light: Material = {
  name: 'light',
  appearance: 'light',
  rootTint: '#ececef',
  pane: '#ffffff',
  paneHighlight: '#ffffff',
  titleBar: '#ececef',
  panel: '#f7f7f8',
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
  popup: '#ffffff',
  popupHover: '#f0f0f3',
  scrim: '#0000001f',
  codeBg: '#0000000a',
  accent: '#693acf',
  blue: '#1447e6',
  action: { background: '#171717', hover: '#27272a', pressed: '#57575f', text: '#ffffff' },
  focusRing: '#1447e699',
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
  syntax: pierre.light.syntax,
  accents,
}

export const materials: Record<MaterialName, Material> = { dark, light }

function syntaxTheme(m: Material): GpuixTheme['syntax'] {
  const x = m.syntax
  // SyntaxTheme has a `constructor` field, which object literals clash with in TS.
  return {
    keyword: x.keyword, function: x.function, functionBuiltin: x.function, string: x.string, stringSpecial: x.string,
    comment: x.comment, number: x.number, boolean: x.number, typeName: x.typeName, typeBuiltin: x.typeName,
    attribute: x.attribute, constant: x.constant, tag: x.tag, variable: x.variable, property: x.variable,
    punctuation: x.punctuation, operator: x.operator, escape: x.escape, variableSpecial: x.special, label: x.link, parameter: x.parameter,
    ['constructor' as string]: x.typeName,
  } as unknown as GpuixTheme['syntax']
}

const DIFF_FILE_HEADER = 22
const DIFF_HUNK_HEADER = 22
/** How far a <diff> slides up so its file row and first hunk header sit outside the card. */
export const diffHeaderClip = DIFF_FILE_HEADER + DIFF_HUNK_HEADER

/** Theme for the native <markdown>, <code>, <diff> and editors. */
/**
 * Shadows by how far a surface floats. Popovers (menus, the picker, the context card, toasts)
 * sit close to the page: a short, soft shadow at half the material's strength. The old
 * 12/32 at full strength drew a dark square halo around every menu on the dark materials,
 * the "extra fading panel" behind a dropdown. Sheets and dialogs keep the deep one; a scrim
 * dims around them anyway.
 */
export function elevation(m: Material, level: 'popover' | 'card' | 'sheet') {
  const [y, blur, k] = level === 'popover' ? [4, 12, 0.45] : level === 'card' ? [8, 20, 0.6] : [18, 48, 1]
  return { offsetX: 0, offsetY: y, blurRadius: blur, spreadRadius: 0, color: withAlpha(m.shadow, k) }
}

/** `#rrggbbaa` with its alpha scaled by `k`. */
function withAlpha(hex: string, k: number) {
  const a = hex.length === 9 ? parseInt(hex.slice(7), 16) : 255
  return hex.slice(0, 7) + Math.round(a * k).toString(16).padStart(2, '0')
}

/** An account's dot: the accent sequence in profile order, so no two accounts look alike. */
export function accentFor(m: Material, profiles: Array<{ id: string }>, id: string | undefined): string {
  const i = profiles.findIndex((p) => p.id === id)
  return i < 0 ? m.textFaint : m.accents[i % m.accents.length]!
}

/** The last two segments of a path, for rows that show the rest in a tooltip. */
export const shortPath = (p: string) => {
  // Either separator, so Windows paths shorten too; shown with the one the path uses.
  const sep = p.includes('\\') && !p.includes('/') ? '\\' : '/'
  const parts = p.split(/[\\/]+/).filter(Boolean)
  return parts.length > 2 ? `…${sep}${parts.slice(-2).join(sep)}` : p
}

export function nativeTheme(m: Material): GpuixTheme {
  const dark = m.appearance === 'dark'
  return {
    appearance: m.appearance,
    bg: '#00000000',
    border: m.border,
    // Prose reads in textUi; code never outshines it.
    text: m.textUi,
    textMuted: m.textMuted,
    textFaint: m.textFaint,
    textDim: m.textMuted,
    // Markdown paints bullets and links with the accent: keep them quiet, not saturated.
    accent: m.textMuted,
    caret: dark ? m.termCursor : m.accent,
    codeText: m.text,
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
      // No language label on code blocks: the header row collapses to nothing.
      mdCodeHeaderTextSize: 0,
      mdCodeHeaderPaddingY: 0,
      codeTextSize: type.mono.fontSize,
      codeLineHeight: type.mono.lineHeight,
      diffTextSize: type.mono.fontSize,
      diffLineHeight: 19,
      // Header rows keep real heights: at 0 their text still paints over the first line.
      // The edit card draws its own file row and clips these off the top (diffHeaderClip).
      diffFileHeaderHeight: DIFF_FILE_HEADER,
      diffHunkHeaderHeight: DIFF_HUNK_HEADER,
      diffRowPaddingX: 10,
    },
  }
}

/**
 * Claude's prose reads a step back from yours: your paragraphs are `text` at medium weight,
 * replies sit 85% of the way from `textUi` to `textMuted`: 7.5–8:1 on every material against
 * your 14.5–20:1, a step you see at a glance and still comfortable for a long reply (a 60% step
 * read as the same colour next to yours). Code, inline code and bold keep their own colours.
 */
export const replyText = (m: Material) => mix(m.textUi, m.textMuted, 0.85)

export function replyTheme(m: Material): GpuixTheme {
  return { ...nativeTheme(m), text: replyText(m) }
}

/** Two opaque #rrggbb colours, `t` of the way from `a` to `b`. */
function mix(a: string, b: string, t: number) {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
  return `#${[0, 1, 2].map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t).toString(16).padStart(2, '0')).join('')}`
}

// ---------------------------------------------------------------- diffs

/**
 * Diffs read in Pierre (~/dev/pierre-theme): Pierre Dark on dark, Pierre Light on light. Its
 * add/delete washes and syntax are tuned for reviewing changes, which the dark material's
 * editor colours are not. Everything else in the card stays the material's.
 */
/** Theme for <diff>: the native theme with Pierre's ink, washes and syntax, and a tight gutter. */
export function diffTheme(m: Material): GpuixTheme {
  const p = m.appearance === 'dark' ? pierre.dark : pierre.light
  const base = nativeTheme(m)
  return {
    ...base,
    text: p.text,
    codeText: p.text,
    textFaint: p.lineNumber,
    // Native diff applies its own row/word washes; solid ink keeps markers and gutters legible.
    diffAdd: p.addInk,
    diffDel: p.delInk,
    metrics: {
      ...base.metrics,
      // One narrow column per side and a slim marker: the gutter was most of the card's width.
      diffGutterWidth: 30,
      diffMarkerWidth: 14,
      diffRowPaddingX: 8,
      diffAccentBarWidth: 2,
    },
  }
}

/** Pierre's add/delete ink, for counts next to a diff. */
export const diffInk = (m: Material) => (m.appearance === 'dark' ? { add: pierre.dark.addInk, del: pierre.dark.delInk } : { add: pierre.light.addInk, del: pierre.light.delInk })
