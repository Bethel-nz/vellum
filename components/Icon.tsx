import opencode from '../assets/brands/opencode.png' with { type: 'file' }
import { icons, type IconName } from '../ui/icons'
import { useM } from './theme'

// Native SVGs are alpha masks; a raster asset retains OpenCode's two-tone mark.
const opencodeSource = `data:image/png;base64,${Buffer.from(await Bun.file(opencode).arrayBuffer()).toString('base64')}`

export function Icon({ name, size = 14, color }: { name: IconName; size?: number; color?: string }) {
  const m = useM()
  if (name === 'opencode') return <img src={opencodeSource} objectFit="contain" style={{ width: size, height: size, flexShrink: 0 }} />
  return <svg source={icons[name]} style={{ width: size, height: size, flexShrink: 0, color: color ?? m.textMuted }} />
}
