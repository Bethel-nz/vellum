// The Help note's page (core/help.ts): read-only, laid out like a note, with a paragraph to
// write in at the end. Nothing here is a block, so nothing can be clicked into and edited;
// the first thing you write leaves for a new note of its own.
import { useRef } from 'react'
import { useWindowSize } from '@gpuix/react'
import { Scroll } from '../components'
import { helpMarkdown } from '../core/help'
import { keys } from '../core/platform'
import { useM } from './kit'
import { font, readingWidthFor, replyText, replyTheme, type } from './theme'

/** `first`: the first thing written on this visit, which starts the note; what follows is more of it. */
export function HelpNote({ onWrite }: { onWrite: (text: string, first: boolean) => void }) {
  const m = useM()
  // Keys typed before the new note takes focus still land here.
  const started = useRef(false)
  const width = readingWidthFor(useWindowSize().width)
  return (
    <Scroll testId="help" style={{ flexGrow: 1 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', paddingTop: 28, paddingBottom: 240 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, width: '100%', maxWidth: width, paddingLeft: 28, paddingRight: 28 }}>
          <text style={{ fontFamily: font.sans, fontSize: 22, lineHeight: 30, fontWeight: 600, color: m.text }}>Welcome to Vellum</text>
          <markdown source={keys(helpMarkdown)} theme={replyTheme(m)} style={{ color: replyText(m) }} />
          <textarea
            testId="help-write"
            value=""
            placeholder="Start writing to begin a new note…"
            minRows={1}
            maxRows={1}
            theme={{ caret: m.appearance === 'dark' ? m.text : m.accent, textFaint: m.textFaint }}
            onChange={(e) => {
              if (!e.value) return
              onWrite(e.value, !started.current)
              started.current = true
            }}
            style={{ width: '100%', minWidth: 0, marginTop: 10, fontFamily: font.sans, ...type.user, fontWeight: 500, color: m.text, backgroundColor: '#00000000', borderWidth: 0, padding: 0 }}
          />
        </div>
      </div>
    </Scroll>
  )
}
