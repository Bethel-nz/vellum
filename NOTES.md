# Vellum notes

Findings, choices and deviations from the build prompt. Newest decisions win.

## Stack and versions

- Bun 1.4.3, TypeScript 7.0.2, React 19.3.1
- `@gpuix/react` **0.11.0** and `@gpuix/native` **0.11.0**, both pinned exactly in `package.json`
- `libghostty-vt-node` 0.1.0 (wasm build of libghostty-vt, upstream commit `4c6215bb`)
- `diff` 9.0.0 for unified patches
- `claude` 2.1.296 on macOS 27.0.1, Apple Silicon
- `@agentclientprotocol/claude-agent-acp` **0.95.0** (the agent) and `@agentclientprotocol/sdk` **2.0.2**
  (types only), both pinned exactly. ACP protocol v1; v2 is a draft (2026-07-20) and isn't used.

## Changes from the prompt

- **No sidebar** (asked for mid-build). Notes are reached with **⌘K** (switcher grouped by
  workspace, filter, ⌃N/⌃P, ↩).
- **The page is one editable note** (asked for after the first build). There is no input box and
  no chat log. Your paragraphs are borderless textareas you can edit at any time. Claude's replies
  render as markdown and turn into their markdown source when clicked (Esc or a click outside
  renders them again). Tool work (activity line, edits, terminals) sits between them as embeds.
  New writing goes in the last paragraph, which is the composer inside the virtual list. A textarea
  growing inside the list does remeasure its row (checked by eye). The list is top-aligned and
  follows the tail.
- **⌘↵** (was Ctrl+Enter until 2026-10-23) sends the new text at the end **plus a description of every edit** made to
  earlier paragraphs since Claude last saw them. Each edited block keeps `seen` (the text Claude
  saw). `vellum/edit` records change a block, and `vellum/synced` clears `seen` once the edits
  went out. Block ids are now numbered per thread (`u-0`, `a-1`, …), so replayed edits find their block.
- **Tab bar** across the top: open notes as tabs (icon,
  title, unread-reply badge, last-change time). The active tab shares the page colour. Then +,
  ⌘K and the material toggle. Under it sits the page title with a ⌄ menu: folder and account,
  Rename, Open in Claude Code, Show folder in Finder, Close tab. The account shows on the right.
  Shortcuts: ⌘N/⌘T new, ⇧⌘W close tab, ⌘1–⌘9, ⌘⇧[ / ⌘⇧], ⌃← / ⌃→ (macOS gives ⌃-arrows to Spaces by default; turn that off in Keyboard Shortcuts › Mission Control to use them here). Open tabs persist in `settings.json`.
- **Default profile uses Claude Code's own default config** (`configDir: null` → `CLAUDE_CONFIG_DIR`
  unset), so the account already logged in on this Mac works on first run. Profiles added in the
  app get `~/.vellum/profiles/<id>/claude/` with symlinks from `shared/`.
- **Inter**: the static `Inter-Regular/Medium/SemiBold/Italic.ttf` from the official v4.1 release
  are registered, not `InterVariable.ttf`. Each weight is its own family member, so `fontWeight`
  picks the right face. `InterVariable.ttf` is kept in `assets/fonts` for a later try.
- **Text tracking**: GPUI text has no letter-spacing, so hierarchy comes from size, weight and leading.
- **Login status**: the profile dot keeps its colour. "not logged in" appears in the account list
  after a headless run reports it. A `Not logged in` result renders an error block with a
  "Log in to this account" action.

## Spike results

### 1. Ctrl+Enter in `<textarea>`: pass

- Plain Enter is consumed by the textarea's own action (it never reaches `onKeyDown`) and inserts a newline.
- Ctrl+Enter reaches `onKeyDown`. `event.preventDefault()` there leaves no stray newline.
- Up/Down are also consumed by the textarea. Tab, Escape, Ctrl+N/P and every Cmd chord do reach `onKeyDown`.
  That's why the `@` popup moves with **⌃N/⌃P** and accepts with **Tab or ↩**. ↩ works by passing
  `onSubmit` to the textarea only while the popup is open.

### 2. Headless round trip: pass

Command: `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages`.

Event shapes seen on stdout:

- `system/hook_started`, `system/hook_response`, `system/hook_progress`: from the user's own hooks. Ignored.
- `system/init`: `session_id`, `cwd`, `model`, `tools`. **Emitted once per turn**, not once per process.
- `system/commands_changed`, `system/status`, `system/post_turn_summary`, `rate_limit_event`: ignored.
- `stream_event` (with `api_message_id`, `parent_tool_use_id`):
  - `message_start`
  - `content_block_start` (`content_block.type` text/thinking/tool_use)
  - `content_block_delta` (`text_delta`)
  - `content_block_stop`, `message_delta`, `message_stop`
- `assistant`: the complete message, `message.id` plus `content[]` (text / thinking / tool_use).
- `user`: `message.content[]` of `tool_result` (`tool_use_id`, `content`, `is_error`).
- `result`: `subtype`, `is_error`, `result`, `session_id`, `total_cost_usd`. A missing login comes back as
  `subtype: "success"`, `is_error: true`, `result: "Not logged in · Please run /login"`.

A second JSONL line on the same stdin runs a second turn. `--resume <session_id>` from a fresh
process continues the conversation with the same session id. That was verified again through the
app: two turns across a restart kept one session id (`scripts/check-live.ts`).

**`@path` is expanded by headless mode.** A prompt mentioning `@package.json` with tools disabled
quoted its `name` field. File and folder tags therefore stay in the prompt as `@path`. Skill tags
become `"<name>" skill` plus `Use the "<name>" skill for this.`

Cost note: on this machine one tiny turn costs about $0.3–0.7, because the user-level skills and
hooks are large context. That's what drives the `$` the live checks spend.

### 3. Profile isolation: partly verified, needs a human login

- A brand-new empty `CLAUDE_CONFIG_DIR` answers `Not logged in`, so the default login does not
  leak into other config dirs.
