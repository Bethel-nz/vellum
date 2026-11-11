# Vellum design direction

Vellum is a markdown note you can talk to. Prompts, agent responses, terminal
sessions, file changes, and captures belong to one readable document. The
interface should make the work easy to follow and the next action clear.

This brief describes the product direction, materials, and shared design tokens.
Use tokens consistently so surfaces remain coherent in either appearance.

## The document is the interface

Keep the note at the centre of the experience. A conversation should read as a
continuous page with a clear sequence of requests, actions, and results. Place
tools and supporting information beside the work they explain.

Use space, typography, and restrained separators to establish hierarchy. Avoid
turning each message, result, or piece of metadata into a separate card. Keep
prose within the reading width supplied by the theme; wider terminal and diff
content can use the room it needs.

The composer is the document's final paragraph. Its textarea is transparent and
borderless, with the strongest text contrast reserved for the draft and prose.
Keep the draft intact when moving between surfaces. Only an explicit send clears
it, and streaming output must preserve composer focus.

## Quiet structure, clear state

Give each surface one focal point. Navigation provides orientation; status
explains what is happening; controls name the outcome of an action. Supporting
chrome should leave room for reading and writing.

Use the opaque dark and light materials from the theme. Import colour, spacing,
radius, typography, and elevation tokens. Nested surfaces use concentric corners
and a single elevation treatment. Avoid decorative effects that compete with
the note.

Reserve accent colour for agent and skill identity. Use blue for links,
permissions, and selection, and semantic colours for meaningful status. Keep
functional labels readable in both materials. Use tabular numerals for changing
values and provide a full-value path for truncated text.

## Materials and design tokens

Dark and light use the same token roles. Both materials are opaque. The dark
palette uses near-black surfaces and violet identity colour; light uses a white
page, an off-white surround, and near-black prose. Keep identity, selection,
focus, syntax, and terminal colours distinct.

Values below define the palette; components consume shared tokens rather than
repeating colour literals. Functional text uses `textMuted` or brighter.
`textFaint` is reserved for decorative separators, tracks, and inactive dots.

| Token | Dark | Light | Role |
|---|---|---|---|
| `rootTint` | `#0a0a0a` | `#ececef` | Window surround |
| `pane` | `#141414` | `#ffffff` | Document surface |
| `paneHighlight` | `#ffffff0f` | `#ffffff` | Inset highlight |
| `titleBar` | `#0c0c0c` | `#ececef` | Navigation band |
| `panel` | `#111111` | `#f7f7f8` | Supporting surface |
| `popup` | `#1c1c1c` | `#ffffff` | Popover surface |
| `popupHover` | `#26262a` | `#f0f0f3` | Popover row hover |
| `text` | `#e5e5e5` | `#171717` | Prose and draft |
| `textUi` | `#d4d4d4` | `#27272a` | Chrome labels |
| `textMuted` | `#9d9d9d` | `#57575f` | Supporting labels |
| `textFaint` | `#4d4d4d` | `#57575f80` | Decorative marks only |
| `border` | `#ffffff09` | `#00000014` | Surface hairline |
| `borderFaint` | `#141414` | `#00000008` | Secondary separator |
| `borderFocused` | `#2e2e32` | `#00000029` | Focused border |
| `hover` | `#2c2c2c` | `#0000000d` | Hover wash |
| `pressed` | `#363636` | `#00000014` | Pressed wash |
| `selected` | `#363636` | `#00000014` | Selected row |
| `scrim` | `#00000080` | `#0000001f` | Sheet backdrop |
| `codeBg` | `#1c1c1c` | `#0000000a` | Code surface |
| `accent` | `#BBB0FF` | `#693acf` | Agent and skill identity |
| `blue` | `#7aa2f7` | `#1447e6` | Links, permission, selection |
| `focusRing` | `#7aa2f7aa` | `#1447e699` | Keyboard focus |
| `selection` | `#7aa2f744` | `#1447e633` | Text selection wash |
| `lineWash` | `#7aa2f728` | `#1447e61a` | Source-line preview wash |
| `chipBg` | `#242424` | `#0000000a` | Context reference background |
| `skillBg` | `#BBB0FF1a` | `#8040b014` | Skill reference background |
| `success` | `#9ece6a` | `#2f8a5b` | Successful state |
| `warning` | `#f8ca73` | `#8a6200` | Attention needed |
| `danger` | `#fe6767` | `#c2453a` | Destructive or failed state |
| `dangerBg` | `#fe676714` | `#c2453a12` | Error background |
| `diffAdd` | `#9ece6a26` | `#1a7f3720` | Added-line wash |
| `diffDel` | `#fe676726` | `#cf222e1c` | Removed-line wash |
| `diffHunkBg` | `#ffffff06` | `#00000006` | Hunk header wash |
| `termBg` | `#0a0a0a` | `#00000006` | Terminal background |
| `termFg` | `#e5e5e5` | `#2a2a30` | Terminal foreground |
| `termCursor` | `#BBB0FF` | `#171717` | Terminal cursor |
| `scrollbar` | `#242424` | `#0000001f` | Scroll thumb |
| `scrollbarHover` | `#363636` | `#00000033` | Scroll thumb hover |

