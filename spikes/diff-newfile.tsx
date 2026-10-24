// Spike: a new file's diff (`@@ -0,0 +1,n @@`) in the hunk card, with the Pierre diff theme.
// The Changes sheet showed line numbers and markers but no code for one; this renders that case
// beside an ordinary edit.
import { render } from '@gpuix/react'
import { createTwoFilesPatch } from 'diff'
import { hunksOnly } from '../core/threads'
import { diffHeaderClip, diffTheme, dark } from '../ui/theme'

const content = Array.from({ length: 8 }, (_, i) => `export const line${i + 1} = ${i + 1} // a new file`).join('\n') + '\n'
const created = hunksOnly(createTwoFilesPatch('a.ts', 'a.ts', '', content, '', '', { context: 3 }))
const edited = hunksOnly(createTwoFilesPatch('b.ts', 'b.ts', 'const a = 1\nconst b = 2\n', 'const a = 1\nconst b = 3\n', '', '', { context: 3 }))
const m = dark
const card = (patch: string, id: string) => (
  <div style={{ display: 'flex', flexDirection: 'column', width: 480, borderRadius: 10, borderWidth: 1, borderColor: m.border, backgroundColor: m.codeBg, overflow: 'hidden' }}>
    <div style={{ height: 28 }} />
    <div style={{ overflow: 'hidden' }}>
      <diff testId={id} patch={patch} wordDiff theme={diffTheme(m)} style={{ marginTop: -diffHeaderClip }} />
    </div>
  </div>
)
render(
  <div testId="root" style={{ width: '100%', height: '100%', backgroundColor: m.popup, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
    {card(created, 'created')}
    {card(edited, 'edited')}
  </div>,
  { title: 'diff-newfile-spike', width: 540, height: 520, focus: false },
)