- The full A/B check (log B in, A stays logged in) needs two interactive logins:
  `sh spikes/profile-isolation.sh setup`, log in each dir, then `sh spikes/profile-isolation.sh check`.
  **Not run yet.** If the two collide, record it here; don't work around it.

### 4. libghostty in Bun: pass, using `libghostty-vt-node`

Chosen: **libghostty-vt-node** (option 1). It isn't N-API but wasm, which is fine in Bun. Its public
API only offers feed/format, but the wasm exports the whole C API, so `core/ghostty.ts` binds it
through the package's own loader (`VtModule`: memory, ABI manifest, opaque slots):

- `ghostty_render_state_*` → the per-cell grid (graphemes, style, resolved colours, cursor)
- `ghostty_key_encoder_*` → bytes for every key, honouring DECCKM, kitty flags and so on
  (verified: `↑` = `ESC[A`, or `ESC OA` after `ESC[?1h`; Ctrl+C = `0x03`; Backspace = `0x7f`; Alt+Backspace = `ESC 0x7f`)
- `ghostty_formatter_*` → plain text for "Send output to Claude" and "Show all"
- `GHOSTTY_TERMINAL_OPT_WRITE_PTY` → replies (DA, CPR) go back to the PTY. C callbacks in wasm
  are function-table indices, and a table only holds wasm functions, so a 40-byte hand-written
  wasm shim imports the JS handler and is placed in `__indirect_function_table`.
  Verified: `ESC[c` → reply `ESC[?62;22c`.

Not used: `ghostty-web`, `restty` (no need once option 1 worked).

## GPUIX findings

- **⌘W can't be taken.** GPUIX binds ⌘W natively to `gpuix_app::CloseWindow` (with ⌘Q, ⌘H, ⌥⌘H, ⌘M).
  Key actions run before JS handlers, and there's no option to unbind them, so ⌘W closes the only
  window and the app quits with exit 0 (`spikes/launch-exit.ts cmd-w`). Close tab is ⇧⌘W instead.
  An automation script that presses ⌘W then waits forever on the dead app.

- **One host root.** A fragment with two top-level host nodes made the second one the window root,
  and the whole document stopped painting. Dialogs now live inside the root `div`.
- A run of `<text>` siblings inside a block `div` stacks vertically. Terminal rows use
  `display: flex; flexDirection: row`, and each run is sized `cells × 0.6em` so spaces never collapse.
- `onFocus` / `onBlur` did not fire for a `tabIndex` div in a background (`focus: false`) window,
  even though `getFocusedElementId()` changed. The terminal tracks its focused state itself: click,
  `onMouseDownOutside`, ⌘Esc.
- Automation screenshots of a background window can catch a `motion.div` mid-fade, because frames
  are paced by the 100 ms fallback timer. Wait about 2 s before asserting on dialogs.
- `<diff>` still paints a faint `+N −M` in its top-right corner even with `diffFileHeaderHeight: 0`.
  It duplicates the block's own counts. Cosmetic, left for now.
- `<diff>`: the patch's own `---/+++` header is stripped, and `diffFileHeaderHeight` is 0, because
  the block's `Edit path +N −M` line already names the file.
- macOS reports `/var/...` as `/private/var/...` in tool paths, so paths are made workspace-relative
  against both the workspace and its realpath.
- `windowBackground: 'blurred'` cannot be seen in `app.screenshot()` (GPU surface only). The glass
  has to be judged by eye in the real window over a busy and a plain wallpaper. **Not done yet.**
  Tune `rootTint` / `pane` in `ui/theme.ts`.
- SF Mono is installed in `/Library/Fonts` on this Mac and is used by family name. Menlo is the fallback.

## Persistence

- `threads/<id>.jsonl` is the source of truth. It holds raw `claude` lines (hooks, status and
  rate-limit chatter filtered out) plus `vellum/*` records: meta, title, user, patch (real diff
  against the file before the tool ran), shell, shell-exit (frozen grid + text), error, stopped.
  Launch replays it through `reduce()`.
- `threads/<id>.md` is rewritten 400 ms after a change: frontmatter, transcript, ```diff and ```console fences.
- Interactive turns made in "Open in Claude Code" go to Claude's own session history, not into the
  Vellum document.

## Self-checks

- `bun scripts/screenshot.ts [dir]`: fixture thread, shell run, `@` popup, switcher, new-thread
  dialog. `MATERIAL=frost` and `VELLUM_SOLID=1` select the other looks.
- `bun scripts/check-note.ts`: two tabs, editing your own paragraph, editing a reply's source, the title menu.
- `bun scripts/check-terminal.ts`: typed input to `read`, Ctrl+C (exit 130), interactive `top` + `q` (exit 0).
- `bun scripts/check-pane.ts <home>`: "Open in Claude Code" (title menu) pane opens and closes.
- `bun scripts/check-live.ts`: **spends two real turns**. Streaming, write → edit block, Bash → shell
  block, restart + resume, and an in-place edit reaching Claude. Last run: the first paragraph was
  changed from blue to green after the restart, and Claude answered "Green; I created notes.txt."
  in the same session.

All four use a scratch `VELLUM_HOME` and `GPUIX_BACKGROUND=1`. `~/.vellum` is never touched.

## Security review (after the first commit)

- **Diff reads stay in the workspace.** `filePatch` (core/claude.ts) realpaths the target and reads it
  only if it lies inside the workspace's realpath and is at most 2 MB. Paths outside, `..` escapes and
  symlinks pointing out fall back to the snippet patch built from the tool input. Checked with an
  inside edit, a new file, an outside path, `ws/../x` and a symlink out.
- **Trust prompt.** Headless `-p` skips Claude Code's workspace trust dialog. The New thread dialog
  warns when the folder has `.mcp.json`, `.claude/settings.json` or `.claude/settings.local.json`,
  whose hooks and MCP servers would run without asking. It warns, it doesn't block. Not yet checked by eye.
