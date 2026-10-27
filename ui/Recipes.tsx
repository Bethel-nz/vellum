// Recipes, the other side of the History panel: prompts you keep and run with `$name`. Pick one
// to put `$name ` in the composer; New or Edit opens the form in place. A project's recipes sit
// in its .vellum/recipes, so they travel with the repo; they can only ask for Ask or Plan.
import { useMemo, useState } from 'react'
import { type KeyEvent, type PublicInstance } from '@gpuix/react'
import { Button, Field, Label, Scroll, Segmented } from '../components'
import type { PermissionMode } from '../core/asks'
import { deleteRecipe, recipeName, saveRecipe, type Recipe } from '../core/recipes'
import { keys } from '../core/platform'
import { Row } from './dialogs'
import { Icon, Meta, useM } from './kit'
import { font } from './theme'

type Draft = { name: string; description: string; mode: '' | PermissionMode; body: string; scope: Recipe['scope']; file?: string }
const blank = (scope: Recipe['scope']): Draft => ({ name: '', description: '', mode: '', body: '', scope })

const modeOptions = (scope: Recipe['scope']): Array<{ value: '' | PermissionMode; label: string }> => [
  { value: '', label: 'As is' },
  { value: 'manual', label: 'Ask' },
  { value: 'plan', label: 'Plan' },
  // A repo's recipe can't ask you less than you chose.
  ...(scope === 'yours' ? ([{ value: 'acceptEdits', label: 'Edits' }, { value: 'auto', label: 'Auto' }] as const) : []),
]

