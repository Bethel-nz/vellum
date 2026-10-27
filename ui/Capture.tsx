import path from 'node:path'
import { DismissableLayer } from '@gpuix/react'
import { Button, Label } from '../components'
import type { SavedCapture } from '../core/capture'
import { captureDir, captureImages } from '../core/captures'
import { revealFolder } from '../core/platform'
import { useM } from './kit'
import { font, nativeTheme } from './theme'

const elementCount = (count: number) => new Intl.PluralRules().select(count) === 'one' ? `${count} element` : `${new Intl.NumberFormat().format(count)} elements`

export function CaptureCard({ saved, onOpen }: { saved: SavedCapture; onOpen: () => void }) {
  const m = useM()
  const images = captureImages(saved).slice(0, 3)
  const notes = [...new Set(saved.capture.elements.map((element) => element.note).filter(Boolean))].join(' · ')
  return (
    <div testId={`capture-${saved.capture.id}`} style={{ display: 'flex', flexDirection: 'column', gap: 9, borderWidth: 1, borderColor: m.border, borderRadius: 12, padding: 12 }}>
      <Button onPress={onOpen} title="Inspect capture" testId={`capture-open-${saved.capture.id}`} style={{ height: 'auto', justifyContent: 'flex-start', paddingLeft: 0, paddingRight: 0 }}>
        <text style={{ fontSize: 13, lineHeight: 19, fontWeight: 500, color: m.text, flexGrow: 1, minWidth: 0, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{saved.capture.page.title || 'Browser capture'}</text>
        <text style={{ fontSize: 11, color: saved.status === 'resolved' ? m.accent : m.textMuted }}>{saved.status}</text>
      </Button>
      {images.length ? <div onClick={onOpen} style={{ display: 'flex', flexDirection: 'row', gap: 6, cursor: 'pointer' }}>{images.map((src) => <img key={src} src={src} objectFit="cover" style={{ width: 120, height: 76, borderRadius: 6 }} />)}</div> : null}
      {notes ? <text style={{ fontSize: 13, lineHeight: 19, color: m.text }}>{notes}</text> : null}
      <text style={{ fontSize: 11.5, lineHeight: 16, color: m.textMuted, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{`${elementCount(saved.capture.elements.length)} · ${saved.capture.page.url}`}</text>
      {saved.summary || saved.reply ? <text style={{ fontSize: 12, lineHeight: 18, color: m.textMuted }}>{saved.reply || saved.summary}</text> : null}
    </div>
  )
}

export function CaptureViewer({ saved, onClose, onImage }: { saved: SavedCapture; onClose: () => void; onImage: (images: string[], index: number) => void }) {
  const m = useM()
  return (
    <DismissableLayer onEscapeKeyDown={onClose}>
      <div testId="capture-viewer" role="dialog" aria-label="Captured page elements" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: m.pane, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12, padding: 18, borderBottomWidth: 1, borderColor: m.border }}>
          <text style={{ fontSize: 15, fontWeight: 600, color: m.text, flexGrow: 1 }}>{saved.capture.page.title || 'Browser capture'}</text>
          <Button onPress={() => revealFolder(captureDir(saved.noteId, saved.capture.id))}><Label>Open folder</Label></Button>
          <Button onPress={onClose} testId="capture-viewer-close"><Label>Done</Label></Button>
        </div>
        <div style={{ flexGrow: 1, minHeight: 0, overflowY: 'scroll', padding: 28, display: 'flex', flexDirection: 'column', gap: 24 }}>
          <text style={{ fontSize: 12, color: m.textMuted }}>{saved.capture.page.url}</text>
          {saved.capture.elements.map((element) => {
            const images = [element.shots.element, element.shots.context, ...(element.snapshots ?? []).map((snapshot) => snapshot.image.file), ...element.animations.flatMap((animation) => animation.frames ?? [])].filter((file): file is string => Boolean(file)).map((file) => path.join(captureDir(saved.noteId, saved.capture.id), file))
            return <div key={element.ref} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <text style={{ fontSize: 14, lineHeight: 21, fontWeight: 500, color: m.text }}>{element.note || element.selector}</text>
              <text style={{ fontSize: 11.5, lineHeight: 17, fontFamily: font.mono, color: m.textMuted }}>{element.selector}</text>
              <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{images.map((src, index) => <div key={src} onClick={() => onImage(images, index)} style={{ cursor: 'pointer' }}><img src={src} objectFit="contain" style={{ width: 220, height: 150, borderRadius: 8 }} /></div>)}</div>
              {element.react ? <text style={{ fontSize: 12, color: m.textMuted }}>{`${element.react.component}${element.react.source ? ` · ${element.react.source}` : ''}`}</text> : null}
              <code theme={nativeTheme(m)} code={element.html} language="html" style={{ width: '100%', fontSize: 12, lineHeight: 18, color: m.text, backgroundColor: m.chipBg, padding: 12, borderRadius: 8 }} />
              <code theme={nativeTheme(m)} code={JSON.stringify({ css: element.css, pseudo: element.pseudo, rules: element.rules, vars: element.vars, fonts: element.fonts, box: element.box, parent: element.parent }, null, 2)} language="json" style={{ width: '100%', fontSize: 12, lineHeight: 18, color: m.text, backgroundColor: m.chipBg, padding: 12, borderRadius: 8 }} />
              {element.animations.length ? <>
                <text style={{ fontSize: 13, fontWeight: 500, color: m.text }}>Animations</text>
                {element.animations.map((animation, index) => <div key={index} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <text style={{ fontSize: 12, color: m.textMuted }}>{`${animation.name || animation.kind} · ${animation.origin === 'sampled' ? 'sampled · inferred' : 'extracted'} · ${animation.trigger || 'idle'}`}</text>
                  <code theme={nativeTheme(m)} code={JSON.stringify(animation, null, 2)} language="json" style={{ width: '100%', fontSize: 12, lineHeight: 18, color: m.text, backgroundColor: m.chipBg, padding: 12, borderRadius: 8 }} />
                </div>)}
              </> : null}
              {element.listeners?.length ? <code theme={nativeTheme(m)} code={JSON.stringify(element.listeners, null, 2)} language="json" style={{ width: '100%', fontSize: 12, color: m.text }} /> : null}
            </div>
          })}
        </div>
      </div>
    </DismissableLayer>
  )
}
