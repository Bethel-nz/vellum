# Vellum notes

Findings, choices and deviations from the build prompt. Newest decisions win.

## Stack and versions

- Bun 1.4.3, TypeScript 7.0.2, React 19.3.1
- `@gpuix/react` **0.11.0** and `@gpuix/native` **0.11.0**, both pinned exactly in `package.json`
- `libghostty-vt-node` 0.1.0 (wasm build of libghostty-vt, upstream commit `4c6215bb`)
- `diff` 9.0.0 for unified patches
- `claude` 2.1.296 on macOS 27.0.1, Apple Silicon

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
- **Ctrl+Enter** sends the new text at the end **plus a description of every edit** made to
  earlier paragraphs since Claude last saw them. Each edited block keeps `seen` (the text Claude
  saw). `vellum/edit` records change a block, and `vellum/synced` clears `seen` once the edits
  went out. Block ids are now numbered per thread (`u-0`, `a-1`, …), so replayed edits find their block.
- **Tab bar** across the top: open notes as tabs (icon,
  title, unread-reply badge, last-change time). The active tab shares the page colour. Then +,
  ⌘K and the material toggle. Under it sits the page title with a ⌄ menu: folder and account,
  Rename, Open in Claude Code, Show folder in Finder, Close tab. The account shows on the right.
  Shortcuts: ⌘N/⌘T new, ⌘W close, ⌘1–⌘9, ⌘⇧[ / ⌘⇧]. Open tabs persist in `settings.json`.
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

- **One host root.** A fragment with two top-level host nodes made the second one the window root,
  and the whole document stopped painting. Dialogs now live inside the root `div`.
- A run of `<text>` siblings inside a block `div` stacks vertically. Terminal rows use
  `display: flex; flexDirection: row`, and each run is sized `cells × 0.6em` so spaces never collapse.
- `onFocus` / `onBlur` did not fire for a `tabIndex` div in a background (`focus: false`) window,
  even though `getFocusedElementId()` changed. The terminal tracks its focused state itself: click,
  `onMouseDownOutside`, ⌘Esc.
- Automation screenshots of a background window can catch a `motion.div` mid-fade, because frames
  are paced by the 100 ms fallback timer. Wait about 2 s before asserting on dialogs.
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
  block, restart + resume.

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
