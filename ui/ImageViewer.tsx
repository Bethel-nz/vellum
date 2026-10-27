// An image you pasted, full size over the whole window: click one under a paragraph to open it.
// A small image shows at its own size and a large one fits the window; ← → step through the
// paragraph's other images. Esc, the ✕ or a click on the dark around it closes it.

import { useMemo, useRef } from 'react'
import { DismissableLayer, useWindowSize, type KeyEvent, type PublicInstance } from '@gpuix/react'
import { motion } from '../components/spring'
import { Button, Icon } from '../components'
import { duration, ease, tween, useReducedMotion } from '../components/motion'
import { imageSize } from '../core/imagesize'

/** Room kept around the image: the ✕ above, the arrows beside, the count below. */
const SIDE = 64
const TOP = 56
const BOTTOM = 52

export type Viewing = { images: string[]; index: number }

export function ImageViewer({ viewing, onIndex, onClose }: { viewing: Viewing; onIndex: (index: number) => void; onClose: () => void }) {
  const root = useRef<PublicInstance>(null)
  const win = useWindowSize()
  const reduced = useReducedMotion()
  const { images, index } = viewing
  const src = images[index]!
  const natural = useMemo(() => imageSize(src), [src])
  const many = images.length > 1
  const step = (by: number) => onIndex((index + by + images.length) % images.length)

  // Fit inside the room left; never larger than the picture itself.
  const roomW = Math.max(120, win.width - SIDE * 2)
  const roomH = Math.max(120, win.height - TOP - BOTTOM)
  const w = natural?.width ?? roomW
  const h = natural?.height ?? roomH
  const fit = Math.min(1, roomW / w, roomH / h)
  const width = Math.round(w * fit)
  const height = Math.round(h * fit)

  const onKeyDown = (e: KeyEvent) => {
    const key = (e.key ?? '').toLowerCase()
    if (!many) return
    if (key === 'left' || key === 'arrowleft') {
      e.preventDefault()
      step(-1)
    } else if (key === 'right' || key === 'arrowright') {
      e.preventDefault()
      step(1)
    }
  }
  const fade = tween({ duration: duration.fast, ease: ease.standard })

  return (
    <DismissableLayer onEscapeKeyDown={onClose} initialFocus={() => root.current?.id ?? null}>
      <div ref={root} testId="image-viewer" tabIndex={0} onKeyDown={onKeyDown} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, keyboardFocusDim: false }}>
        {/* Near-black in both themes, the way a photo is looked at. The press handler sits on the
            motion layer itself: a parent never hears a press over one. */}
        <motion.div onMouseDown={onClose} initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={fade} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000000ee' }} />
        <div style={{ position: 'absolute', top: TOP, left: SIDE, right: SIDE, bottom: BOTTOM, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <motion.div
            key={src}
            initial={reduced ? false : { opacity: 0, width: width * 0.97, height: height * 0.97 }}
            animate={{ opacity: 1, width, height }}
            transition={tween({ duration: duration.standard, ease: ease.enter })}
            style={{ width, height, borderRadius: 8 }}
          >
            <img testId="image-viewer-image" src={src} objectFit="contain" style={{ width: '100%', height: '100%', borderRadius: 8 }} />
          </motion.div>
        </div>
        <div style={{ position: 'absolute', top: 14, right: 14 }}>
          <Button testId="image-viewer-close" title="Close (esc)" onPress={onClose} style={{ width: 32, height: 32, minHeight: 32, paddingLeft: 0, paddingRight: 0, hover: { backgroundColor: '#ffffff1a' }, active: { backgroundColor: '#ffffff26' } }}>
            <Icon name="x" size={16} color="#ffffffcc" />
          </Button>
        </div>
        {many ? (
          <>
            <Arrow side="left" onPress={() => step(-1)} />
            <Arrow side="right" onPress={() => step(1)} />
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 18, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
              <text testId="image-viewer-count" style={{ fontSize: 12.5, lineHeight: 16, color: '#ffffff99' }}>{`${index + 1} of ${images.length}`}</text>
            </div>
          </>
        ) : null}
      </div>
    </DismissableLayer>
  )
}

function Arrow({ side, onPress }: { side: 'left' | 'right'; onPress: () => void }) {
  return (
    <div style={{ position: 'absolute', top: 0, bottom: 0, [side]: 14, display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
      <div style={{ pointerEvents: 'auto' }}>
        <Button testId={`image-viewer-${side === 'left' ? 'prev' : 'next'}`} title={side === 'left' ? 'Previous image (←)' : 'Next image (→)'} onPress={onPress} style={{ width: 36, height: 36, minHeight: 36, paddingLeft: 0, paddingRight: 0, borderRadius: 18, backgroundColor: '#ffffff12', hover: { backgroundColor: '#ffffff24' }, active: { backgroundColor: '#ffffff33' } }}>
          <Icon name={side === 'left' ? 'chevronLeft' : 'chevronRight'} size={18} color="#ffffffcc" />
        </Button>
      </div>
    </div>
  )
}
