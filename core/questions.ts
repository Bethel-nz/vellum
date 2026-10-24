// ACP form fields translated to Fluid Functionalism's stepped question layout.
// Keep the wire keys and enum values intact: Claude reads those exact answers.
export type QuestionOption = { value: string; title: string; description?: string }
export type UserQuestion = {
  id: string
  title: string
  options: QuestionOption[]
  multi: boolean
  required: boolean
  kind: 'string' | 'number' | 'integer' | 'boolean' | 'array'
  customId?: string
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  minItems?: number
  maxItems?: number
}
export type QuestionContent = Record<string, string | number | boolean | string[]>
type Choice = string | { const: string; title?: string; description?: string }
type FormField = {
  type?: string
  title?: string
  description?: string
  oneOf?: Choice[]
  anyOf?: Choice[]
  enum?: string[]
  enumNames?: string[]
  items?: { oneOf?: Choice[]; anyOf?: Choice[]; enum?: string[] }
} & Pick<UserQuestion, 'minLength' | 'maxLength' | 'minimum' | 'maximum' | 'minItems' | 'maxItems'>

export function formQuestions(message: string, schema: unknown): UserQuestion[] {
  const form = schema as { type?: string; properties?: Record<string, FormField>; required?: string[] } | undefined
  if (form?.type !== 'object' || !form.properties || typeof form.properties !== 'object') throw new Error('Invalid question form')
  const properties = form.properties
  const fields = Object.entries(properties)
  const companions = new Set(fields.filter(([id, field]) => /_custom$/.test(id) && field?.type === 'string' && properties[id.replace(/_custom$/, '')]).map(([id]) => id))
  const questions = fields.filter(([id]) => !companions.has(id)).map(([id, field]) => {
    const kind = field.type ?? 'string'
    if (!['string', 'number', 'integer', 'boolean', 'array'].includes(kind)) throw new Error(`Unsupported question field: ${id}`)
    const choices = kind === 'array' ? field.items?.anyOf ?? field.items?.oneOf ?? field.items?.enum : field.oneOf ?? field.anyOf ?? field.enum
    const options: QuestionOption[] = kind === 'boolean' ? [{ value: 'true', title: 'Yes' }, { value: 'false', title: 'No' }] : Array.isArray(choices) ? choices.map((option, index) => ({ value: typeof option === 'string' ? option : option.const, title: typeof option === 'string' ? field.enumNames?.[index] ?? option : option.title ?? option.const, description: typeof option === 'object' ? option.description : undefined })) : []
    if (options.some((option) => typeof option.value !== 'string' || typeof option.title !== 'string') || (kind === 'array' && !options.length)) throw new Error(`Unsupported question choices: ${id}`)
    return { id, title: field.description ?? (/^question_\d+$/.test(id) ? message : field.title) ?? message, kind, options, multi: kind === 'array', required: form.required?.includes(id) ?? false, customId: companions.has(`${id}_custom`) ? `${id}_custom` : undefined, minLength: field.minLength, maxLength: field.maxLength, minimum: field.minimum, maximum: field.maximum, minItems: field.minItems, maxItems: field.maxItems } as UserQuestion
  })
  if (!questions.length) throw new Error('The question form is empty')
  return questions
}

export function questionError(question: UserQuestion, content: QuestionContent): string | undefined {
  const value = content[question.id]
  const empty = value === undefined || value === '' || (Array.isArray(value) && !value.length)
  if (empty && !(Array.isArray(value) && question.minItems)) return question.required ? 'Choose an answer to continue.' : undefined
  if (question.options.length) {
    const values = Array.isArray(value) ? value : [String(value)]
    if (values.some((pick) => !question.options.some((option) => option.value === pick))) return 'Choose one of the available answers.'
    if (question.minItems !== undefined && values.length < question.minItems) return `Choose at least ${question.minItems} answers.`
    if (question.maxItems !== undefined && values.length > question.maxItems) return `Choose at most ${question.maxItems} answers.`
  } else if (question.kind === 'number' || question.kind === 'integer') {
    const number = Number(value)
    if (!Number.isFinite(number) || (question.kind === 'integer' && !Number.isInteger(number))) return 'Enter a valid number.'
    if (question.minimum !== undefined && number < question.minimum) return `Enter ${question.minimum} or more.`
    if (question.maximum !== undefined && number > question.maximum) return `Enter ${question.maximum} or less.`
  } else if (typeof value === 'string') {
    if (question.minLength !== undefined && value.length < question.minLength) return `Use at least ${question.minLength} characters.`
    if (question.maxLength !== undefined && value.length > question.maxLength) return `Use at most ${question.maxLength} characters.`
  }
}
