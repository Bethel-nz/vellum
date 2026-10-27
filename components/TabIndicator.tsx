// A single selected wash slides behind the strip's active pill, without moving its hit area.
import { motion } from './spring'
import { duration, ease, tween, useReducedMotion } from './motion'
import { useM } from './theme'

export function TabIndicator({ left, width }: { left: number; width: number }) {
  const m = useM()
  useReducedMotion()
  return (
    <div testId="strip-indicator" style={{ position: 'absolute', top: 2, bottom: 2, left: 0, right: 0, pointerEvents: 'none' }}>
      <motion.div
        initial={false}
        animate={{ left, width, opacity: width ? 1 : 0 }}
        transition={tween({ duration: duration.instant, ease: ease.enter })}
        style={{ position: 'absolute', top: 0, height: 24, borderRadius: 7, backgroundColor: m.selected, borderWidth: 1, borderColor: m.borderFocused }}
      />
    </div>
  )
}
