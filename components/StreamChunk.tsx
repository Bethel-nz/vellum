// Streaming text is committed in immutable batches. Each batch gets its own virtual-list
// row and one opacity entrance; later deltas never grow a row already measured by GPUIX.
import { memo, useEffect, useRef, useState } from 'react'
import { motion } from './spring'
import { splitFences } from '../core/fences'
import { safeEnd, settlePoints } from '../core/stream'
import { concentric, nativeTheme, radiusBase, replyText, replyTheme } from '../ui/theme'
import { duration, enter, useReducedMotion } from './motion'
import { useM } from './theme'

export type StreamSlice = { id: number; text: string }

export function useStreamChunks(text: string, streaming: boolean): StreamSlice[] {
  const latest = useRef(text)
  latest.current = text
  const cursor = useRef(0)
  const revealedAt = useRef(0)
  const [chunks, setChunks] = useState<StreamSlice[]>([])
  useEffect(() => {
    if (!streaming) return
    const timer = setInterval(() => {
      const pending = latest.current.slice(cursor.current)
      if (!pending) return
      const before = splitFences(latest.current.slice(0, cursor.current)).at(-1)
      const inCode = before?.kind === 'code' && before.open
      const settled = settlePoints(latest.current).filter((point) => point > cursor.current).at(-1)
      // The first batch arrives within 120ms; later ones settle on markdown boundaries,
      // with a bounded wait for prose that has no paragraph break yet.
      if (cursor.current && settled === undefined && Date.now() - revealedAt.current < duration.considered * 1000) return
      const end = settled ?? safeEnd(latest.current)
      if (end <= cursor.current) return
      const start = cursor.current
      const part = latest.current.slice(start, end)
      cursor.current = end
      revealedAt.current = Date.now()
      const prefix = inCode ? `\`\`\`${before.language}\n` : ''
      setChunks((shown) => [...shown, { id: start, text: prefix + part }])
    }, duration.instant * 1000)
    return () => clearInterval(timer)
  }, [streaming])
  return chunks
}

export const StreamChunk = memo(function StreamChunk({ text, id }: { text: string; id: string }) {
  const m = useM()
  const reduced = useReducedMotion()
  const parts = splitFences(text)
  let partOffset = 0
  return (
    <motion.div initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={enter('fast')} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div testId={id} style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: text.endsWith('\n\n') ? 10 : 0 }}>
        {parts.map((part) => {
          const key = partOffset
          partOffset += (part.kind === 'code' ? part.code : part.text).length + 1
          return part.kind === 'code' ? (
            <code key={`code-${key}`} code={part.code || ' '} language={part.language || undefined} theme={nativeTheme(m)} style={{ padding: 10, borderRadius: concentric(radiusBase, 2), backgroundColor: m.codeBg }} />
          ) : <markdown key={`prose-${key}`} source={part.text} theme={replyTheme(m)} style={{ color: replyText(m) }} />
        })}
      </div>
    </motion.div>
  )
})
