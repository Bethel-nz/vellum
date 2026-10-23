// A label on hover, after arc's tooltip: 3px offset, opacity over `instant`. Wraps the headless
// GPUIX tooltip so every one shares the delay and the popup recipe.

import type { ReactNode } from 'react'
import { motion } from '@gpuix/react'
import { Tooltip as Root, TooltipContent, TooltipProvider, TooltipTrigger } from '@gpuix/react/tooltip'
import { concentric, radiusBase } from '../ui/theme'
import { Kbd } from './Kbd'
import { enter, offset } from './motion'
import { useM } from './theme'

export function TooltipScope({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={500} skipDelayDuration={300}>
      {children}
    </TooltipProvider>
  )
}

export function Tooltip({ label, shortcut, children, side = 'bottom' }: { label: string; shortcut?: string; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  const m = useM()
  return (
    <Root>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side={side}
        sideOffset={6}
        style={{ paddingLeft: 8, paddingRight: shortcut ? 4 : 8, height: 24, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: m.popup, borderRadius: concentric(radiusBase, 3), borderWidth: 1, borderColor: m.border }}
      >
        <motion.div
          initial={{ opacity: 0, top: side === 'top' ? offset.tooltip : -offset.tooltip }}
          animate={{ opacity: 1, top: 0 }}
          transition={enter('instant')}
          style={{ position: 'relative', display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}
        >
          <text style={{ fontSize: 12, lineHeight: 16, color: m.textUi, whiteSpace: 'nowrap' }}>{label}</text>
          {shortcut ? <Kbd>{shortcut}</Kbd> : null}
        </motion.div>
      </TooltipContent>
    </Root>
  )
}
