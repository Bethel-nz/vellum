// Spike: can the traffic lights be pushed out of view with trafficLightX/Y?
// Opens a plain window with the given offset, then captures the screen region it occupies.
//   bun spikes/hide-traffic-lights.tsx -200 -200
import { render } from '@gpuix/react'

const x = Number(process.argv[2] ?? -200)
const y = Number(process.argv[3] ?? -200)

render(<div style={{ width: '100%', height: '100%', backgroundColor: '#0c0c0c' }} />, {
  title: 'tl-spike',
  width: 400,
  height: 200,
  titlebarTransparent: true,
  windowBackground: 'opaque',
  trafficLightX: x,
  trafficLightY: y,
})
setTimeout(() => process.exit(0), 9000)
