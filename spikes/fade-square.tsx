// Spike: a menu fading in shows a square, lighter panel at its bounds on the first frames, with
// or without its shadow (scripts/check-motion.ts). Which part paints it? Boxes mount on a click,
// each fading 0→1 over 0.3s, on the pane colour:
//   a  bg + radius + border          b  a + elevation shadow
//   c  bg, no radius                 d  static opacity 0.3, bg + radius (no motion)
//   e  motion with no bg; its child has bg + radius
import { useState } from 'react'
import { motion, render } from '@gpuix/react'
import { elevation, groknight } from '../ui/theme'

const m = groknight
const panel = { width: 140, height: 110, backgroundColor: m.popup, borderRadius: 12, borderWidth: 1, borderColor: m.border }
const fade = { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.3, ease: 'linear' as const } }

function Spike() {
  const [on, setOn] = useState(false)
  return (
    <div testId="root" style={{ width: '100%', height: '100%', backgroundColor: m.pane, padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div testId="go" onClick={() => setOn((v) => !v)} style={{ width: 60, height: 24, backgroundColor: m.hover }} />
      {on ? (
        <div style={{ display: 'flex', flexDirection: 'row', gap: 24 }}>
          <motion.div {...fade} style={panel} />
          <motion.div {...fade} style={{ ...panel, boxShadow: elevation(m, 'popover') }} />
          <motion.div {...fade} style={{ ...panel, borderRadius: 0 }} />
          <div style={{ ...panel, opacity: 0.3 }} />
          <motion.div {...fade} style={{ width: 140, height: 110 }}>
            <div style={panel} />
          </motion.div>
        </div>
      ) : null}
    </div>
  )
}
render(<Spike />, { title: 'fade-square-spike', width: 860, height: 220, focus: false })
