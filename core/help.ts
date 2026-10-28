// The Help note: how Vellum works and every key, as a note of its own. It opens once, the first
// time Vellum runs, and from the Help button in the strip after that. It isn't a file in threads/: Past
// notes and ⌘K never list it, the nine-tab limit doesn't count it, and nothing in it can be
// edited. Writing in it starts a new note with what you wrote (app.tsx `writeFromHelp`).

/** Its tab's id: never a real note's (those are `yyyymmdd-xxxxxx`). */
export const HELP_ID = 'vellum-help'

/** Written for macOS; platform.keys() rewrites the modifiers elsewhere. */
export const helpMarkdown = `Vellum is a note you talk to. You write; Claude answers on the same page, and its work (edits, commands, plans, questions) shows up in the note as it happens.

## Writing to Claude

| Key | What it does |
|---|---|
| ↵ or ⌘↵ | Send what you wrote |
| ⇧↵ | Start a new line |
| ⇧⇥ | Change the mode: Ask, Edits, Plan, Auto |
| @ | Tag a file, folder or skill |
| # | Tag a file; \`#path:42\` points at a line |
| $ | Run a recipe, a prompt you keep |
| ! | Run a shell command in the note's folder |
| ⌘V | Paste an image |
| ⌘. | Stop Claude |

Click any paragraph, yours or Claude's, to edit it. ⌘↵ then tells Claude what you changed.

## While Claude works

Keep writing. Under what you write there are two buttons:

| Button | What it does |
|---|---|
| Queue ⌘↵ | Claude picks it up next turn. It waits, faded, above what you write |
| Steer ⌥⌘↵ | Claude reads it now, in the turn it's running |

A queued message has Steer now and Remove under it until it goes.

## Answering Claude

| Key | What it does |
|---|---|
| ↵ | Allow what Claude asks to do |
| ⌘↵ | Always allow it |
| Esc | Deny it |
| 1–9 | Pick an answer to a question |

## Notes and tabs

| Key | What it does |
|---|---|
| ⌘N | Blank note in this project |
| ⌘O | Open a project folder |
| ⇧⌘W | Close the tab |
| ⌘1–⌘8 | Go to that tab; ⌘9 the last |
| ⌃⇥ ⌃⇧⇥ | Next or previous tab (also ⇧⌘] ⇧⌘[) |
| ⌘K | Search notes in the Library |
| ⌘Y | Past notes |
| ⇧⌘Y | Recipes |

The ticks down the left side are your paragraphs: hover one to preview it, click to go there.

## Around the note

| Key | What it does |
|---|---|
| ⇧⌘D | Changes: what Claude edited, to review or add to the note |
| ⇧⌘E | Files beside the note |
| ⌘, | Settings |
| ⇧⌘T | Show or hide the tab strip |
| ⇧⌘L | Dark or light |
| ⌘Esc | Back to writing |

The pencil icon on the right opens Annotations: captures from every note, grouped by page. Open a capture in its note, send it to another note, or resolve it by hand.

The terminal icon in the strip opens a terminal in its own tab. It keeps running when you quit Vellum.

## This note

It isn't kept with your notes, and nothing in it can be changed. Start writing below and a new note opens with what you wrote. Close it whenever you like; the Help button in the strip brings it back.`
