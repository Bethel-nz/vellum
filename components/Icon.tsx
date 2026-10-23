import { icons, type IconName } from '../ui/icons'
import { useM } from './theme'

export function Icon({ name, size = 14, color }: { name: IconName; size?: number; color?: string }) {
  const m = useM()
  return <svg source={icons[name]} style={{ width: size, height: size, flexShrink: 0, color: color ?? m.textMuted }} />
}
