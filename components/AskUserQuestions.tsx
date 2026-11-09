// Stacked questions. The elevated surface enters behind plain controls and disappears atomically.
import { useState } from 'react'
import { useWindowSize, type KeyEvent } from '@gpuix/react'
import { motion } from './spring'
import { Button as Base } from '@gpuix/react/button'
import type { Ask } from '../core/asks'
import { questionError, type QuestionContent, type UserQuestion } from '../core/questions'
import { concentric, elevation, radiusBase, radiusXl, shellInset, windowRadius } from '../ui/theme'
import { Button, Label } from './Button'
import { Field } from './Field'
import { Kbd } from './Kbd'
import { Lifted } from './Lifted'
import { Scroll } from './Scroll'
import { duration, ease, enter, offset, tween, useReducedMotion } from './motion'
import { useM } from './theme'

/** Panel edge to rows, and row edge to text: every left edge in the panel sits at inset + edge. */
const inset = 6
const edge = 10
const rowRadius = concentric(radiusXl, inset)

export function AskUserQuestions({ ask, onAnswer }: { ask?: Ask; onAnswer: (content: QuestionContent | null) => void }) {
  return ask?.questions?.length ? <Questions key={ask.requestId} questions={ask.questions} onAnswer={onAnswer} /> : null
}