- **Wasm buffers.** core/ghostty.ts gives each libghostty out-parameter its own allocation, sized from
  the ABI manifest. A grapheme cluster longer than 32 codepoints renders as U+FFFD instead of
  overflowing. Checked with `a` + 40 combining marks.
- **Paste.** ⌘V in a terminal goes through `ghostty_paste_encode`: unsafe control bytes become spaces,
  and the text is wrapped in `ESC[200~ … ESC[201~` when the program enabled mode 2004. That's read
  with `ghostty_terminal_get(MODE)`. An embedded `ESC[201~` is neutralised.

`scripts/check-terminal.ts` can flake under heavy load: if `top` hasn't drawn within 2.5 s, the `q`
arrives too early. Re-run it before reading anything into that.

## Not built (out of scope or stretch)

- Changes panel (`git diff --stat`), cursor glow, aurora wash
- Interactive permission approval (commands that need approval fail and show in the activity line)
- Mouse reporting in the terminal (clicks inside htop/vim)

## 2026-10-23 — chrome: menu in the strip, History, no traffic lights, ⌘↵

- The page title row is gone. The current tab pill is the title: it carries a chevron and
  pressing it opens the note menu (rename, open in Claude Code, Finder, close), anchored beside
  the tab button rather than inside it so presses in the menu never reach the tab.
- Tabs stop at nine (one per ⌘1–⌘9). Opening a tenth closes the oldest tab Claude isn't working
  in, with a toast. Everything else is in **History** (⌘Y or the clock at the strip's left): a
  left sidebar of every note, newest first, grouped Today / Yesterday / This week / This month /
  Earlier, with a filter that has focus as it opens.
- No traffic lights, and no setting for them: the window is keyboard-driven (⌘Q, ⇧⌘W, ⌘M).
  GPUIX can't hide them, so `trafficLightX/Y` put them at -200. Still not verified by eye on a
  real window (headless screenshots never show them).
- Send is **⌘↵** everywhere (composer, edited paragraphs, `!` commands). ⌃↵ no longer sends.
- ⌃← / ⌃→ cycle tabs.
- Titles: the first paragraph gets a word-cut provisional title, then `claude -p --model haiku`
  with nothing loaded (`--setting-sources '' --strict-mcp-config --tools '' --disable-slash-commands
  --no-session-persistence` and a one-line system prompt) names it in 2–6 words: about $0.0003 and
  6s (spikes/title-haiku.ts). Not Gemini: that would need a Google API key and a second
  dependency, and this stays on the official binary and your login. `--bare` is no use here: it
  accepts only an API key, never the subscription login.

## 2026-10-23 — approvals, mode, thinking (official CLI control channel)

> Superseded by the ACP entry below: the control channel and `claude -p` are gone.

UI-FIXES §0b asks to move to the ACP adapter. That conflicts with hard constraint #1 (only the
official `claude` binary), so Vellum stays on `claude -p` and uses the CLI's own control
channel, which does the same job:

- Spawn with `--permission-prompts host --permission-prompt-tool stdio`, then send
  `control_request {subtype:'initialize', hooks:null}` first.
- An ask arrives as `control_request {subtype:'can_use_tool', tool_name, display_name, input,
  permission_suggestions}`. Answer `control_response {subtype:'success', request_id, response:
  {behavior:'allow', updatedInput, updatedPermissions?}}` or `{behavior:'deny', message}`. The
  deny message reaches Claude as the tool's error ("Okay, I won't. (use vitest instead)").
- `set_permission_mode {mode}` switches live. Modes: manual (Ask), acceptEdits (Edits, the
  default), plan, auto, dontAsk, bypassPermissions (Full access, shown in warning yellow). ⇧⇥
  cycles Ask → Edits → Plan → Auto; the pill's menu has all six.
- Thinking: `set_max_thinking_tokens {0}` turns it off live. Max is `--effort max`, a spawn flag,
  so changing it restarts the idle process (or right after the running turn) and the next turn
  resumes the session. The pill is Think / Think ∴ / faint Think.
- Asks live only as long as their process. A result, exit or `control_cancel_request` drops
  them. Answers are recorded (`vellum/answer`) and stay in the note as one line; mode and think
  are `vellum/mode` / `vellum/think` and are re-applied at spawn.
- **Card, not block.** UI-FIXES §5b draws the ask as a block in the document. Your later ask
  ("approval modal can come up from the bottom right like the family money card") wins: a card
  rises into the pane's bottom-right corner, and only the resolved line goes in the document.
  With the composer empty, ↵ allows, ⌘↵ always allows (only when the CLI offers a rule), and esc
  opens "what to do instead". A GPUIX textarea delivers plain ↵ to `onSubmit`, not `onKeyDown`.
- A background note with an ask gets the blue tab box and a toast.
- `scripts/check-approval.ts` runs against `scripts/fake-claude.ts` (a `claude` shim on PATH that
  speaks the same protocol), so the whole flow is checked without a paid turn.

## 2026-10-23 — GPUIX findings and spikes from the components pass

- **`motion.div` keeps presses to itself**, so a parent button behind it never gets the click.
  Give the motion.div `pointerEvents: 'none'` and any button inside it `'auto'`. This was why
  the centred tab boxes didn't respond. It also takes only children, style, mouse handlers and
  motion props: no testId, tabIndex or onKeyDown, so put those on a plain div around or inside it.
- **Animating `top` overrides `bottom`** on the same element. Anchor to a corner with a plain
  absolute box and animate a relative child (the approval card).
- **No rotation, no dotted borders.** Open states change colour instead of turning a chevron,
  and references use a dashed rule.
- **Inline text spans don't exist**: a nested `<text>` breaks onto its own line
  (spikes/inline-chips.tsx). A read paragraph is a wrapping row of words and reference boxes.
- **Code fences**: the markdown header band stays even with `mdCodeHeaderTextSize: 0`, and a
  bare fence loses highlighting (spikes/code-header.tsx). Replies split on fences
  (core/fences.ts) and draw code with `<code>` in their own card, with copy on hover via `pbcopy`.