Primary controls use their own action tokens:

| Action token | Dark | Light |
|---|---|---|
| `action.background` | `#BBB0FF` | `#171717` |
| `action.hover` | `#d4ccff` | `#27272a` |
| `action.pressed` | `#a89ee6` | `#57575f` |
| `action.text` | `#141414` | `#ffffff` |

### Typography and geometry

Use Geist for interface and prose, and Geist Mono for code. Sans and mono
fallbacks are Inter and SF Mono. A compatible terminal font can supply terminal
cells and file glyphs; preserve alignment when falling back to the bundled mono
face. Use size, weight, and leading to establish hierarchy, without tracking.

| Type token | Size / leading (px) |
|---|---|
| `body` | 14 / 22 |
| `user` | 14.5 / 23 |
| `meta` | 11.5 / 16 |
| `title` | 15 / 22 |
| `titleLg` | 17 / 23 |
| `label` | 12.5 / 16 |
| `caption` | 10.5 / 14 |
| `badge` | 10.5 / 12 |
| `mono` | 12 / 18 |

| Geometry token | Value (px) |
|---|---|
| `shellInset` | 4 |
| `radiusBase` | 10 |
| `radiusXl` | 14 |
| `windowRadius` | 18 |
| `headerHeight` | 36 |
| `contentInset` | 52 |
| `readingWidth` | 720 |
| `scrollbarWidth` | 4 |
| `scrollbarInset` | 4 |

Nested corners share a centre: `concentric(parent, inset)` subtracts the inset
from the parent radius, clamped at zero. Apply one elevation per surface through
the shared helper: popover offset/blur 4/12 at 45% of material shadow strength,
card 8/20 at 60%, and sheet 18/48. Focus rings are 2 px with a 1 px offset.

### Terminal and code palettes

Keep the 16 ANSI positions in order: black, red, green, yellow, blue, magenta,
cyan, white, followed by their bright variants. Terminal colours belong to ANSI;
file glyphs use that palette, while code tokens use syntax colours.

| ANSI position | Dark | Light |
|---|---|---|
| 0: black | `#141414` | `#2a2a30` |
| 1: red | `#fe6767` | `#b4372d` |
| 2: green | `#9ece6a` | `#1f7a4a` |
| 3: yellow | `#f8ca73` | `#8a6200` |
| 4: blue | `#7aa2f7` | `#2457c5` |
| 5: magenta | `#BBB0FF` | `#8040b0` |
| 6: cyan | `#7dcfff` | `#1a7680` |
| 7: white | `#e5e5e5` | `#6c6c74` |
| 8: Bright black | `#4d4d4d` | `#57575f` |
| 9: Bright red | `#ff8f8f` | `#c94a3f` |
| 10: Bright green | `#C8E997` | `#2a8f59` |
| 11: Bright yellow | `#FFA86B` | `#9c7000` |
| 12: Bright blue | `#a3bffa` | `#3468d6` |
| 13: Bright magenta | `#f6a9ff` | `#9352c2` |
| 14: Bright cyan | `#b3e8ff` | `#218791` |
| 15: Bright white | `#ffffff` | `#3a3a40` |

