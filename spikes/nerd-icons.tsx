// Spike: does GPUIX draw Nerd Font private-use glyphs when a <text> names the font?
// Renders candidate file-type glyphs (seti / devicons codepoints) next to their labels.
import { render } from '@gpuix/react'
import { dark } from '../ui/theme'

const glyphs: [string, number][] = [
  ['ts seti', 0xe628], ['tsx react', 0xe7ba], ['js seti', 0xe60c], ['json', 0xe60b], ['md seti', 0xe609], ['md dev', 0xe73e],
  ['rust', 0xe7a8], ['py', 0xe606], ['swift', 0xe755], ['go', 0xe627], ['sh', 0xf489], ['css', 0xe614],
  ['html', 0xe60e], ['config', 0xe615], ['yml', 0xe6a8], ['lock', 0xf023], ['git', 0xe702], ['image', 0xe60d],
  ['file oct', 0xf4a5], ['folder', 0xf07b], ['md-ts', 0xf06e6], ['bun', 0xe76f],
]
const fonts = ['Liga SFMono Nerd Font', 'Geist Mono']
render(
  <div testId="grid" style={{ width: '100%', height: '100%', backgroundColor: dark.pane, padding: 20, display: 'flex', flexDirection: 'row', gap: 40 }}>
    {fonts.map((f) => (
      <div key={f} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <text style={{ color: dark.textMuted, fontSize: 12 }}>{f}</text>
        {glyphs.map(([l, c]) => (
          <div key={l} style={{ display: 'flex', flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <text style={{ fontFamily: f, fontSize: 14, lineHeight: 18, color: dark.blue, width: 20 }}>{String.fromCodePoint(c)}</text>
            <text style={{ fontSize: 12, lineHeight: 18, color: dark.textUi }}>{`${l} ${c.toString(16)}`}</text>
          </div>
        ))}
      </div>
    ))}
  </div>,
  { title: 'nerd-icons-spike', width: 420, height: 560, focus: false },
)
