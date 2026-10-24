// The app icon, drawn with GPUIX and saved as assets/icon.png (1024×1024) for the Dock.
// A placeholder until real artwork: Vellum's "V" in the accent on the dark pane, on the macOS
// icon grid (an 824px rounded square centred on 1024, radius 185).
//   bun scripts/icon.tsx
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { render, useGpuixRequired } from '@gpuix/react'
import { useEffect } from 'react'

const out = path.join(import.meta.dir, '..', 'assets', 'icon.png')
// Logical points; the screenshot is taken at 2×, so 512 points make the 1024px icon.
const SIZE = 512
const BODY = 412
const RADIUS = 92

if (process.env.VELLUM_ICON_DRAW === '1') {
  function Icon() {
    const renderer = useGpuixRequired()
    useEffect(() => {
      renderer.registerFont?.(readFileSync(path.join(import.meta.dir, '..', 'assets', 'fonts', 'Geist-SemiBold.ttf')))
    }, [renderer])
    return (
      <div testId="icon" style={{ width: SIZE, height: SIZE, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: BODY, height: BODY, borderRadius: RADIUS, backgroundColor: '#141414', borderWidth: 2, borderColor: '#2a2a2a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <text style={{ fontFamily: 'Geist', fontWeight: 600, fontSize: 250, lineHeight: 260, color: '#BBB0FF' }}>V</text>
        </div>
      </div>
    )
  }
  render(<Icon />, { title: 'Vellum icon', width: SIZE, height: SIZE, windowBackground: 'transparent', titlebarTransparent: true, trafficLightX: -200, trafficLightY: -200, focus: false })
} else {
  const { launch } = await import('@gpuix/react/automation')
  const app = await launch({ command: 'bun', args: [import.meta.path], env: { GPUIX_BACKGROUND: '1', VELLUM_ICON_DRAW: '1' } })
  try {
    await app.getByTestId('icon').waitFor({ timeoutMs: 30_000 })
    await new Promise((r) => setTimeout(r, 800))
    await app.screenshot({ path: out })
  } finally {
    await app.close()
  }
  await Bun.spawn(['sips', '-z', '1024', '1024', out], { stdout: 'ignore' }).exited
  console.log(`wrote ${out}`)
}
