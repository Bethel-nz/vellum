// A plain target in the deferred popup layer, above neighbouring animations. Outside
// dismissal must not wait for a mouse-down-outside event swallowed by another motion node.
import { useWindowSize } from '@gpuix/react'

export function PopoverBackdrop({ onClose, testId }: { onClose: () => void; testId?: string }) {
  const window = useWindowSize()
  return <div testId={testId} aria-hidden onMouseDown={onClose} style={{ position: 'absolute', left: -window.width, top: -window.height, width: window.width * 3, height: window.height * 3, backgroundColor: '#00000000' }} />
}