function Questions({ questions, onAnswer }: { questions: UserQuestion[]; onAnswer: (content: QuestionContent | null) => void }) {
  const m = useM()
  const window = useWindowSize()
  const reduced = useReducedMotion()
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<QuestionContent>({})
  const [error, setError] = useState<string>()
  const question = questions[index]
  if (!question) return null
  const width = Math.min(520, window.width - 32)
  const last = index === questions.length - 1
  const change = (id: string, value: string) => {
    setAnswers((current) => {
      const next = { ...current }
      if (value.trim()) next[id] = value
      else delete next[id]
      return next
    })
    setError(undefined)
  }
  const advance = (next: QuestionContent) => {
    const issue = questionError(question, next)
    if (issue) { setError(issue); return }
    setAnswers(next)
    setError(undefined)
    if (last) onAnswer(next)
    else setIndex(index + 1)
  }
  const choose = (value: string) => {
    if (question.multi) {
      const selected = Array.isArray(answers[question.id]) ? answers[question.id] as string[] : []
      setAnswers({ ...answers, [question.id]: selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value] })
      setError(undefined)
    } else advance({ ...answers, [question.id]: question.kind === 'boolean' ? value === 'true' : value })
  }
  const skip = () => {
    const next = { ...answers }
    delete next[question.id]
    if (question.customId) delete next[question.customId]
    advance(next)
  }
  const keys = (event: KeyEvent) => {
    if (event.defaultPrevented || event.modifiers?.cmd || event.modifiers?.ctrl || event.modifiers?.alt) return
    const digit = Number(event.key)
    const option = question.options[digit - 1]
    if (/^[1-9]$/.test(event.key ?? '') && option) { event.preventDefault(); choose(option.value) }
    else if (event.key === 'left' && index > 0) { event.preventDefault(); setError(undefined); setIndex(index - 1) }
  }
  const fieldKeys = (event: KeyEvent) => {
    event.stopPropagation()
    if (event.key === 'enter' && (event.modifiers?.cmd || event.modifiers?.ctrl)) { event.preventDefault(); advance(answers) }
  }
  return <>
    {/* GPUIX blurs only the whole window, so the note behind washes toward the pane instead. */}
    <motion.div initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={tween({ duration: duration.fast, ease: ease.standard })} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: concentric(windowRadius, shellInset), backgroundColor: m.pane + 'b8', pointerEvents: 'none' }} />
    <div testId="user-questions" role="dialog" aria-label={question.title} onKeyDown={keys} style={{ position: 'absolute', left: (window.width - width) / 2, bottom: 50, width }}>
    <Lifted initial={reduced ? false : { opacity: 0, top: offset.dialog }} animate={{ opacity: 1, top: 0 }} transition={enter()} shadow={elevation(m, 'card')} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, borderRadius: radiusXl, backgroundColor: m.popup, borderWidth: 1, borderColor: m.border, pointerEvents: 'none' }} />
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', padding: inset }}>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: edge, paddingLeft: edge, paddingRight: edge }}>
        <text style={{ flexGrow: 1, fontSize: 11.5, lineHeight: 16, color: m.textMuted }}>{`Question ${index + 1} of ${questions.length}`}</text>
        {questions.length > 1 ? questions.map((item, step) => <div key={item.id} style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: step === index ? m.textUi : m.textFaint }} />) : null}
      </div>
      <div style={{ paddingTop: 6, paddingBottom: 10, paddingLeft: edge, paddingRight: edge }}>
        <text testId="user-question-title" style={{ fontSize: 16, lineHeight: 22, fontWeight: 600, color: m.text }}>{question.title}</text>
      </div>
      {/* The list runs to the panel's edge; a thumb, when there is one, sits over the rows' right padding. */}
      <Scroll gutter={inset} style={{ maxHeight: Math.max(120, window.height - 280), marginRight: -inset }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {question.options.map((option, optionIndex) => {
            const selected = question.multi ? (answers[question.id] as string[] | undefined)?.includes(option.value) : String(answers[question.id]) === option.value
            return <Base key={option.value} testId={`question-option-${optionIndex}`} aria-label={option.description ? `${option.title}. ${option.description}` : option.title} aria-selected={selected} onClick={() => choose(option.value)} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 38, padding: edge, borderRadius: rowRadius, backgroundColor: selected ? m.selected : '#00000000', hover: { backgroundColor: selected ? m.pressed : m.hover }, focusVisible: { outlineWidth: 2, outlineColor: m.focusRing, outlineOffset: -2 } }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0 }}>
                <text style={{ fontSize: 13, lineHeight: 18, fontWeight: 500, color: m.textUi }}>{option.title}</text>
                {option.description ? <text style={{ fontSize: 12, lineHeight: 17, color: m.textMuted }}>{option.description}</text> : null}
              </div>
              <div style={{ width: 22, height: 22, flexShrink: 0, borderRadius: concentric(radiusBase, 4), backgroundColor: selected ? m.textUi : m.chipBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><text style={{ fontSize: 11, lineHeight: 15, fontWeight: 500, color: selected ? m.pane : m.textMuted }}>{question.multi && selected ? '✓' : String(optionIndex + 1)}</text></div>
            </Base>
          })}
          {!question.options.length || question.customId ? <div style={{ display: 'flex', flexDirection: 'row', paddingTop: question.options.length ? 4 : 0 }}>
            <Field quiet testId="question-free-text" value={String(answers[question.customId ?? question.id] ?? '')} placeholder={question.customId ? 'Something else…' : 'Your answer…'} onChange={(value) => change(question.customId ?? question.id, value)} onKeyDown={fieldKeys} onSubmit={() => advance(answers)} style={{ height: 38, paddingLeft: edge, paddingRight: edge, fontSize: 13, borderRadius: rowRadius }} />
          </div> : null}
        </div>
      </Scroll>
      {error ? <div role="alert" style={{ paddingTop: 8, paddingLeft: edge, paddingRight: edge }}><text style={{ fontSize: 12, lineHeight: 17, color: m.danger }}>{error}</text></div> : null}
      {/* Quiet buttons pad their label by 8, so 2 more puts it on the same edge as the text above. */}
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 4, paddingTop: 12, paddingLeft: edge - 8, paddingBottom: 2 }}>
        {index > 0 ? <Button testId="question-back" onPress={() => { setError(undefined); setIndex(index - 1) }}><Label muted>Back</Label></Button> : <Button testId="question-cancel" onPress={() => onAnswer(null)}><Label muted>Cancel</Label></Button>}
        <div style={{ flexGrow: 1 }} />
        {!question.required ? <Button testId="question-skip" onPress={skip} style={{ height: 30, minHeight: 30, paddingLeft: 12, paddingRight: 12, borderRadius: 15 }}><Label muted>Skip</Label></Button> : null}
        {question.multi || question.customId || !question.options.length ? <Button testId="question-next" variant="solid" onPress={() => advance(answers)} style={{ height: 30, minHeight: 30, paddingLeft: 12, paddingRight: 8, borderRadius: 15 }}><Label variant="solid">{last ? 'Send' : 'Continue'}</Label><Kbd>⌘↵</Kbd></Button> : null}
      </div>
    </div>
    </div>
  </>
}