- **Diff headers**: at height 0 the native file and hunk header text still paints over the first
  row. `DiffCard` keeps real heights and clips them off the top.
- **Nerd Font glyphs** draw only when the `<text>` names `Liga SFMono Nerd Font`
  (spikes/nerd-icons.tsx). Geist Mono shows tofu.
- **Textarea keys**: plain ↵ goes to `onSubmit`, not `onKeyDown`. ⌘↵ and esc reach `onKeyDown`.
  An autofocused textarea never fires `onFocus`.
- **Automation**: a positive `mouse.wheel` deltaY scrolls toward the top, and the composer
  swallows the wheel, so scroll over the document. Headless (`GPUIX_BACKGROUND=1`) windows tick
  animations slowly, so screenshots right after an open catch a panel mid-fade; that's not a
  bug.
- **Cost**: each real headless turn in a spike costs about $0.40, because the user's hooks and
  plugins load into every session. Approval checks use scripts/fake-claude.ts instead; titles use
  the lean flags above (~$0.0003).

## 2026-10-23 — your picture, and Windows and Linux

- **Who wrote what.** Your paragraphs get a 16px picture in the left gutter and "You · 14:03" on
  hover; Claude's get nothing, so the page still reads as one note. The picture is the system's
  account picture, a profile's `avatarImage` overrides it, and with neither it's a monogram on
  the violet wash. GPUIX doesn't clip an `<img>` to its parent's radius, so the image carries
  its own `borderRadius`.
- **One module per OS difference** (core/platform.ts). macOS stays the first target; elsewhere
  it's the nearest native equivalent or a quiet fallback:

  | | macOS | Windows | Linux |
  |---|---|---|---|
  | command key | ⌘ | Ctrl | Ctrl |
  | tab cycling | ⌃← ⌃→ | Ctrl+PgUp/PgDn | Ctrl+PgUp/PgDn |
  | leave a terminal | ⌘Esc | Ctrl+` | Ctrl+` |
  | app keys inside a terminal | ⌘ | Ctrl+Shift | Ctrl+Shift |
  | clipboard | pbcopy/pbpaste | PowerShell Set-/Get-Clipboard | wl-copy, xclip or xsel |
  | show folder | open | explorer | xdg-open |
  | `!` commands | `$SHELL -lc` | `%ComSpec% /d /s /c` | `$SHELL -lc` |
  | login, Open in Claude Code | inline PTY | its own console window | inline PTY |
  | light/dark | `defaults` | registry `AppsUseLightTheme` | gsettings |
  | reduce motion | `defaults` | settings sheet only | gsettings `enable-animations` |
  | account picture | `dscl` JPEGPhoto | monogram | ~/.face, AccountsService |
  | window chrome | no titlebar, lights off-window | system title bar | system title bar |
  | shared config into profiles | symlinks | junctions, hard-linked files | symlinks |

  Shortcut labels are written the macOS way and translated by `keys()` in Kbd, tooltips and
  button labels ("⇧⌘W" → "Ctrl+Shift+W"). Ctrl is the command key off macOS, so the window
  handler now skips keys a field already handled (Ctrl+N in a picker is not "new note").
- **Why a console on Windows**: Bun's PTY (`spawn({ terminal })`) is POSIX only and fails with
  ENOTSUP there. `claude` is resolved with `Bun.which` so PATHEXT finds claude.exe or .cmd.
- **Why the system title bar off macOS**: with a transparent titlebar, Windows and Wayland expect
  the app to draw its own close/maximize buttons and drag area, and GPUIX exposes neither.
- **Fonts**: nothing is bundled beyond Geist and Inter. File icons need a Nerd Font, found by
  file name in the OS font folders and read from the `name` table (core/fonts.ts, 7ms); without
  one they're a plain file icon. The terminal uses Liga SFMono Nerd Font when it's installed and
  Geist Mono (600/1000 advance) otherwise.
- **Paths**: `relPath` returns forward slashes on every OS, since the UI and the diffs split on
  '/'. `shortPath` takes either separator.
- **Unverified**: only macOS was run. The Windows and Linux branches were exercised by faking
  `process.platform` (labels, keys, shell argv), not on a real machine. GPUIX ships
  linux-x64-gnu and win32 x64/arm64 builds.

## 2026-10-23 — the status bar: mode, thinking, model, context, compacting

- **Bottom-left, small, upward.** The mode and thinking left the composer for a status bar in
  the note's bottom-left corner (ui/StatusBar.tsx): the mode as an icon (shield Ask, pencil
  Edits, checklist Plan, bolt Auto, ban Don't ask, open lock Full access in amber), thinking as a
  bulb (faint off, plain on, accent with a dot at max), the model as its short name, context as
  a ring with the count. Names live in tooltips and menus. Everything opens upward from there,
  the approval card included (it moved from bottom-right to just above the bar); the toast moved
  to bottom-right. Menus above their trigger now stagger rows bottom-up, from the trigger
  outward; that was the "opens top to bottom" feel.
- **Models come from the CLI.** `initialize` answers with the account's list (`value`,
  `displayName`, `description`, `resolvedModel`; Fable only with usage credits). Vellum caches
  it per profile in ~/.vellum/models.json, so the switcher has it before a session's first turn,
  and falls back to default/opus/sonnet/haiku. A pick is `vellum/model`: `set_model` on a live
  process, `--model` at the next spawn; "default" means no flag (spikes/models-usage.ts).
- **Context** is the last top-level reply's `input + cache_creation + cache_read + output`
  tokens, against `modelUsage[model].contextWindow` from the result (haiku and opus report 1M
  on this account). The ring turns amber at 70% and red at 90%.
- **Compacting** is `/compact` sent as a stream-json user turn of its own (no paragraph of
  yours, `vellum/compact` marks it running). The CLI answers `system/compact_boundary` with
  `pre_tokens` and `post_tokens`, so the ring drops at once, and the note gets a hairline fold:
  "Claude summarized everything above · 24k tokens before". Auto-compaction lands the same line
  with "Context was full". It cost $0.001 on haiku (spikes/compact.ts).
