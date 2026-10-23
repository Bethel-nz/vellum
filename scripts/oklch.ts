// Converts the oklch sources from the design notes to the hex values kept in ui/theme.ts.
import { formatHex, oklch } from 'culori'
const sources: Record<string, string> = {
  textMutedSmoke: 'oklch(65% 0.01 286)',
  textMutedFrost: 'oklch(46% 0.012 286)',
  accentBlue: 'oklch(48.8% 0.243 264.4)',
  focusPink: 'oklch(85% 0.03 325)',
}
for (const [k, v] of Object.entries(sources)) console.log(k.padEnd(16), v.padEnd(24), formatHex(oklch(v)!))
