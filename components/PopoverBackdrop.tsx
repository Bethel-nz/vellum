// A plain target in the deferred popup layer, above neighbouring animations. Outside
// dismissal must not wait for a mouse-down-outside event swallowed by another motion node.
import type { RefObject } from 'react'
import { useGpuixRequired, useWindowSize, type PublicInstance } from '@gpuix/react'

export function PopoverBackdrop({ onClose, testId, exclude }: { onClose: () => void; testId?: string; exclude?: RefObject<PublicInstance | null> }) {
  const window = useWindowSize()
  const renderer = useGpuixRequired()
  return <div testId={testId} aria-hidden onMouseDown={(event) => {
    // Native mouse-down can reach this sibling beneath a click-only control.
    const bounds = exclude?.current && renderer.getElementBounds?.(exclude.current.id)
    if (bounds && event.x !== undefined && event.y !== undefined && event.x >= bounds.x && event.x <= bounds.x + bounds.width && event.y >= bounds.y && event.y <= bounds.y + bounds.height) return
    onClose()
  }} style={{ position: 'absolute', left: -window.width, top: -window.height, width: window.width * 3, height: window.height * 3, backgroundColor: '#00000000' }} />
}