- fake-claude answers `initialize` with two models, honours `set_model`, reports usage and a
  200k window, and answers `/compact` with a boundary, so check-approval covers all of it.

## 2026-10-23 — hunks as ± pills, with comments on their lines

- **A hunk is a tag, not pasted diff.** "Add n hunks" in Changes used to drop a ```diff fence
  into the draft. Now each hunk becomes a `hunk` tag: the token `±ui/theme.ts:1` (path and new
  start line, `~2` if taken) in the text, and a pill in the chip row and in the sent paragraph:
  ±, file glyph, name, +n −m in the diff colours, and a blue comment count. Hovering the pill
  opens the hunk (the same Pierre `<diff>`, clipped to 12 lines) with its comments under it.
  The tag carries the patch itself, so the pill still means the same thing after more edits.
- **Comments on lines.** In Changes, clicking a line of a hunk (`<diff onLineClick>` gives the
  line text and its old/new numbers; only an old number means a removed line) opens a field
  under that hunk; ↵ saves, esc leaves the field without closing the sheet. A comment selects
  its hunk; the header counts comments; × removes one. GPUIX can't highlight a single diff row,
  so the comment list says `−2` / `+3` instead of marking the line.
- **What Claude reads** (`promptFor`): the token becomes "hunk 1 (ui/theme.ts)" in your
  sentence, and after the text: "Hunk 1, from an edit you made to ui/theme.ts:", the diff with
  its ---/+++ lines, then "My comments on its lines:" one per line with the code quoted. You
  write what to do around the pills ("revert ±… but keep the comment").
- Checks: core/changes.test.ts (token, prompt, duplicate tokens); check-changes now comments on
  the removed line, adds, and hovers the pill. drafts.json is written 300ms after a change, so
  the check polls for it.

## 2026-10-23 — + asks where

- **The bug**: "new note, picked a folder, still the old one". The strip's + never opened the
  dialog: it made a note in the current note's folder and account straight away (brief v2 §5).
  Only ⌘N / ⌘T and the empty state asked. The picker itself was fine (`promptForPaths` returned
  the folder and the note got it; checked with a logged run).
- **Now** + opens New note like ⌘N, starting on the current note's folder and account, so the
  same folder is still one press of Create. A folder past the five recent rows still shows as
  selected (it used to be selected but invisible).
- `bun scripts/check-new-note.ts`: + makes nothing until Create, Create uses the current folder
  and account, a picked recent folder is used. check-tabs now expects + to ask.

## 2026-10-24 — Vellum speaks ACP

The earlier build refused UI-FIXES §0b (move to the ACP adapter) because of the "only the official
binary" rule. That was the wrong call: you asked for ACP, and it's what lets Codex and opencode in
later. The rule's intent still holds: the adapter runs your installed `claude` through the Claude
Agent SDK (`CLAUDE_CODE_EXECUTABLE`), with your login, per account through `CLAUDE_CONFIG_DIR`.

- **Shape.** `core/acp.ts` is a plain JSON-RPC-over-stdio connection, agent-agnostic. `core/agent.ts`
  is one adapter process per open note (`bun …/claude-agent-acp/dist/index.js`): initialize →
  `session/new`, or `session/resume` when the note has a session (no replay: the .jsonl already has
  it). The SDK package is used for types only; the transport is ours.
- **Log.** The .jsonl now holds `acp/session`, `acp/update` (every session/update except the
  slash-command list and config echoes) and `acp/end` (stopReason). The reducer maps them to the
  same blocks as before, so older `claude -p` notes still replay. Edit diffs come from the tool's
  own `structuredPatch` (real line numbers); before that, the agent's old/new text.
- **Mode, model, effort** are the session's config options, set live with
  `session/set_config_option`: no respawn for thinking any more. Think off/on/max is effort
  low/default/max. Mode `manual` is the adapter's `default`. The agent's starting values (the
  adapter starts in `auto` when ~/.claude says so) never overwrite your pick.
- **Asks** are `session/request_permission`, answered with one of its options. The always button
  shows the agent's own words ("Don't ask again for bun test commands", "Auto-accept edits"),
  because that is exactly what gets applied. ACP's reject has no reason field, so the note you
  write goes in as your next message; the adapter queues it.
- **Titles** come from the agent (`session_info_update`) and replace only the word-cut title.
  The separate `claude -p --model haiku` naming call is gone (core/title.ts removed).
- **Account identity** arrives as `_auth/status_update` (email, plan) and is kept on the profile.
- **Closing a tab ends its agent.** Each adapter process brings its own claude, so closed tabs no
  longer pile up processes.
- **One writer per session** (core/locks.ts), ahead of the shared history. Before a resume,
  Vellum reads every account's `sessions/<pid>.json` (Claude's own registry: pid, sessionId,
  procStart) and refuses if a live process other than ours has the session open, naming where
  (terminal, Desktop, an SDK host). `~/.vellum/locks/<sessionId>` keeps two Vellum windows apart.
- Checks: `bun run test` (core only),
  core/acp-reduce.test.ts replays a real turn (fixtures/acp-turn.jsonl, sanitized from
  spikes/acp-turn.ts). check-approval runs against scripts/fake-acp.ts (`VELLUM_AGENT`).
  check-live passed through the real adapter: one session across a restart, notes.txt written,
  `cat` run, and "Green; I created notes.txt." after the paragraph was edited. Two turns, 22 s
  and 11 s.
- `spikes/out/` is git-ignored: raw traces carry the account's email.

## 2026-10-24 — logging in, through the agent

- **Who an account is**: `claude auth status --json` under its `CLAUDE_CONFIG_DIR` (core/auth.ts).
  No model turn, about 200 ms; it exits 1 with `loggedIn: false` for an empty config dir. Every
  account is checked at launch and after a login or logout, and keeps `email` and `plan`
  ("Claude Pro") on its profile.
- **Log in** is ACP's terminal authentication: the agent lists its methods at initialize (the
  adapter offers `claude-ai-login` and `console-login`), and Vellum runs the agent again with the
  method's args (`--cli auth login --claudeai`, which the adapter hands to your claude) in the
  inline terminal. When it exits, the account is checked again and a toast says who is in; no
  more typing /login and /exit. The pane's header reads `claude auth login --claudeai`. Windows
  has no PTY: the login gets its own console window and Vellum polls the status every 3 s.
- **Log out** ends the agents of that account's notes first, then `--cli auth logout`.
- **Settings › Accounts**: each account with its email and plan (or "Not logged in"), Log in or
  Log out, and Add account (which checks the new one at once).
- **"Open in Claude Code" ends the note's agent** before the interactive claude resumes the
  session. Interrupting it, as before, left the ACP process holding the session open.
- `bun scripts/check-login.ts` runs it against scripts/fake-acp.ts, which also plays
  `--cli auth login|logout|status` with a marker file per account, behind a `claude` shim on PATH.
- check-approval failed once in four runs with an uncaught automation timeout (the background
  window ticking slowly, as noted above), and passed the other three.
- **Not verified with a real login yet.** The real flow opens the browser; it needs a person.
- **Login identity.** Vellum uses the official login: the CLI performs OAuth, the
  Keychain holds tokens, and the CLI refreshes them. Account handling includes:
  - **Same login twice.** Accounts are keyed by identity. A browser still signed in to one account
    hands that account to the next login, so Settings flags the later of two accounts with one
    email ("Same login as Default…") and the login's toast says so.
  - **`--email` on a login again.** A logged-out account keeps its last email, and its next login
    passes `--email` (claude's own flag) so the browser asks for that account. This is an addition
    to the ACP method's args.

## 2026-10-24 — accounts share ~/.claude

- **Linked, not copied** (core/accounts.ts). Each Vellum account's config dir links these to
  ~/.claude: settings.json, settings.local.json, CLAUDE.md, history.jsonl, skills, agents,
  commands, output-styles, plugins, themes, projects, file-history, session-env, todos, plans,
  paste-cache. Per account: .claude.json (login identity, MCP, trust), credentials, sessions/
  (live process registry), caches, telemetry. An allowlist: new things Claude adds stay private.
  Nothing is created in ~/.claude ahead of time.
- **The link check** runs at launch and before every agent start. An entry that isn't a link to
  ~/.claude is merged in first, then linked: JSON deep-merged (permission lists combined, the
  newer file wins a clash, and ~/.claude's file is only rewritten when the merge adds something),
  .jsonl lines combined, folders merged entry by entry, other files keep the newer non-empty copy.
  What was replaced goes to ~/.vellum/backups/<account>/; a link's old target (the retired
  ~/.vellum/shared) is copied, never moved. A toast says what was merged.
- **MCP servers** (user scope, `mcpServers` in .claude.json) are combined into an account's
  .claude.json before its agent starts, from ~/.claude.json and every other account. Only that
  key of that file is written, and only then, when no claude of that account runs. A name set up
  differently on two accounts: the most recently changed file wins, with a toast. Project-scoped
  MCP (`projects[path].mcpServers`) isn't merged yet.
- ~/.vellum/shared is retired (left on disk; nothing reads it).
- Checks never touch the real ~/.claude: every check script sets `VELLUM_CLAUDE_HOME` to a scratch
  folder. Confirmed with a listing and checksums of ~/.claude before and after a run of four checks.
- core/accounts.test.ts: 9 cases (fresh link, idempotent, old shared link, settings that became a
  real file, session lines from both sides, mergeJson, MCP merge, no needless rewrite, a folder
  only the account has).
- **Not done yet:** relinking the real `work` account. Doing it from the session was blocked by
  the permission check; it happens on the next launch of Vellum (with a toast), or by hand.

## 2026-10-24 — scrollbars, menu shadows, line ranges in hunks

- **Scrollbars.** GPUIX counts a scroll box's own padding as overflow: a padded box over three
  short rows paints a full-length thumb, right on the rows' edge (spikes/scrollbar.tsx).
  `components/Scroll.tsx` keeps padding on an inner column that never shrinks, with a right
  gutter for the 6px thumb. Every scroll box uses it.
- **The dark panel behind dropdowns** was the popover shadow: 12/32 at 60% black draws a square
  halo around the menu on the dark materials (spikes/menu-fade-run.ts). `elevation(m, level)`
  in the theme: popovers 4/12 at 45% of the material's shadow, cards 8/20, sheets keep 18/48.
  Also: a menu closes on mouse-down outside it, which includes its own trigger, whose click then
  reopened it; triggers check `closedByOutsidePress()`.
- **Status bar** moved to the bottom right (you asked); the approval card and its menus open
  from there, toasts sit bottom left. Tooltips name the state and what a click does.
- **Line ranges in a hunk.** Click a line to comment, ⇧-click another to extend. `<diff>`'s
  lineClick has no modifiers, so a mouse-down on the wrapper records ⇧ just before it. GPUIX
  can't tint a diff row, so the selection and commented ranges are washes laid over the diff,
  placed by row: the wrapper's height over the row count (`hunkRows`). A range reaches Claude as
  "lines +1 to +3" with every line quoted.
- **ACP stays.** The original spec said to drive `claude` directly and not use the ACP adapter;
  on 2026-10-24 you decided Vellum keeps the ACP layer (core/acp.ts, core/agent.ts), which also
  opens the door to other ACP agents.
- Run the project's core tests as `bun test ./core/`.
- **Image paste.** ⌘V in the composer reads the clipboard for an image: a copied file (Finder)
  or raw PNG data (a screenshot) on macOS via osascript, wl-paste/xclip on Linux, PowerShell on
  Windows. The image is copied into ~/.vellum/images, shown as a thumbnail on the draft, and
  sent to the agent as an ACP image block before the text (the adapter says `image: true`).
  The note keeps the paths, so the picture shows under your paragraph. Text paste is untouched:
  with no image on the clipboard nothing happens. `VELLUM_PASTE_IMAGE` stands in for the
  clipboard in scripts/check-images.ts, so checks never touch yours.
- **Changes from git.** Changes used to know only what the edit tools reported, so a file a
  shell command wrote (codegen, `sed`, a formatter, `bun install`'s lockfile) never showed. Now,
  in a git repo, each message snapshots the working tree as it goes out and each turn end
  records the diff since (`vellum/git-changes`); that turn's Changes come from git, and the note
  gets one quiet "Also changed …" line for files no edit of the turn covered. Outside a repo,
  and for a turn still running, the tool calls' diffs stand as before.
  A snapshot is a tree written through a shadow index into Vellum's own object store
  (~/.vellum/git/<repo>, the repo's objects as an alternate): the repo's index, stash, branches
  and .git/objects are never written (core/gitsnap.test.ts counts them). The store keeps git's
  stat cache, so a snapshot of this repo takes ~100ms. A turn waits at most 1.5s past the
  agent's start for its snapshot; a slower one (a huge untracked folder, first time) lets that
  turn fall back to tool diffs while it finishes warming the cache.
  Not done: the store under ~/.vellum/git only grows (by the blobs of changed files); nothing
  prunes it yet.
  **Security:** Vellum runs outside the agent's sandbox, and the agent can write .git/config
  during a turn, so a snapshot must not run anything the repo's config names. `git add` runs
  `core.fsmonitor` and filter drivers' clean/process commands, and `write-tree` runs clean too
  (a test proved all three). Every snapshot call sets `core.fsmonitor=false`,
  `core.hooksPath=/dev/null` and blanks each configured filter driver; files are hashed as they
  are on disk. The `#` file picker's `git ls-files` gets the fsmonitor guard as well.