export function RecipesView({
  recipes,
  folder,
  onUse,
  onChanged,
  inputRef,
  onKeyDown,
}: {
  recipes: Recipe[]
  /** The note's folder: where "This project" recipes live. */
  folder?: string
  onUse: (name: string) => void
  onChanged: () => void
  inputRef: React.RefObject<PublicInstance | null>
  /** Panel keys (esc, ⌘Y) the list doesn't use itself. */
  onKeyDown: (e: KeyEvent) => void
}) {
  const m = useM()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string>()

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^\$/, '')
    return recipes.filter((r) => !q || r.name.includes(q) || r.description?.toLowerCase().includes(q))
  }, [recipes, query])
  const groups = (['yours', 'project'] as const).map((scope) => [scope, shown.filter((r) => r.scope === scope)] as const).filter(([, rs]) => rs.length)

  const edit = (r?: Recipe) => {
    setError(undefined)
    setDraft(r ? { name: r.name, description: r.description ?? '', mode: r.mode ?? '', body: r.body, scope: r.scope, file: r.file } : blank('yours'))
  }
  const save = async () => {
    if (!draft) return
    try {
      await saveRecipe({ ...draft, name: draft.name, description: draft.description.trim() || undefined, mode: draft.mode || undefined }, folder)
      setDraft(null)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  const remove = async () => {
    if (!draft?.file) return
    await deleteRecipe({ file: draft.file })
    setDraft(null)
    onChanged()
  }

  const listKeys = (e: KeyEvent) => {
    const step = (d: number) => {
      e.preventDefault()
      setActive((a) => (shown.length ? (a + d + shown.length) % shown.length : 0))
    }
    if ((e.modifiers?.ctrl && e.key === 'n') || e.key === 'down') step(1)
    else if ((e.modifiers?.ctrl && e.key === 'p') || e.key === 'up') step(-1)
    else onKeyDown(e)
  }

  if (draft) {
    const name = recipeName(draft.name)
    return (
      <Scroll style={{ flexGrow: 1 }} padding={16}>
        <div testId="recipe-form" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <text style={{ fontSize: 13, lineHeight: 18, fontWeight: 600, color: m.text }}>{draft.file ? `Edit $${name || '…'}` : 'New recipe'}</text>
          <Labelled label="Name" hint={name ? `Run it with $${name}` : 'Letters, numbers and dashes'}>
            <Field testId="recipe-name" value={draft.name} autoFocus={!draft.file} placeholder="review" mono onChange={(name) => setDraft({ ...draft, name })} onKeyDown={onKeyDown} />
          </Labelled>
          <Labelled label="Description">
            <Field testId="recipe-description" value={draft.description} placeholder="Review the uncommitted changes" onChange={(description) => setDraft({ ...draft, description })} onKeyDown={onKeyDown} />
          </Labelled>
          <Labelled label="Save to" hint={draft.scope === 'project' ? 'Shared with this project.' : 'Available in all your notes.'}>
            <Segmented<Recipe['scope']>
              testId="recipe-scope"
              value={draft.scope}
              width={110}
              onChange={(scope) => setDraft({ ...draft, scope, mode: scope === 'project' && !['', 'manual', 'plan'].includes(draft.mode) ? '' : draft.mode })}
              options={folder ? [{ value: 'yours', label: 'Yours' }, { value: 'project', label: 'This project' }] : [{ value: 'yours', label: 'Yours' }]}
            />
          </Labelled>
          <Labelled label="Mode" hint="Mode used when this recipe runs.">
            <Segmented<'' | PermissionMode> testId="recipe-mode" value={draft.mode} width={64} onChange={(mode) => setDraft({ ...draft, mode })} options={modeOptions(draft.scope)} />
          </Labelled>
          <Labelled label="Prompt" hint="Use {{input}} for your text. {{folder}}, {{branch}} and {{date}} fill in automatically.">
            <textarea
              testId="recipe-body"
              value={draft.body}
              placeholder="Review what changed on {{branch}}. Focus on {{input}}."
              minRows={6}
              maxRows={20}
              onChange={(e) => setDraft({ ...draft, body: e.value ?? '' })}
              onKeyDown={(e) => {
                if (e.key === 'enter' && (e.modifiers?.cmd || e.modifiers?.ctrl)) {
                  e.preventDefault()
                  save()
                } else if (e.key === 'escape') {
                  e.preventDefault()
                  setDraft(null)
                }
              }}
              style={{ width: '100%', minWidth: 0, fontFamily: font.mono, fontSize: 12.5, lineHeight: 19, color: m.text, backgroundColor: m.chipBg, borderRadius: 10, borderWidth: 1, borderColor: m.border, padding: 10 }}
            />
          </Labelled>
          {error ? <text testId="recipe-error" style={{ fontSize: 12, lineHeight: 17, color: m.danger }}>{error}</text> : null}
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {draft.file ? <Button testId="recipe-delete" variant="danger" onPress={remove}><Label variant="danger">Delete</Label></Button> : null}
            <div style={{ flexGrow: 1 }} />
            <Button testId="recipe-cancel" onPress={() => setDraft(null)}><Label muted>Cancel</Label></Button>
            <Button testId="recipe-save" variant="solid" onPress={save}><Label variant="solid">Save</Label></Button>
          </div>
        </div>
      </Scroll>
    )
  }

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 14, paddingRight: 14, paddingBottom: 12, flexShrink: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 9, height: 38, paddingLeft: 12, paddingRight: 12, borderRadius: 19, backgroundColor: m.chipBg, borderWidth: 1, borderColor: m.border, flexGrow: 1, minWidth: 0 }}>
          <Icon name="search" size={16} />
          <input
            ref={inputRef}
            testId="recipes-input"
            value={query}
            placeholder="Recipes…"
            onChange={(e) => {
              setQuery(e.value ?? '')
              setActive(0)
            }}
            onSubmit={() => shown[active] && onUse(shown[active]!.name)}
            onKeyDown={listKeys}
            style={{ flexGrow: 1, minWidth: 0, fontSize: 13.5, color: m.text }}
          />
        </div>
        <Button testId="recipe-new" onPress={() => edit()} title="New recipe" style={{ height: 38, paddingLeft: 12, paddingRight: 14, borderRadius: 19, borderWidth: 1, borderColor: m.border, gap: 6 }}>
          <Icon name="plus" size={14} />
          <Label>New recipe</Label>
        </Button>
      </div>
      <Scroll style={{ flexGrow: 1 }} padding={6}>
        {shown.length === 0 ? (
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <text style={{ fontSize: 13, lineHeight: 18, color: m.textMuted }}>{recipes.length ? `No recipes match “${query.trim()}”.` : 'No recipes yet.'}</text>
            {recipes.length ? null : <Meta>Save a prompt as a recipe. Run it with $name.</Meta>}
          </div>
        ) : null}
        {groups.map(([scope, rs]) => (
          <div key={scope} style={{ display: 'flex', flexDirection: 'column', gap: 1, paddingBottom: 8 }}>
            <div style={{ paddingLeft: 10, paddingTop: 6, paddingBottom: 4 }}>
              <text style={{ fontSize: 11, lineHeight: 14, color: m.textFaint, fontWeight: 500 }}>{scope === 'yours' ? 'Yours' : 'This project'}</text>
            </div>
            {rs.map((r) => {
              const i = shown.indexOf(r)
              return (
                <Row key={r.file} selected={i === active} onPress={() => onUse(r.name)} testId={`recipe-${r.name}`}>
                  <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0, paddingTop: 5, paddingBottom: 5 }}>
                    <text style={{ fontSize: 13, lineHeight: 17, color: m.textUi, fontFamily: font.mono, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{`$${r.name}`}</text>
                    <text style={{ fontSize: 11.5, lineHeight: 15, color: m.textFaint, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{r.description ?? r.body.split('\n')[0]}</text>
                  </div>
                  {r.mode ? <Meta>{modeOptions('yours').find((o) => o.value === r.mode)?.label ?? r.mode}</Meta> : null}
                  <Button testId={`recipe-edit-${r.name}`} onPress={() => edit(r)} title={`Edit $${r.name}`} style={{ width: 26, height: 26, paddingLeft: 0, paddingRight: 0, borderRadius: 13 }}>
                    <Icon name="pencil" size={13} />
                  </Button>
                </Row>
              )
            })}
          </div>
        ))}
      </Scroll>
      <div style={{ paddingLeft: 16, paddingBottom: 12, paddingTop: 6, flexShrink: 0 }}>
        <Meta>{keys('↩ insert · $ find recipes')}</Meta>
      </div>
    </>
  )
}

function Labelled({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  const m = useM()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <text style={{ fontSize: 12, lineHeight: 16, fontWeight: 500, color: m.textUi }}>{label}</text>
      {children}
      {hint ? <text style={{ fontSize: 11.5, lineHeight: 15, color: m.textFaint }}>{hint}</text> : null}
    </div>
  )
}
