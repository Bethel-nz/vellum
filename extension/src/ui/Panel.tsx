import type { ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { IconCrossMedium } from '@central-icons-react/round-outlined-radius-2-stroke-2/IconCrossMedium'
import { Button } from '../arc/button/button'
import { motionTokens } from '../arc/motion-tokens'
import logo from '../../../assets/icon.png?inline'

export function Panel({ children, open = true, title = 'Capture', count, onClose, popup = false }: { children: ReactNode; open?: boolean; title?: string; count?: number; onClose?: () => void; popup?: boolean }) {
  const reduced = useReducedMotion()
  return <AnimatePresence initial={false}>{open ? <motion.section
    key="capture" className={`vellum-shell${popup ? ' vellum-popup' : ''}`} aria-label="Vellum Snapshot controls"
    initial={reduced ? { opacity: 0 } : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
    exit={reduced ? { opacity: 0 } : { opacity: 0, y: -5 }}
    transition={{ duration: reduced ? .12 : motionTokens.duration.fast, ease: [...motionTokens.ease.enter] }}
  >
    <div className="vellum-page">
      <header className="vellum-header">
        <img className="vellum-logo" src={logo} width="20" height="20" alt="" />
        <h1>{title}</h1>
        {count !== undefined ? <span className="vellum-count">{count} selected</span> : null}
        {onClose ? <Button static variant="ghost" size="sm" className="vellum-icon-button" aria-label="Close capture" title="Close capture (Esc)" onClick={onClose}><IconCrossMedium size={15} aria-hidden="true" /></Button> : null}
      </header>
      {children}
    </div>
  </motion.section> : null}</AnimatePresence>
}