## 2026-10-24 — timeline, and two fixes

- **Timeline.** A note with three or more of your paragraphs gets a tick for each at the far
  left of the page (ui/Timeline.tsx). Ticks near the pointer widen like a dock; the hovered one
  previews the paragraph with Go there and Edit, and the preview stays while you move onto it.
  A click on a tick scrolls the note there (`scrollToItem`, 24px above it); Edit also puts the
  caret in the paragraph (`editParagraph` in ui/blocks.tsx, retried until the row has mounted);
  a real double-click on a tick does the same. The tick for the paragraph you're reading stays
  bright. The visible range lives outside React state (`watchRows`), so scrolling the note
  re-renders only the timeline. scripts/check-timeline.ts covers it; synthetic clicks can't
  double-click, which is why Edit is a button rather than only a gesture.
- **GPUIX:** a `motion.div` takes presses from the element around it (hover still reaches the
  parent), so a clickable row whose child animates needs its handlers on a transparent overlay
  above the child. Window-level typing in a check is `keystrokes` with no element; `keyDown`
  alone inserts no text.
- **New note:** "Log in" shows only for an account that's logged out; others show their email.
- **Chunk-fade streaming** is the other session's (components/StreamChunk.tsx in its app.tsx
  refactor). This session's version was taken back out of ui/blocks.tsx so the two don't fight;
  core/stream.ts (settle points, tested) and scripts/check-stream.ts are left uncommitted for it.

