import opencode from '../assets/brands/opencode.png' with { type: 'file' }
import { icons, type IconName } from '../ui/icons'
import { useM } from './theme'

// Native SVGs are alpha masks; a raster asset retains OpenCode's two-tone mark.
// Brand marks are NON-TINTABLE: claude/mcp tint via currentColor, codex ships its own ink,
// opencode renders the PNG below. Never pass color to force accent onto them.
const opencodeSource = `data:image/png;base64,${Buffer.from(await Bun.file(opencode).arrayBuffer()).toString('base64')}`

/** Agent/brand marks that must never take accent: identity, not focus. */
export const brandMarks = new Set(['claude', 'codex', 'mcp', 'opencode'])

export function Icon({ name, size = 14, color }: { name: IconName; size?: number; color?: string }) {
  const m = useM()
  if (name === 'opencode') return <img src={opencodeSource} objectFit="contain" style={{ width: size, height: size, flexShrink: 0 }} />
  return <svg source={icons[name]} style={{ width: size, height: size, flexShrink: 0, color: color ?? m.textMuted }} />
}