| Syntax token | Dark | Light |
|---|---|---|
| `keyword` | `#ff678d` | `#d32a61` |
| `function` | `#9d6afb` | `#693acf` |
| `string` | `#5ecc71` | `#199f43` |
| `comment` | `#737373` | `#737373` |
| `number` | `#68cdf2` | `#1ca1c7` |
| `typeName` | `#d568ea` | `#a631be` |
| `constant` | `#ffd452` | `#d5a910` |
| `tag` | `#ff855e` | `#d5512f` |
| `variable` | `#ffa359` | `#d47628` |
| `punctuation` | `#636363` | `#636363` |
| `link` | `#9d6afb` | `#693acf` |
| `special` | `#ffab16` | `#d5901c` |
| `operator` | `#08c0ef` | `#08c0ef` |
| `parameter` | `#a3a3a3` | `#636363` |
| `attribute` | `#60d199` | `#18a46c` |
| `escape` | `#61d5c0` | `#16a994` |

## Navigation and orientation

Thread navigation should make the current page, workspace, and active agent
easy to identify. Titles should describe the work, with supporting context
available when similar titles need disambiguation.

Keep frequent actions within keyboard reach. The command palette, thread
switcher, new-note action, and close controls should behave consistently. A
background thread can indicate unread or running work without interrupting the
current draft.

## Context stays close to the request

File, folder, and skill references should be easy to insert, inspect, and remove.
Keep their stored text understandable and make their scope explicit. A reference
to a line should reveal the relevant source with its path and line number.

Previews should explain the reference without displacing the document. Use an
anchored popover for brief context and a dedicated pane when the content needs
sustained reading. Make the full file accessible from a limited preview.

## Agent activity remains readable

Keep prompts, tool calls, permissions, and results in their chronological place.
A tool row should say what is happening and expose details when needed. Errors
belong beside the affected action and should explain a recovery step.

Streaming and completed output share the same block structure. Paint incoming
content promptly, grow at natural ends, and keep streaming text still. Preserve
the reader's position when they move away from the latest output.

Permission requests should make the proposed action and its scope clear before
the decision. Loading and confirmation feedback stay close to the control that
caused them.

## Terminals and changes are part of the work

Inline terminals belong beside the request that started them. Keep commands,
output, and completion state legible. A separate persistent terminal supports
ongoing shell work and CLI handoff when that workflow needs more space.

Diff review should make changed files, selected hunks, and the next action clear.
Keep paths readable, preserve code alignment, and use semantic addition and
deletion colours. Label actions with their result, such as “Add 3 hunks to
thread,” and let the resulting context remain editable before sending.

## Surfaces follow their purpose

Use anchored popovers for short interactions tied to a trigger. Clamp them to
the available window space, allow internal scrolling, and support Escape,
outside dismissal, and focus restoration.

Use an edge-docked sheet for extended review or settings. Use a floating panel
only when the task needs a persistent companion surface, with explicit close
controls and the dismissal behaviour defined in the interface contract.

Keep long content inside its surface. Narrow windows and enlarged text should
preserve access to controls and keep the document clear of the status row.

## Motion supports continuity

Use the shared motion helpers and tokens. Frequent interactions should respond
immediately; occasional surface changes may use a deliberate transition when it
helps explain the relationship between states.

Keep motion interruptible. Keyboard actions respond immediately, streaming text
stays still, and reduced motion preserves layout and feedback. Animate only
width, height, opacity, edge positions, and border radius through the shared
helpers. Use enter, exit, standard, in-out, material, and spring easing tokens;
keep hover and press feedback at 100 ms. Duration tokens are instant 120 ms,
fast 160 ms, exit 180 ms, standard 240 ms, and considered 480 ms. High-frequency
surfaces enter within 160 ms and close immediately; keyboard actions remain
immediate. Reduced motion collapses transition duration to zero.

## Accessible, precise interaction

Every pointer action needs a keyboard path. Give icon controls accessible names,
make focus visible, and restore focus when temporary surfaces close. Sending uses
`⌘↵`; Enter inserts a newline. Keep shortcut hints consistent with actual
behaviour.

Define empty, loading, disabled, and error states at the point of interaction.
An empty surface needs one honest explanation and a useful next step. Write in
quiet, precise language: present tense, concrete actions, and no unnecessary
celebration.

Evaluate interface changes in both materials, at narrow widths and enlarged
text, with keyboard navigation and reduced motion. Keep design decisions
connected to the behaviour of the working app.