## 2026-10-24 — GPUIX motion reality

The rules every animation here follows, and the renderer facts behind them. `scripts/check-motion.ts`
checks them. It opens and closes each shadowed popup, toggles it ten times quickly, and shoots
frames 0–260ms on a paused clock (`app.clock.pause()` / `fastForward()`) into
`screenshots/motion-<full|reduce>-*`. Run it with `MOTION=reduce` for the reduced-motion pass.

- **A box shadow ignores the node's opacity.** GPUI paints it at full strength while the node
  fades, so a fading shadowed panel shows its shadow first, and through itself while translucent
  (spikes/fade-square.tsx: box b at 30–150ms). The rules that follow from this:
  - Shadowed surfaces never fade out. Menu, the context card and Toast unmount whole. Sheet and
    SidePanel keep the frozen panel for one beat (`exit`, 0.18s) while only the shadowless scrim
    fades, then unmount it (`useHoldOpen`). Reduced motion skips the hold.
  - AnimatePresence is only for shadowless surfaces (the approval card's deny field).
  - On entry, `components/Lifted.tsx` holds the shadow back until the enter tween completes
    (`onMotionComplete`, with a 600ms fallback). Menu uses it. Toast, the context card, Alerts
    and the Composer picker still fade in with their shadow. Frames of them on the dark theme
    show no visible ghost, so they were left alone (they are another model's files in flight).
    Lift them if one ever shows a halo.
- **FloatingLayer paints a square `#1A1A1A` behind its content** (`@gpuix/react/floating`,
  `floating.js:195`, the default `backgroundColor`, with no radius). Behind a rounded panel this
  showed as a square pane around the corners, most visibly while the panel faded in. That was
  the "dark pane" in the popup frames, not the shadow. Every FloatingLayer passes
  `backgroundColor: '#00000000'`, except the Composer picker, which sets its own fill and radius.
- **The outside-press guard answers once.** `closedByOutsidePress(key)` is a 250ms window after a
  press outside closed a menu, so the trigger's own click doesn't reopen it. The window used to
  stay open for every click in it, so ten quick clicks left a menu in the wrong state. It now
  clears itself when it answers yes. Keys (`mode`, `model`, `context`) keep one menu closing
  from eating the click that opens another.
- **A motion.div keeps presses, again: Switch.** A click on the thumb (a motion.div inside the
  native button) never reached the button. That covers the centre of an off switch, so the
  translucency switch mostly did nothing. A transparent div above the thumb now takes the click.
  A bare overlay with no handler is not enough: the press doesn't bubble up to the native
  button. The rest of the checklist sweep:
  - TabStrip tabs and Sheet's scrim already pass presses through (`pointerEvents: 'none'` on the
    motion.div).
  - Segmented's buttons are drawn above its thumb.
  - The approval card's motion wrapper is `pointerEvents: 'none'`, with the card back on `auto`.
  - Menu rows carry their handlers on the row's own motion.div, which receives them.
- **Checks.**
  - `check-motion` passes in full and reduced motion: 5 surfaces, plus 3 × 10 rapid toggles and
    the toast. Under reduced motion every frame 0 is already the finished state.
  - Regressions passed: check-approval, check-tabs (strip collapse), check-timeline,
    check-new-note and check-changes. A probe also covered ⇧⇥ mode cycling, ⌘N, ⌘K, ⌃N/⌃P in
    the picker, and the Switch knob.
  - check-changes' "Add closes the sheet" now polls rather than sleeping 900ms. With the Sheet's
    hold and the composer re-render, the panel goes at about 750ms.
  - The scroll keeper (components/Scroll.tsx) went in earlier, in e1cd85f.

## 2026-10-24 — the note glides back to the composer

- **What.** Writing, sending or coming back to the composer (⌘K back to the note, Add from
  Changes, a click under the note) while it's scrolled out of view eases the note down to it.
  Small distances take `standard` (0.24s), a page or more `considered` (0.48s), on the standard
  curve. From further than 1.25 viewports the glide starts 1.25 viewports from the end, so
  coming back from the top of a long note is one short slide, not a ten-second scroll. A scroll
  of your own during the glide stops it. Reduced motion jumps. At the end, typing moves nothing.
- **How (ui/glide.ts).** GPUIX has no animated scroll, so this steps the list's anchor every
  16ms (spikes/list-glide.tsx found the facts):
  - `scrollToItem` and `getListScrollTop` resolve synchronously. The end can be read and the
    old anchor put back in the same tick, before anything paints.
  - An index past the last item lands exactly on the end, and the list follows the tail from
    there. A negative offset resolves against measured rows; a positive one past an item's
    height is kept as given, so offsets can be stepped in pixels.
  - There is no `requestAnimationFrame` in the Bun host, so the frames run on timers.
  - The glide is laid out from the end. Each frame reads where the end is now (a streaming
    reply moves it) and sits `r` px above it, `r` easing to 0. The last step lands on the end
    itself, so following the tail resumes.
  - The starting distance comes from a binary search over "x px above the end" anchors.
- **Slack.** The glide starts only when the note sits more than 160px above its end: the 240px
  of room under the composer, less 80. Up to there the composer's last line is still clear of
  the bottom edge.
- **Checks.** `scripts/check-glide.ts` passes in full and reduced motion:
  - At the end, typing moves nothing.
  - A short scroll up comes back.
  - From the top, the composer returns over about ten frames, one way only
    (650 → 571 → 523 → … → 465 px).
  - A wheel during the glide stops it.
  - ⌘Enter from far up lands at the end and keeps following.
  - Verified in a clean worktree of HEAD plus this change, which also passed check-motion,
    check-changes and check-timeline.

## 2026-10-24 — Settings is a page

- **What.** ⌘, and the account marker open Settings as a page of its own:
  - It sits in the pane under the tab strip and covers the note. The note stays mounted
    underneath, so its scroll and draft are as you left them.
  - The sections (Accounts, Appearance, Tabs, Motion) are listed on the left and scroll on the
    right. A name in the list scrolls to its section.
  - The section you're in lights. A jump holds its light through its own scroll, because a page
    too short for the last section to reach the top would otherwise light the one above.
  - esc, Done, or a tab in the strip goes back to the note.
  - The content fades in on `standard`. It has no shadow, so nothing ghosts.
- **Why not a third view beside notes and terminals:** the terminal view's switching was
  uncommitted work in another session when this went in. The page is an absolute layer in the
  pane, so the two can't collide, and it can become a view later without changing what you see.
- **Checks.** `scripts/check-settings.ts` covers: opens under the strip, a section jump, scrolling
  back, esc, Done, and a tab. check-tabs (settings → tab mode) and check-login also pass.

## 2026-10-24 — moving a note to another account

- **What.** The account marker on the strip (the dot and name, top right) opens a menu of your
  accounts. Picking one moves the note there, and **Accounts…** opens Settings.
  - The menu shows no emails: the name is enough to pick by.
  - A logged-out account is disabled and says so.
  - While Claude is working, the others are disabled and the menu's heading says the move can
    wait until Claude is done.
- **How.**
  - A `vellum/profile` record changes the note's account. It drops the session id (that session
    belongs to the old login, which keeps its history) and puts a quiet "Moved from Default to
    Work" line in the note.
  - The note's agent is disposed, so it lets go of the old session's lock.
  - The next message starts a session on the new account. It carries the note so far
    (`handoffContext`: the note's markdown without its header, the latest 60k characters).
  - The flag that asks for this clears on that message, so only one turn carries it.
- **Checks.**
  - `core/move.test.ts` covers the reducer, the handoff text and the cap.
  - `scripts/check-move.ts` covers, against the fake agent: the menu, the recorded move, the line
    in the note, a `session/new` (not a resume) on Work carrying the note, the next turn
    carrying only itself, and Accounts… opening Settings.
  - check-login now reaches Settings through the menu.
  - check-approval's two failures ("keeps an Allowed/Denied line") are HEAD's own, as before.

## 2026-10-24 — the page is a card on the frame

- **What.** The tab strip sits on the window frame, with no bar or bottom border of its own. The
  note, terminals and Settings sit on a card under it, rounded on all four corners
  (`concentric(windowRadius, shellInset)`). When the strip hides, the card keeps its rounded top,
  inset from the frame. Before, the strip and page were one pane, so the page had a
  flat top under the strip.
- **GPUI quirk, again:** a child isn't clipped to its parent's radius. The fade at the top of the
  note ran edge to edge and painted square corners over the card's curve. It now stops a radius
  short of each side.
- **Checks.** Verified by eye in dark and frost, with the strip shown and hidden. check-tabs,
  check-settings, check-motion and check-glide pass on HEAD plus this change.
