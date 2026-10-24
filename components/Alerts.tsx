// Attention belongs to its note's tab. Arrival never moves focus; dismissal is atomic.
import { FloatingLayer } from '@gpuix/react/floating'
import { elevation, radiusBase } from '../ui/theme'
import { Alert } from './Alert'
import { Button, Label } from './Button'
import { Lifted } from './Lifted'
import { enter, offset, useReducedMotion } from './motion'
import { useM } from './theme'

export function Alerts({ title, detail, needsYou, onOpen, onEnter, onLeave }: { title: string; detail?: string; needsYou?: boolean; onOpen: () => void; onEnter: () => void; onLeave: () => void }) {
  const m = useM()
  const reduced = useReducedMotion()
  return (
    <FloatingLayer side="bottom" align="center" sideOffset={6} style={{ width: 320, backgroundColor: '#00000000' }}>
      <Lifted
        initial={reduced ? false : { opacity: 0, top: -offset.menu }}
        animate={{ opacity: 1, top: 0 }}
        transition={enter('fast')}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        shadow={elevation(m, 'popover')}
        style={{ position: 'relative', borderRadius: radiusBase, pointerEvents: 'none' }}
      >
        <div style={{ pointerEvents: 'auto' }}>
          <Alert tone={needsYou ? 'info' : 'success'} title={needsYou ? 'Approval needed' : 'Reply ready'} testId="attention-card">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <text style={{ fontSize: 12, lineHeight: 18, color: m.textMuted }}>{title}</text>
              {detail ? <text style={{ fontSize: 12, lineHeight: 18, color: m.textUi, lineClamp: 3 }}>{detail}</text> : null}
              <Button onPress={onOpen} testId="attention-open" style={{ alignSelf: 'start', marginLeft: -8 }}><Label>{needsYou ? 'Review request' : 'Read reply'}</Label></Button>
            </div>
          </Alert>
        </div>
      </Lifted>
    </FloatingLayer>
  )
}
