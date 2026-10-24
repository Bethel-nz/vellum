// Spike: the AskUserQuestions panel on its own, over a pane-coloured backdrop, with a question
// that has options, descriptions and a "Something else" field. spikes/questions-run.ts shoots it.
import { render } from '@gpuix/react'
import { AskUserQuestions } from '../components/AskUserQuestions'
import type { Ask } from '../core/asks'
import { groknight } from '../ui/theme'

const ask = {
  requestId: 'q1',
  questions: [
    { id: 'q', title: 'Which layout should the settings page use?', kind: 'string', multi: false, required: false, customId: 'q_custom', options: [
      { value: 'page', title: 'Full page view', description: 'Replaces the note while open' },
      { value: 'sheet', title: 'Sheet', description: 'Slides over the note from the bottom' },
      { value: 'popover', title: 'Popover' },
    ] },
    { id: 'r', title: 'Anything else?', kind: 'string', multi: false, required: false, options: [] },
  ],
} as unknown as Ask

render(
  <div testId="backdrop" style={{ width: '100%', height: '100%', backgroundColor: groknight.pane.slice(0, 7), padding: 32, display: 'flex', flexDirection: 'column', gap: 12 }}>
    {Array.from({ length: 12 }, (_, i) => <text key={i} style={{ fontSize: 15, lineHeight: 22, color: groknight.text }}>The note behind the panel, line {i + 1}: enough text to see the wash.</text>)}
    <AskUserQuestions ask={ask} onAnswer={() => {}} />
  </div>,
  { title: 'questions-spike', width: 640, height: 520 },
)
