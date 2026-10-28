# Vellum notes

Findings, choices and deviations from the build prompt. Newest decisions win.

## 2026-10-26 — the agent's simulator settings tools

simdriver's agent layer was already the agent's (mobile_snapshot, mobile_tap, mobile_steps).
The Driver surface below it had no tools, so the agent could act on the screen but not on
the phone around it. Four tools joined them (core/bridge.ts), all on the live phone the
mobile view holds, all through `withMobileAgent` so the view says "An agent is using the phone":

- **mobile_apps** lists installed apps with their bundle ids — the ids launch, terminate,
  permissions, notifications and data resets all take. System apps included.
- **mobile_configure** runs settings actions in order: `permission{op: grant|revoke|reset,
  service, bundleId}`, `contentSize{size}`, `statusBar{op: override|clear}` (override pins
  9:41 and a full battery). Every action is validated before any runs — a typo in the last
  action touches nothing — and it stops at the first real failure saying how far it got.
  Services and sizes are the lists this Xcode's simctl documents, verified against
  `xcrun simctl privacy` / `xcrun simctl ui` on 27.x, not guessed.
- **mobile_notify** delivers an APNs payload as a local notification: the JSON is written to
  a temp file under VELLUM_HOME for `simctl push`, then removed.
- **mobile_reset** is the destructive one, alone so an approval card names it: `app-data`
  erases one app's container (terminating it first), `keychain` empties the whole phone's.

`pan{dx,dy}` and `transform{dx,dy,scale,degrees}` were missing from mobile_steps' advertised
actions (simdriver takes them); the description now lists them.

- **simdriver fix found by the check:** `clearAppData` errored when the app wasn't running —
  simctl says "found nothing to terminate" (ESRCH), which simdriver only tolerated as "not
  running". Fixed in simdriver (6f33384), released as **simdriver 0.1.1**; a second release,
  **0.1.2** (7d8b9fb), corrected the package's hand-written `index.d.ts`, which had been
  declaring the napi surface instead of the wrapper — `Driver.agent()` was missing and the
  Agent layer's signatures were wrong. Vellum pins 0.1.2; the lockfile carries the published
  tarball's sha512. Not-running is the common case for an erase.
- `mobile_steps`'s description keeps naming every action; schemas stay loose the way the
  existing tools are, and validation lives in the tool.
- Checks: check-mobile now covers all seven tools — apps lists bundle ids, a configure batch
  runs in order (grant→reset photos, extra-large→large text, status bar override→clear, so
  the phone ends as it was), a bad service is refused before anything runs, a notification
  delivers, app-data erases (verified with the fixed simdriver), and an unknown `what`
  errors. First full run passed everything but the erase (the simdriver bug above).
  check-bridge's stdio round trip now names every tool (it counted 6, which mobile had
  already outgrown); the vellum six always, the mobile seven where a simulator can run.
- **Never overwrite a signed native addon in place.** `cp` new bytes over the existing
  `.node` in node_modules leaves the old file object's `com.apple.provenance` xattr behind;
  the cdhash no longer matches and macOS SIGKILLs every process at `require` — no error, no
  log, exit 137. A check whose app dies that way doesn't fail fast: the automation spins at
  ~98% CPU waiting on a window that will never paint (two check runs wedged this way, and a
  bare probe died at import). Replace the file (`rm` then `cp`) so the new bytes carry their
  own attributes; then the load works. If a bun process exits 137 with no output right after
  touching a native module, suspect this before anything else.

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
  Shortcuts: ⌘N/⌘T new, ⇧⌘W close tab, ⌘1–⌘9, ⌘⇧[ / ⌘⇧], ⌃⇥ / ⌃⇧⇥ (not ⌃← / ⌃→: macOS gives those to Spaces). Open tabs persist in `settings.json`.
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

- **`<svg source>` honours `fill-rule="evenodd"`** (spiked with the Model Context Protocol
  logo, whose bands are single paths with counter-space): it renders the knot exactly, tinted
  by the `color` style when the svg carries no `fill` — the way the bundled brand marks work.
  `McpMark`'s generic fallback is the MCP logo now (`assets/brands/mcp/mcp.svg`), not the
  `layers` glyph.
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
- ⌃⇥ / ⌃⇧⇥ cycle tabs.
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
  | tab cycling | ⌃⇥ ⌃⇧⇥ | Ctrl+Tab, Ctrl+PgUp/PgDn | Ctrl+Tab, Ctrl+PgUp/PgDn |
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

## 2026-10-24 — motion kit and agent surfaces

- **Motion contract.** `components/motion.ts` is authoritative. The older §11 timing table is
  superseded by the supplied enter/exit/duration tokens. Reduced motion now subscribes mounted
  controls to the setting, including a running Dot; it becomes static without disappearing.
  Menus, attention cards, approvals and toasts unmount whole. Sheets hold their panel for the
  scrim's 180ms fade; reduced motion skips that hold. The deny field is the only remaining
  AnimatePresence surface here, and has no elevation.
- **Completed kit.** TabIndicator slides a selected wash behind the active strip pill;
  HoverWash is reused by the status ButtonGroup. Alerts anchor to background tabs and show the
  actual pending request or unread-note title. Their arrival leaves the composer focused.
- **Agent surfaces.** The status controls share a joined surface, measured hover wash and
  hairline dividers. The approval card shows the pending action with real
  command, folder, model and agent-supplied rule, keeping the existing approval callbacks. Tool
  groups expand into individual calls with copyable Input/Output panels, actual failures and
  recorded elapsed times. Older notes without retained output say so. ACP records now retain
  these details; no result counts, risk labels or outputs are invented.
- **Streaming.** `useStreamChunks` commits immutable batches into separate virtual-list rows.
  First content is eligible on the 120ms tick; later batches prefer markdown settle points,
  bounded by 480ms. Each row fades once. A finished response uses the full original markdown.
  The shared `core/stream.ts` settle helpers came from the concurrent streaming work.
- **Native checks.** Full and reduced motion gallery checks passed for tool details, approvals,
  toasts, tab attention and focus preservation. Seven popup types each opened/closed ten times
  in both settings (140 cycles), including picker Ctrl-N/P. Streaming painted its first chunk
  169ms after the first delta; five committed row heights stayed fixed and the final text was
  complete. Approval/model/thinking/compaction and tab/History/strip regression scripts passed.
  Existing smoke checks now wait for a painted input before Escape and for actual sheet removal
  or compaction response instead of racing a fixed sleep. The app's existing Cmd-Enter send
  binding is retained; §13's Ctrl-Enter reference predates it.
- **Source validation.** Biome checked the eight new/rewritten kit files; 14 existing core ACP
  and stream tests passed. No build or tsc invocation. Visual captures are under screenshots/
  with motion-approval, motion-tools, motion-alert, and motion-stream names.

## 2026-10-24 — expanding status pill

- Replaced the status bar's joined buttons with an expanding group. The model stays
  expanded at rest; pointer movement or keyboard focus reveals another label, and an open
  menu keeps its trigger expanded. The existing 28px outer height is retained (22px inner
  pills, a 3px surround) to keep the status bar's density and approval-card clearance.
- Width uses the same converted morph tween as the tabs; label reveal uses left and opacity
  with enter/leave tokens. Reduced motion makes those transitions instant. Labels are measured
  natively; icons keep a fixed inset. Only real pointer travel changes hover intent, with a
  4px boundary inset so moving neighbours don't exchange labels under a stationary pointer.
- GPUIX motion children consume native clicks, so each animated visual has a transparent native
  button above it. Native div buttons also miss focus/blur notifications for Tab and direct
  focus calls: the group reads the focused id every 100ms without moving focus. Mouse presses
  are tracked separately, so leaving the controls returns to the model after a mouse action.
- Native checks passed for every hover reveal, stationary-pointer stability, Tab/Shift-Tab,
  arrows, Home/End, Enter, and return to the resting model. Three popups each opened and closed
  ten times in full and reduced motion (60 cycles), staying attached above their trigger.
  The existing approval/settings/compaction regression passed. Compared native 1080×780
  captures in groknight and frost. Biome passed for the three affected component/source files,
  including an explicit undeclared-variable check. No build or new permanent tests.

## 2026-10-24 — a hover wash paints square

- Extends the `<img>` rule: GPUIX doesn't clip a node's own paint to a PARENT's radius either,
  so a parent's `overflow: 'hidden'` + `borderRadius` does not round a child's hover or active
  wash. A naked native `Button` (`@gpuix/react/button`) carrying `hover` styles paints its wash
  square past the card's rounded corners — a square backdrop behind the pill, seen on the
  tool-activity card in the notes.
- Rule: every node painting a wash (hover, active, selected, or an animated background) carries
  its own `borderRadius`, as `components/Button.tsx` already does. A node inset inside a
  rounded, bordered parent uses `concentric(parentRadius, borderWidth)`. GPUIX has no
  per-corner radii, so internal rows round all four corners; the soft pill a wash makes inside
  a card is the same idiom Menu rows already use.
- Fixed `components/ToolCall.tsx`: the group header row and each call row now carry
  `borderRadius: concentric(radiusBase, 1)`. A sweep of the other wash-bearing nodes found none
  missing: Button, dialogs, Menu rows, ButtonGroup's HoverWash, ExpandingButtonGroup, Switch,
  Segmented, and TabStrip all round themselves.

## 2026-10-24 — an incident with the link check, and the guards it left behind

- **What happened.** At 02:22 the app was started by `scripts/check-pane.ts` with no argument.
  That script passed `VELLUM_CLAUDE_HOME: ${argv[2]}/claude-home` = "undefined/claude-home" (a
  relative path) and no VELLUM_HOME, so the app used the real ~/.vellum. The link check then took
  the real `work` account's links to ~/.claude as "pointing elsewhere": it copied ~876 MB of
  ~/.claude into ./undefined/claude-home and ~872 MB of backups into ~/.vellum/backups/work, and
  relinked `work` there. A later normal launch linked it back. ~/.claude itself was only ever read
  (copies, never moves), and ./undefined was deleted once that was checked.
- **Also found:** unit tests wrote their backups into the real ~/.vellum/backups/work, because
  another test file had imported store.ts (which fixes its paths on first import) before the
  accounts test set VELLUM_HOME. And ~/.claude/settings.json was re-saved at 00:41 (12,100 → 12,104
  bytes, valid, 19 keys) in the same second as the real `work` relink, most likely by a `bun --hot`
  app that reloaded accounts.ts before its no-needless-rewrite fix. The merge it did added nothing.
- **Guards now:** `bunfig.toml` preloads core/test-setup.ts, so every test has a scratch
  VELLUM_HOME and VELLUM_CLAUDE_HOME before anything is imported (checked: the real backup folder
  is untouched by a test run). `claudeHome()` throws on a relative VELLUM_CLAUDE_HOME. `linkAccount`
  does nothing when the hub doesn't exist, rather than building one. check-pane exits with usage
  without its argument and resolves both paths.
- **Lesson for `bun --hot`:** saving a half-written module reruns launch effects against real
  data. Code that writes to ~/.claude or ~/.vellum at launch has to be safe at every save.

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

## Terminals outlive Vellum (4006bf6)

- **The holder.** `core/termd.ts` is a small Bun process that owns the PTYs. It runs detached
  (its own session, so a quit or a Ctrl-C doesn't reach it) and listens on
  `<VELLUM_HOME>/run/termd.sock`. Whoever can connect runs commands as you, so `run/` is 0700
  (owner and mode checked at start) and the socket is made under umask 077, then 0600. Its pid
  is beside it in `termd.sock.pid`; output goes to `termd.log`.
  - It keeps each terminal's last 1 MB of raw output and has no emulator of its own.
  - A returning Vellum replays that output into a fresh libghostty terminal, then resizes.
  - It quits 10 s after it holds nothing and nobody is connected. Checks that fail kill it, so a
    scratch home never keeps a shell.
- **What's held.** Only shells and "Open in Claude Code" (`keepTerm` in app.tsx) are held; they
  come back at launch as tabs without leaving the note. ! commands and logins still end with
  Vellum, since their output is recorded or they're over in a minute.
- **A held Claude Code still holds its session.** After a restart the note's agent sees the live
  `claude` and won't drive it until that tab ends; the one-writer lock already covers this.
- **Version.** The hello carries `TERMD_VERSION`. A Vellum that finds an older holder uses plain
  terminals instead of guessing at its protocol; bump it with any message change.
- **Socket writes can be partial.** A 1 MB replay is over a socket buffer. `Wire` queues the rest
  for the drain handler and joins UTF-8 split across reads.
- **Checks.** `check-termd` (no UI): a shell from one process is back in the next, takes typing
  and a resize, and the holder leaves when empty. `check-terminals` now quits and relaunches the
  app: the shell is back as a tab, with `vellum42` on screen, and still takes typing.

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

## 2026-10-24 — alerts and Confirm Morph

- Alerts group a tone icon, title, supporting copy and dismiss control.
  Alert.tsx is now shared by persistent timeline errors
  and the tab-anchored attention card. Errors still appear once and retain their red message.
- The in-flow alert is flat so its measured height and opacity can tween on dismissal without
  leaving an elevation shadow. Tab attention uses a separate Lifted wrapper and unmounts whole.
  Title/copy/tone changes use legal opacity/top tweens; padding is 16px, gap 12px, icon 18px.
- ConfirmMorph uses a measured width, question, pending state,
  success/Undo and error/Retry. Callbacks determine the result. No fake spinner, success or Undo
  is attached to the real close operation. A 280ms arming guard rejects reflexive answers.
  Async completion leaves the composer focused when the user has moved there.
- You chose Confirm Morph for Stop and close. It replaces that sheet with a question anchored
  beside the requested tab. A hidden strip temporarily reveals the question. Cancel, Escape and
  outside press leave the running note alone. Confirmed close stops the process and retains the
  recorded note/session. Closing disposes of the agent immediately, so verification observes
  its PID ending rather than assuming a cancellation RPC must reach a process before disposal.
- Native full and reduced passes covered alert status/height changes, dismiss/reopen, question
  cancellation, pending/resolved/rejected promises, Retry, real inverse Undo and composer focus.
  The real close flow passed in both settings, including a hidden strip, process termination
  and saved-note preservation. The reflexive-answer guard was observed in the full-motion
  run; transport latency exceeded that guard in the reduced run. No build or permanent tests.

## 2026-10-24 — model picker, History header and hit-testing contract

- The model picker groups the provider mark, model title and actual
  description, selection check, and an Effort submenu. The expanded model pill shows effort
  as secondary text. Only the agent's own models and effort options appear; More models is
  available when there are options beyond the first four. No sample GPT/Gemini entries are
  added to a Claude-only account.
- Effort options arrive from ACP's thought_level select. Legacy off/on/max map to low/default/
  max as before; medium/high/xhigh are retained when the agent offers them. The native fixture
  agent received High and Medium through session/set_config_option. The three old fallback
  choices remain until the first session supplies its options.
- History now has a rounded search field, clear action, Filters, real result
  count and Best match/Newest/A to Z control. The left panel is 480px to fit those controls.
  Best match prioritizes exact and prefix title matches; date order remains the fallback.
  Filters use real open/running notes and accounts. No synthetic search duration is displayed.
- MOTION-CONTRACT.md records the renderer limits and the new hit-testing/dismissal rules.
  Tab hit areas and their close controls are plain overlays over their animated visuals.
  Segmented buttons sit above the thumb; Switch has a plain knob overlay. Menu rows now use
  plain click overlays too: a staggered row lost one press in the final popup check. Menu and
  model-picker surfaces animate separately from the static click regions.
- PopoverBackdrop is a plain target in the deferred popup layer, above sibling animations.
  Outside presses dismiss the current popup. Sheet scrims have a plain dismissal overlay above
  their animated wash. Confirm-close has the same dismissal plane. The legacy outside-press
  guard is no longer required by these popup dismissal paths.
- Native full/reduced passes covered search, clearing, sorting, open/account filters, model and
  effort changes, nested keyboard navigation, backdrop dismissal while rows enter, and strip
  collapse. Menu keyboard events now respect defaultPrevented so a submenu answer cannot also
  activate its parent's selected row. Strip collapse needs minHeight:0 with the new tab hit
  planes. The existing tab check waits for Settings removal before typing in auto mode.
- With the native clock at frame 40, approval and Sheet close buttons still take presses,
  ten Switch presses work while the knob moves, Segmented buttons work during a glide, and
  tab switching/closing work during indicator motion. Full and reduced checks passed.
  The popup regression (rapid toggles and the toast action) also passed in both settings.
- Validation: 14 existing ACP/stream tests passed; Biome passed for the new/rewritten feedback,
  picker, status and History components, plus scoped undeclared-variable checks on the wiring.
  No tsc, build, commit or push.

## 2026-10-24 — tool-call fidelity correction

- Removed the invented leading tool glyphs and stars, the group outline, and the separator
  border between its summary and rows. Input/Output now align with the tool title; their
  inset fills, status, elapsed time, disclosure and copy controls remain functional.
- Skill chips and suggestions also lose the decorative star. Claude's identity mark is the
  exact five-path SVG supplied by the user, reused by approvals and model controls.
- Native inspection expanded the skill call and its recorded result. Scoped Biome checks and
  undeclared-variable checks passed. No build or new permanent tests.

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

## 2026-10-24 — printed files read in their own language

- **What.** When Claude runs a command that only prints one file, its output in the note is
  highlighted as that file's language instead of as shell. That covers `cat ui/theme.ts`,
  `head -n 40 app.tsx`, `sed -n '10,80p' core/agent.ts` and `bat`, with or without a leading
  `cd … &&`. GPUIX's `<code>` picks the language from a `path`.
- **What doesn't count.** `core/printed.ts` names no file when the output isn't that file's text:
  a pipe, a redirect, a glob, a variable, a second command, several files, `sed` without `-n` or
  with `-i`, or a failed run, whose output is its error. Those stay shell.
- **Your own `!` commands** run in a real terminal, so their colours come from the program:
  `bat -pp <file>` prints a file highlighted.
- **Checks.** `core/printed.test.ts` covers what counts and what doesn't. `scripts/check-printed.ts`
  shows `cat`, `sed -n` and `cat | grep` in one note: the first two read as TypeScript, checked by
  eye.

## 2026-10-24 — known trade-off: a moved note's context

- **Accepted as is, by the user's choice.** After a note moves to another account,
  `handoffContext` (core/threads.ts) sends the whole note in your first message there. That
  includes command output and the contents of files Claude read. In the old session those came
  back to Claude as tool results; in the handoff they arrive inside your message. Text in a file
  or a page written to read like an instruction would then come with your authority, and it can
  contain the plain `</note>` marker the record is wrapped in. The risk is highest in a note set
  to Full access, where nothing asks before it runs.
- **Weighed and not taken:**
  - Carry only your paragraphs and Claude's replies.
  - Keep tool output but mark it as quoted data under a boundary nothing inside could guess.
  - Drop a Full-access note to asking for its first turn after a move.
- Raised by the automated security review of c3dd2a7. Revisit it if notes start pulling in text
  you don't control, such as fetched pages or other people's repos.

## 2026-10-24 — UI pass: one edge per panel, hairlines that show on popups

- **The questions panel sits on one edge.** The panel insets its rows by 6 and the rows pad their
  text by 10, so every left edge in it (the count, the title, each option, the field's text and
  Cancel's label) sits at 16. Rows take `concentric(radiusXl, 6)`. Number badges are centred on
  their row. "Something else" is a quiet field in the same shape as the rows, with no label above
  it: `Field quiet` is a chip fill with no hairline until it is focused. `Scroll gutter` lets the
  list reach the panel's right edge; a thumb, when there is one, sits over the rows' padding.
- **No blur behind it.** GPUIX blurs only the whole window, so while a question is open the pane
  washes toward its own colour (`pane` at 72%) instead. The wash comes and goes with the panel.
- **groknight's `border` is a white hairline, `#ffffff09`.** On the pane it comes out #1c1c1c,
  as before. The old opaque `#1c1c1e` matched `popup` (#1c1c1c), so every line drawn on a popup
  vanished: the model picker's separator and the questions panel's spare progress dots. smoke and
  frost already used alpha hairlines.
- **The menu separator had no width.** It was a child with no width in a row-direction box, so
  it collapsed to zero on every material. Its box is a column now.
- **An `<input>` reports focus only in a window that can take it.** A spike opened with
  `focus: false` never sees `onFocus`, so a field's focus ring never shows in its shots
  (spikes/input-focus.tsx). Open shots of fields with a focusable window.

## 2026-10-24 — Changes covers the folder, and the note's column grows with the window

- **Changes is not only what Claude did.** The panel's scope menu has This note (the edits
  recorded in the conversation) and Uncommitted (the folder's working tree against HEAD, staged,
  unstaged and untracked alike, from `uncommittedFiles` in core/gitsnap.ts, through the same
  private index as the turn snapshots). A note that changed nothing opens Changes on Uncommitted,
  and the strip offers Changes with the folder's count when the note has none of its own. The
  count is read again when the note's changes move and when Changes closes, not on a timer: a
  snapshot rehashes only what changed, but the first one in a big repo can take a while.
- **One text edge in Changes, at 18:** the list's 8 plus each row's 10. The scope chip, the empty
  line and the footer's count sit on it.
- **The column is `readingWidthFor(window width)`:** 720 until the window passes about 1090,
  then 66% of it, up to 960, where a line is still about 105 characters. The terminal's columns
  follow it. `VELLUM_WINDOW=WxH` opens the window at another size for checks
  (scripts/check-width.ts); GPUIX automation can't resize a window.
- **The timeline rests at 40%** and comes up while the pointer is on it or its preview.

## 2026-10-24 — two themes, Dark and Light, and no glass

- **The materials are `dark` and `light`, both opaque.** Dark is groknight under its plain name.
  Light is frost's palette on solid surfaces: an #ececef frame, a white page and white popups, and
  a blue focus ring (frost's was a pale mauve that vanished on white). Settings → Appearance has
  the two, and ⇧⌘L still flips between them.
- **The glass is gone:** smoke, the "Translucent window" switch, the blurred window and the
  `solid` / `translucent` / `wantsBlur` helpers. The window is always opaque. A saved
  `groknight` or `smoke` opens as Dark and `frost` as Light (`materialNamed`), so nobody's setting
  breaks.

## 2026-10-24 — Vellum.app: one compiled binary, bundled by cargo-packager

`bun scripts/build-app.ts` (or `bun run package`) builds `dist/bundle/Vellum.app`: `bin.ts` compiled
with `bun build --compile` into one executable, `assets/icon.png` turned into an `.icns` (sips +
iconutil), and cargo-packager (`packager.json`) wrapping both, signed ad hoc. The bundle is what
gives Vellum its name in the menu bar and its icon in the Dock and Finder. GPUIX can't: `appName`
only names Hide/Quit, and a bare binary has no icon.

A compiled binary has no Bun beside it and no node_modules, so a few things changed:

- **One executable, several parts.** `bin.ts` picks by its first argument: the app, `--agent` (the
  ACP adapter, bundled in), `--termd SOCK` (the terminal holder) or `--run FILE` (a script from disk,
  for the fake agents checks swap in). `agentArgv` and `startHolder` ask for these when
  `platform.compiled`. From source nothing changes.
- **Files ride inside.** Fonts are imported `with { type: 'file' }` (`assets/fonts.ts`). The GPUIX
  addon is too, and `NAPI_RS_NATIVE_LIBRARY_PATH` points napi-rs's loader at it. libghostty-vt-node
  reads its wasm relative to its own file, so a build plugin rewrites that one line into a file
  import. The plugin throws if the line ever changes, rather than shipping a binary without a terminal.
- **PATH.** Opened from Finder, the app gets launchd's `/usr/bin:/bin:/usr/sbin:/sbin`, which has no
  `claude`. With no `TERM` set, `bin.ts` takes the login shell's PATH (`$SHELL -ilc`, with a 5s
  timeout). Only PATH, not the rest of the shell's environment.
- **Dock icon.** `setDockIcon` only runs from source; the bundle names its own icon.

`scripts/check-app.ts` drives the bundled binary: the note opens, a fake agent turn runs through
`--run`, and a terminal runs through `--termd` and the embedded wasm. Opened with `open` on a
throwaway home, the menu bar says Vellum and macOS shows the V icon for the bundle.

Not done: Apple silicon only (`bin.ts` names the darwin-arm64 addon); signing is ad hoc, so the app
opens on this Mac but needs a Developer ID and notarization before anyone else can open it; no
.dmg yet (add `"dmg"` to `formats`). cargo-packager needs a `name` in its config when there's no
Cargo.toml, or it fails with "Not a directory".

## 2026-10-24 — the shelf's two sides slide

Switching between Past notes and Recipes (the switch, or ⇧⌘Y) slides the new side in 8px
(`offset.dialog`) from its own side of the switch, Past notes from the left and Recipes from the
right, fading in over `enter('fast')`, 160ms. The old side goes at once, so a switch never
waits on an exit. Opening the panel doesn't slide its side, since the panel already has its own
entrance. With reduced motion the switch is instant.

In the renderer: a click on a recipe 10ms after switching lands (the contract warns that a moving
element can swallow clicks; this one is the click's own container, and it didn't). Six switches
40ms apart settle on the right side. check-recipes and check-tabs pass.

## 2026-10-24 — the timeline glides to a paragraph

A tick on the timeline (or its preview's Go and Edit) used to jump the note to the paragraph. It
now glides there with the glide that brings the note back to the composer, generalised in
`ui/glide.ts`: `glideToItem` lays the frames out from the paragraph, above it coming down and
below it going back up, as `glideToEnd` lays them out from the end. Edit puts the caret in once
the glide lands. One glide runs at a time; a new one stops the last.

- **Measuring.** Only negative offsets resolve against measured rows; a positive one is kept as
  given and doesn't compare with a resolved anchor. So the distance is always searched upward:
  from the paragraph to the viewport going down, from the viewport to the paragraph going up.
- **Slow frames.** The first frame onto rows the note hasn't drawn can hold the app for about a
  second (the old jump did too). The glide used to be timed by the wall clock, so that one late
  frame skipped it to the end. Now a frame moves the glide on by two frames at most, so it pauses
  and carries on. It still lands within 0.6s of its duration, however slow the frames are.
- **Hidden windows.** In a check's never-shown window, JS timers sometimes run a second apart
  (it isn't App Nap: an NSProcessInfo activity didn't change it; it varies run to run). So
  check-timeline asserts that the note lands on the paragraph and never moves backwards, and
  prints how many positions it saw rather than asserting a count. Healthy runs see 5–8
  (368 → 262 → 126 → 70 → 50 → 46 → 43 → 42 going down). Under reduced motion it's one jump.

check-timeline (full ×3, reduced), check-glide (full, reduced), check-motion and check-changes
pass. check-tabs passes on HEAD plus this change in a clean worktree; in the shared checkout it
fails at History's outside click, from another session's History.tsx work in progress.

## 2026-10-24 — pasted images open full size

A click on an image under one of your paragraphs opens it over the whole window
(ui/ImageViewer.tsx). The scrim is near-black in both themes, the way photos are looked at. A
small image shows at its own size and a large one fits the window (core/imagesize.ts reads the
size from the PNG/JPEG/GIF/WebP header, since GPUIX's <img> doesn't report one). ← → step through
the paragraph's other images and wrap around. Esc, the ✕ or a press on the dark closes it, and
the composer takes the caret back.

A press handler on a parent of a `motion.div` never fires for a press over it: the motion layer
takes the hit. So the scrim's handler sits on the motion layer itself.

scripts/check-viewer.ts writes a note with two images straight to disk, because ⌘V never reaches
a window running in the background (GPUIX_BACKGROUND=1). For the same reason
scripts/check-images.ts fails at its first paste on this machine, back to the commit that added
it. That's the environment, not the code.

## 2026-10-24 — deleted notes wait 30 days in Settings › Trash

Deleting a note moves its records from threads/ to trash/, next to a small JSON file saying what
the note was and when it was deleted (core/trash.ts). Its tab closes and its agent ends first.
Settings › Trash lists deleted notes with the days left. Restore puts a note back in Past notes as
it was. Delete asks first, then removes the note for good, and Empty Trash does the same for all of
them. Anything 30 days old is deleted for good at launch and whenever the tab opens. Pasted images
stay in images/, so a restored note still finds its images.

In Past notes, the hovered or selected row shows a trash button, and ⇧⌘⌫ deletes it. The shortcut
isn't ⌘⌫ because the search field keeps ⌘⌫ and ⌘⌦ for itself (delete to the start of the line),
and they never reach its onKeyDown. ⇧⌘⌫ does. The trash button sits beside the row rather than
inside it, so pressing it doesn't open the note. Both sides of the panel are 480 wide, the width Recipes always had, so switching
between them doesn't resize it under the slide. These History changes are built on the search view
(ui/SearchResults.tsx), which wasn't committed yet when the trash was. scripts/check-trash.ts covers
the whole flow.

## 2026-10-24 — a file chip opens the file beside the note

Pressing a file chip opens that file in a pane beside the note (ui/FilePreview.tsx). This works
in your paragraphs and in the draft's chip row. A line chip opens the file at its line, with the
line washed blue. Markdown renders, with a Source toggle; code is highlighted with line numbers
(`<code path=…>` picks the language); plain text reads as it is. When the window has room
(`previewLayout`: the pane is 44% of the window, 440–720 wide, and the note keeps at least 560),
the note narrows beside the pane. Otherwise the pane slides over the note's right side. Pressing
the same chip again closes it, and so do the ✕ and Esc. Each note remembers its own open file.
The file is read again whenever the note changes, so an edit Claude makes shows up.

core/preview.ts reads a file under the same rules as diffs: only inside the note's folder, and
never anything that looks like credentials. When a file can't be shown, it says why (outside the
folder, missing, a folder, binary, over 4 MB). Past 5,000 lines it shows the first 5,000, since
`<code>` builds a row per line. JSON has a slot of its own: a view in `previewViews.json` takes
over from the code view.

GPUIX mouse events have no stopPropagation, so a chip's click also reaches its paragraph, which
would open the paragraph for editing. The paragraph skips a click that a chip took in the last
100ms (`chipTookClick`). Each file and mode gets a new scroll box, so it starts at the top
instead of keeping the last file's scroll position.

Lines picked in the code view go into the draft. Press a line number, then drag or ⇧-click to
stretch the pick; "Add to note" (or ↵) puts `#path:12-18` on the end of the draft, and Esc clears
the pick before it closes the pane. A range is a file tag with `endLine` (core/tags.ts). Its chip
reads `:12-18`, and the prompt quotes those lines with their numbers (`12 | …`). GPUIX mouse moves
only reach the element under the pointer and don't bubble. So the strip over the line numbers
takes the moves itself, and while a drag is on it stretches across the code, so a pointer that
drifts right doesn't lose the pick.

Hovering a file chip no longer opens a slice of the file under the paragraph: the pane does that
job, at the chip's lines. "Read whole file" went with it. Older notes that widened a tag keep the
widening (`vellum/tag-scope`), and prompts still honor it. A hunk pill still opens its diff on hover.

Not yet: comments on lines, and opening file paths from Claude's tool calls.

## 2026-10-24 — the file pane is a card of its own, with a path pill and the folder's tree

The pane is no longer a slab inside the note's card. It's a second card beside it, with the
same corner and the window's 4pt gap; in a narrow window it still slides over the note. The
header is pills, the strip's kind (26–28pt, `chipBg`, a hairline). The path runs from the note's
folder to the file, and pressing a folder in it opens the tree there; when there's no room the
outer folders fold into one "…", estimated from mono character widths, since GPUIX can't measure
text before layout. "Show changes" appears when this note edited the file: it swaps the file for
the note's hunks to it, oldest first, the same hunks as the Changes sheet. One pill holds copy
path and Open in, which moved here from the strip: the same menu of Finder, editors, terminals
and git clients. With a file open, an editor gets the file and Finder shows it selected
(`open -R`); terminals, git clients, and everything when no file is open, get the note's folder.

The tree (core/filetree.ts, ui/FileTree.tsx) is read a folder at a time as folders open, cached
until the note changes. `.git` and anything that looks like credentials are left out; what git
ignores (`git check-ignore --stdin` per folder) is dimmed, not hidden; files the note changed,
and the folders they're in, carry a dot. It opens on the file's folders. Its keys are ↑↓←→ and ↵.
⇧⌘E or the header's left button shows and hides it, and the choice is kept
(`fileTree` in settings). The Files button beside History opens the pane on the tree alone.
With the tree, the pane widens by up to 220 while the note keeps 560; past that it goes over.

## 2026-10-24 — the draft writes files by name and reads as chips once you look away

A picked file goes into the draft as its name alone, `#printed.ts:20-24`; the tag keeps the
whole path, and that's what Claude gets. When two of the draft's files share a name, both
lengthen to the shortest end of their paths that tells them apart (`fileLabel`, `relabel`,
run whenever a tag joins the text). Reading text back, `tokens` takes a written path to the
tag with exactly that path, else to the first whose path ends with it on a `/`. So older notes
with full paths read as before, and `#ts` never matches `a.ts`.

GPUIX's textarea draws no decoration of any kind: `highlight` washes ranges in `<text>`, but not
inside a textarea, on it or on a parent (tried). So the chip row under the composer is gone, and
instead the draft reads as a sent paragraph does while you're not writing in it. It's the same
TokenText, its chips `draft-chip-N`; a chip opens its file in the pane, and anywhere else goes
back to writing. The textarea stays mounted, out of the layout, invisible, so focus and ⌘↵
still reach it. "Not writing" is a press outside the composer (`onMouseDownOutside`), as for a
paragraph being edited, because a click on empty space doesn't take a GPUI field's focus. Typing
brings the textarea straight back. Editing a tag's name turns it back into a `#` search.

## 2026-10-24 — JSON in tool details

Tool inputs and JSON object/array results use components/JsonViewer.tsx with type colors, nested branches, search with match navigation, paged children,
copy value/path, and the current path below the tree. Text results keep the existing text view.
Tool cards keep their frameless surface; the standalone viewer can draw its own frame.

Rows unfold with height/opacity tweens, and the active wash moves with top. Branch closure is
atomic. Native scroll offsets jump after row layout settles, since scroll position cannot be
tweened. Plain treeitem overlays own row clicks and keyboard input. Tool headers now use the
same visual/overlay split, so the parent entrance cannot consume a JSON control's click.

Native checks passed at 800px dark/full motion and 460px light/reduced motion: nested paths,
search beyond the first page, revealing the match, clearing search, arrow/Home/End navigation,
paging, expand/collapse, ten rapid toggle pairs, immediate tool/header clicks during entrance,
and JSON/text tool results. A scratch Vellum document at 1080px also passed structured input,
result search and composer draft persistence. The source passed scoped Biome checks. No build
or tsc was run. Preview data stayed in scratch storage.

## 2026-10-24 — notification center in the component kit

components/NotificationCenter.tsx provides the notification panel and bell control.
It exports NotificationCenter and NotificationTrigger. The component accepts items
and read/dismiss/open callbacks; fresh caller data replaces its local view. It is deliberately
not mounted in app.tsx and has no agent-event producer or notification storage.

The panel has All/Unread views, expandable descriptions, mark read/unread, mark all read,
dismiss, clear read, and empty states. The bell badge uses the real unread count, showing 9+
above nine. Actor photos are optional and otherwise use initials. Counts fade/rise, the view wash
slides, details reveal to measured heights, and the read action tweens between measured widths.
All motion uses kit tokens and reduced motion; the elevated panel closes atomically.

Native checks found that mouse-down could reach the full-window backdrop beneath click-only
panel controls. PopoverBackdrop now accepts an optional excluded content ref, used here to
ignore presses inside the panel. The bell suppresses only the click associated with that outside
press, reset by the next mouse/key down. Native scrollIntoView did not reveal the last row in
this anchored list, so keyboard navigation uses measured bounds and the scroll parent's offset;
Scroll exposes an optional native ref for that. Existing callers keep their prior defaults.

Checks passed at 860px dark/full motion (uncontrolled open) and 360px light/reduced motion
(controlled open): real badge counts, read/unread and bulk callbacks, filtering, dismiss, empty
states, caller-data updates, a 30-row scroll list, keyboard End/reveal, focus restoration,
composer input, ten rapid close-button cycles, ten rapid bell-toggle cycles, and outside dismissal.
The panel stays within the window at both widths. Scoped Biome and diff whitespace checks passed.
The temporary preview used sample data only; no build, tsc, app wiring or agent integration ran.

## 2026-10-24 — the tree as a card, git status, a right-click menu, resizing, long lists

The tree is an inset card down the pane's left side: the folder's name, then search, new file
and new folder. Folders draw as the two folder icons supplied for it, shut and open. The file
beside it is a tab rather than a path pill. The header's tree button is gone; the folder button
is at the strip's right end now (⇧⌘E still works), and the account pill moved to the left, after
History, its menu's last item reading "Settings…".

Marks are git's own status (`git status --porcelain -z`, fsmonitor off): M, A, U for untracked,
R, D, with a dot on every folder above a change. Outside a repo they fall back to this note's
edits. Search collapses folders without matches rather than listing results flat: the folders
holding a match open, the rest close, matching names are washed, the first match scrolls into
view, ↵ opens it. A right click (`onAuxClick`, at the pointer) offers Open, Add to note (a file
or `folder/` tag in the draft), New file/folder here, Copy path, Show in Finder and Rename.
Rename and new names are typed in the row, never over something that's there, and stay in the
note's folder (`renameEntry`, `createEntry`).

Images (png, jpg, gif, webp, bmp, ico, up to 32 MB) show as themselves with their size, and open
full size; any other file with a NUL in its first 8 KB is binary and shows `hexdump -C` of its
first 4 KB.

The pane's left edge and the edge between the tree and the file drag to resize. GPUIX sends
moves only to what's under the pointer, so a press on an edge puts a cover over the window
(app.tsx `resize-cover`) that follows the drag. The pane stops where the note would have less
than 560, the tree between 160 and 360 (the file side gives what the tree takes), the file side
at 320. Both sizes are kept (`previewWidth`, `fileTreeWidth`); a double click puts one back.

Long lists mount a window at a time (ui/windowed.ts): `<virtual-list>` with `itemCount` and
`windowStart` keeps the room of what isn't mounted by estimate, and the window follows
`onVisibleRange`. A row outside the window can't be scrolled to, so `reveal` moves the window
first, then `scrollToItem`. Past notes built every row before (400 notes, 400 rows); now it builds
about 40, rows are memoized so a hover rebuilds two, and each note's lower-cased text is cached
for search (scripts/check-history.ts). `<code>` draws one element per line, so the pane's code
goes in blocks of 100 lines, each its own `<code>`, with line numbers drawn beside so they count
on; a block highlights alone, so a comment that crosses into the next can lose its colour there.
Long markdown goes in pages split at a blank line before a heading or paragraph, outside fences.
The tree's rows are windowed the same way, for node_modules.

## Session and weekly usage banners (2026-10-24)

`components/UsageLimitBanner.tsx` follows the supplied usage notices: a neutral rounded
surface, a gauge, a muted reset time and a grey Get more usage button. Approaching notices
can be dismissed; reached notices use red on the gauge and title. The copy and actions
stack at narrow widths. Light and dark colours come from the current material.

`core/usage.ts` reads Claude's actual `allowed_warning` / `rejected` rate-limit metadata
from ACP `usage_update._meta['_claude/rateLimit']`. Five-hour limits are session limits;
seven-day limits are weekly, preserving Opus/Sonnet scope. Reset timestamps are supplied by
the adapter, converted from seconds and formatted locally; session resets within an hour
show minutes. No threshold, percentage or reset time is invented. `allowed` clears the live
notice, and moving to another account clears it too. Old logs with known quota-error wording
still get a banner, keeping their reported reset text when no timestamp exists. Context-length,
API throttling and other errors retain their normal error presentation.

Warnings appear above the draft. A reached error replaces the old error surface; the same
live notice is suppressed when the current turn already contains that error. Identical quota
replies emitted before an ACP or legacy error are removed. Historical errors stay in the note;
active timestamped notices hide after their reset. Get more usage opens Claude's Usage settings
through `core/platform.ts`; it does not purchase usage, retry a turn or send the draft.

Verification: temporary reducer/native preview checks passed for warning/rejected/allowed,
weekly model scopes, reset formatting, account changes, duplicate replies and legacy errors.
Native previews at 1000px dark and 360px light (Reduce Motion on) passed layout, recovery-button,
dismiss/restore, expired-notice and composer checks. Scratch-home Vellum checks passed session,
weekly, warning and ordinary-error cases, including saved drafts and one notice per failure.
All account/agent fixtures were isolated; no live quota was exhausted. Previews are in
`screenshots/usage-dark.png`, `usage-light.png` and `usage-in-vellum.png`.

Biome passed the new banner/helper and component export. Hook/unreachable checks passed the
four integration files; their broader lint run still reports existing findings elsewhere in
those files. `git diff --check` passed. No build, tsc or permanent test files were added.

Usage-banner follow-up: removed Get more usage and its URL plumbing at the user's request.
The banner now fits its content up to the note's width, with title and reset on one row at
all sizes. Both labels use single-line ellipsis; the reset yields space first. The warning's
close button remains fixed and clear of the text. Native dark/light previews verified widths
900, 600, 400, 280 and 200: no wrapping, overlap or recovery button. Current previews are
`screenshots/usage-row-dark.png` and `usage-row-light.png`. Earlier screenshots above show the
superseded button/stacked layout. Scoped Biome and whitespace checks passed; no build or new
permanent tests.

## v2 — Browser and capture (2026-10-25)

- Added an authenticated loopback bridge, capture files under `paths.captures`, and append-only
  capture/browser records. The extension Origin is fixed by its public manifest key. Agent
  credentials are separate, scoped to one note, and passed through session-local stdio MCP.
  Stdio ships without a paid capability probe; `/mcp/<noteId>` backs the forwarding adapter.
- Pairing lives in Settings › Browser. Replacing the pairing token also closes existing event
  streams. Page scripts cannot read the token. Extracted page material is labelled and fenced as
  untrusted data; the user's annotations remain the instructions.
- Send requests retain a durable delivery intent until a user turn is recorded. Busy notes use
  the existing queue; pending sends recover after restart. Taking browser control cancels the
  running turn and holds the note's queue until hand-back. Commands already running may finish,
  so the viewer says this explicitly.
- The `browser` helper registers the isolated note session before navigating, uses acknowledgement
  pacing for frames, and saves implicit screenshots under the note. Existing browser records
  restore lifecycle tracking at launch. Native packaging copies the browser launcher and stdio
  MCP helper beside the executable under `helpers/`; the browser implementation is compiled
  through `bin.ts --browser`. Native bundle packaging itself was not run in this change.
- The extension was scaffolded from Vite+'s vanilla TypeScript application template, per the
  latest user instruction. Its own package adds Vite+ 1.1.0, the public selection primitives
  package 0.2.0, and Chrome development types. These replace the plan's older handwritten-picker
  and Bun-only bundler restrictions. The native runtime gained no dependencies.
- Selection, annotation, style/layout/source extraction, debugger screenshots, animation timing,
  triggered pseudo-states, sampled interaction motion, frame seeking and readable asset downloads
  are implemented. Infinite animation timing is preserved explicitly. Frame selections are
  rejected with a useful message; React source details remain best effort in the isolated world.
- `bun run build:extension` produces `extension/dist/` for Load unpacked. Optional browser video
  recording is left out. No real Claude turn was run. Cross-origin styles/assets and React source
  availability retain the browser limitations described in extension/IMPLEMENTATION.md.
- Verification passed: `scripts/check-bridge.ts` (auth, Origin, traversal, note scope, stdio MCP,
  status replay, token rotation, trash/restore, durable send recovery); `scripts/check-browser.ts`
  (native inspector/settings, fake stream frames and input, take-control queue hold, fake-agent
  delivery and MCP injection); existing check-tabs, check-queue, check-approval, check-help and
  check-settings. An isolated real browser also opened a local animated page, reported its
  stream, saved a screenshot and delivered acknowledged live frames. Focused Biome checks had
  no errors; existing unused-import/suppression warnings were left alone. No tsc was run. A real
  unpacked Chrome extension then paired with a scratch bridge, injected its selector, selected
  a local animated component, extracted CSS/timing, took debugger screenshots and delivered the
  multipart capture to its selected note. All temporary browser sessions were closed.

### Automatic extension connection (2026-10-25)

The user removed setup from the connection flow. Both sides now share port 47470; the extension
checks the desktop's nearby fallback ports only when necessary. A POST /connect restricted to
the fixed extension Origin and extension-ID header supplies an internal credential to the
service worker. It is kept in memory and refreshed automatically after revocation. Web origins
and requests without extension provenance cannot discover it. Old stored addresses/tokens are
removed. The popup has no setup form or pasted link, retries while Vellum is closed, and opens
straight to capture controls when available. Desktop Browser settings show readiness only.
The rest of the extension design is deliberately unchanged pending the user's later direction.

### Extension follows the desktop (2026-10-25)

The popup and page capture panel share Button, Textarea, Checkbox and SegmentedControl
components and motion tokens. React DOM, Motion, Radix Checkbox and Lucide are
extension-only dependencies for these components. Geist faces are bundled from Vellum's assets.

The default surfaces are the desktop's #0a0a0a shell, #141414 page and #1c1c1c popover, with the
same neutral controls, blue selection/focus and small violet identity mark. The extension asks
the existing authenticated /health route for the desktop's current material, instead of taking
its theme from the website or OS. Both extension surfaces share the same tokens and components.
No connection setup was reintroduced. Copy uses note, capture, agent and Pending consistently.

Design verification: the unpacked extension's popup and injected capture panel were inspected in
Chrome using a scratch bridge. Desktop dark/light colors and bundled Geist loading matched;
320px, popup 200% zoom, RTL layout, visible keyboard focus, note-empty state, annotation,
selection Undo and real screenshot/style/animation delivery passed. The border correction in
the light material clears 3:1. Scope and remaining verification limits are recorded in
extension/DESIGN-REVIEW.md. The only generated build is the updated unpacked extension.

## 2026-10-25 — scripts, app.tsx and the extension build on Bun's file APIs

Everything outside `core/` now uses Bun's APIs instead of `node:fs`, `node:url`, `node:readline` and `node:assert`. Only `node:os` and `node:path` stay. `scripts/scratch.ts` holds the few helpers Bun doesn't have. Gaps found on Bun 1.4.3 that the `core/` pass will hit too:

- **No mkdtemp.** `scratchDir(prefix)` makes `<tmp>/<prefix><uuidv7>` with `/bin/mkdir -m 700`. Bun's shell has its own `mkdir`, which doesn't take `-m`, so call the system one by path.
- **`Bun.file(p).exists()` is files only.** It returns false for a folder or a socket that's there. `present(p)` uses `stat()`.
- **`Bun.write(p, data, { mode })` ignores `mode`** (0o600 came out 644). Anything that must be private (tokens, the bridge file) needs a `chmod`, or the system tool, after writing.
- **No append.** `Bun.file(p).writer()` truncates. `scripts/fake-acp.ts` keeps `appendFileSync`, since several fake agents append to one log. The notes' `.jsonl` files are append-only, so `core/threads.ts` has the same question.
- **No synchronous read.** `Bun.file().text()` / `.json()` are async. app.tsx reads its fonts with a top-level `await` before `render`. `core/store.ts`'s `readSettings()` and the `useState` initialisers that call it read synchronously at launch, and that's the main design question for `core/`.
- **What does map one-to-one:**
  - `Bun.write(dest, Bun.file(src))` copies, and `Bun.write` creates missing parent folders, so a `mkdir -p` before it is redundant.
  - `new Bun.Glob('*').scanSync({ cwd, onlyFiles: false, dot: true })` lists a folder like readdir.
  - `` Bun.$`rm -rf ${p}` `` removes.
  - `for await (const line of console)` reads stdin by line.
  - `expect` from `bun:test` works in a plain script and takes a message as its second argument.
  - `Uint8Array#toBase64()`.
- **What the typechecker doesn't catch** when a sync helper turns async: a spread (`{ ...settings() }` spreads a Promise into `{}`), template strings and `JSON.stringify`. Grep for un-awaited calls after converting.

### core/ on Bun: what went async, and why the rest didn't

The rule is the frame, not the API. A read that can land inside a render, or that spawns a process, went async. A small read outside render stayed synchronous, because Bun's sync read of a small file is faster than its async one (measured: 10 MB of notes is 4–8 ms either way, and parsing them is 20 ms).

- **Launch:**
  - app.tsx reads the drafts, every note (side by side), the fonts and the account picture in one `Promise.all` before `render`.
  - Settings, accounts, the model cache and the activity ledger each load with a top-level `await` in their own module.
  - The 30-day trash purge no longer runs before the first frame.
- **Render:**
  - A reply's pasted images and the new-note sheet's folder-config warning used to stat files on every render. They now check once per list or folder through `ui/useLoaded.ts`.
  - Recipes are read in parallel through `useLoaded`. Only a `$recipe` send waits on the disk; any other send goes out in the same tick.
- **Writes:**
  - A note's `.md` copy is written with `Bun.write`, queued per note so they land in order.
  - The `.jsonl` records keep `appendFileSync`, so a record survives a quit.
- **Still synchronous, on purpose:**
  - Renames, links, lstat, readdir and realpath, which have no `Bun.file` form.
  - `filePatch` (its 2 MB cap makes the diff, not the read, the cost).
  - `readPreview` (≤ 1.3 ms on this repo).
- **The file tree is listed from memory** (`core/filetree.ts`):
  - **Stamps:** each folder's listing is kept with a stamp: its modified time, plus every `.gitignore` that applies.
    - Adding, removing or renaming anything in a folder moves its time. Editing a file's contents doesn't.
    - So FileTree's re-read after every agent edit costs a few `stat`s per folder, not a `git` process. Before, each folder took 5–10 ms in render; from memory it's 0.01–0.3 ms.
  - **Background mapping:**
    - Listing a folder maps its subfolders in the background.
    - `prepareTree` maps a note's folder two levels deep when the note becomes active.
  - **Not covered:** ignore rules from outside the workspace (a parent repo's `.gitignore`, the global excludes file) aren't in the stamp. A change there shows on the folder's next real change.

## 2026-10-26 — Codex and OpenCode notes (v3)

An account now has an agent: Claude, Codex or OpenCode (`core/agents.ts`). VELLUM-V3-PLAN.md has the spike results and the decisions. What wasn't obvious:

- **Modes:**
  - Vellum keeps its six modes; each agent maps them onto its own config options, matched by category, not id.
  - Codex's Plan is two options, the sandbox and `collaboration_mode`. A response to Vellum's own `set_config_option` is therefore never read as "the agent changed its mode": between the two sets, the half-applied state looks like Ask.
- **Codex runs your `codex`:** the adapter bundles a 327 MB Codex that can't go into the compiled app, so `CODEX_PATH` points it at yours. Codex refuses a `CODEX_HOME` that doesn't exist, so a new Codex account makes its folder.
- **Codex sign-in:** the adapter's sign-in methods are ones it runs itself, but `codex login` works in Vellum's login terminal, and `codex login status` exits 0 or 1 without a session.
- **OpenCode sign-in:** OpenCode lists retired free models as available (`exo-free` fails with "deprecated"). A fresh home's default can fail like that; the note shows OpenCode's error.
- **Vellum's prompt:** only Claude's adapter takes `systemPrompt`. For the others the prompt goes ahead of a new session's first message, once, without the lines about Claude Code's own tools.
# New note — project selection, October 26

New note leads with project names and their parent paths. The agent/account selection is a
compact menu; adding an account and signing in remain available. Cmd-Enter creates the note.
The existing native check-new-note script passed for current-folder/account defaults and a
different folder. Native GPUIX checks also verified account switching and exactly one new
note when Cmd-Enter is pressed from the sheet, account selector, or Create button. The final
dialog and account menu were inspected in screenshots. Scoped Biome passed; no build run.


# Library search and global annotations — October 26

⌘K now opens Library on Past notes with search focused, or closes it on a second press.
From Recipes it switches to Past notes. The separate note switcher and right-side Find button
are removed; Library keeps its existing search, filtering and windowed results.

The right-side pencil opens Annotations across all loaded notes, grouped by page host/path.
Cards retain their destination note/project and show captured elements together, because status
belongs to the capture. Open is queued/acknowledged; Resolved and All, site/project filters and
text/component/selector search are available. Bridge capture records update the panel live.
Open note reveals the capture block, thumbnails open its inspector, and actions resolve,
dismiss, reopen, send to the agent, or send to another note. Sending to another note atomically
copies all capture assets with a fresh id, preserves the source files/history, dismisses the
source and queues the destination. A failed asset copy cleans up its temporary directory.

Verified with scratch homes and a fake ACP agent: Library keyboard toggling and Recipes switch;
page grouping across projects; status/site/project/search filters and empty state; live bridge
summary updates; resolve/dismiss/reopen persistence; capture jump above 45 later paragraphs;
thumbnail inspection; destination input focus and arrow/Enter selection; complete asset copying,
source preservation, missing-asset cleanup, destination recording/delivery; reduced-motion
panel dismissal. Inspected the native panel screenshot. A native input submits Enter separately
from key bubbling, so Menu headers can now receive a submit callback for the highlighted item.
Scoped Biome undeclared-variable checks and git diff whitespace checks passed. No build or tsc,
and no permanent test file added.

# Browser connection port — October 26

Browser settings now show the active loopback address and a persisted connection-port field.
Blank means Automatic: use the default discovery range and skip occupied ports. A custom port
binds exactly that port; a conflict is reported instead of silently choosing another. Changes
apply at the next app launch to preserve active agent/MCP connections. VELLUM_BRIDGE_PORT keeps
its launch override (including port 0 for scratch checks). Snapshot's popup has matching
Connection settings, available while offline, for choosing the same custom port.

Scratch native checks verified invalid input rejection, save persistence, clearing to Automatic,
keeping the running endpoint intact, and binding the saved port after restart. Direct bridge
checks covered occupied custom ports and automatic fallback. Inspected the settings screenshot.
Scoped Biome and whitespace checks passed. Rebuilt only the Snapshot extension into extension/dist;
no desktop app build or permanent test file. Reload the unpacked extension to use its new field.

OpenCode investigation: Vellum already resolves local opencode from PATH and starts `opencode acp`,
retaining its default environment/configuration. The installed /Users/APPLE/.opencode/bin/opencode
(v2.0.26) successfully answered Vellum's initialize request with ACP protocolVersion 1. No session
prompt was sent. No OpenCode launcher change was needed; a separate custom executable path is
not currently exposed as a setting.

# OpenCode stale login status — October 26

OpenCode's accountStatus previously returned undefined unconditionally, so a persisted loggedIn:
false could never refresh after an external login. It now asks the local `opencode auth list
--format json` for provider connection metadata. Model-provider credentials mark the profile
connected; MCP-only credentials, no stored credentials (free models/environment keys may work),
unsupported CLI output and failures leave its status unknown rather than logged out. Unknown
status clears stale identity/plan labels. No credential files are read or copied.

An OpenCode provider authentication error no longer marks the whole profile logged out. The
note preserves the agent's actual message with its login action, instead of replacing it with
"Not logged in". ACP -32000 remains authentication-required; text matching is restricted to
explicit authentication phrases. Finishing login with unknown status reports "sign-in finished".

Verified local OpenCode reports three model-provider connections and creates an ACP session;
the inspection session was deleted without a prompt. A scratch native profile seeded loggedOut
refreshed to connected, rendered its provider count, and stayed connected after a fake ACP
provider authentication error whose real message was preserved. Existing scripts/check-agents.ts
passed for all three agents. Isolated CLI-output checks passed for connected, empty, MCP-only
and unsupported output. Scoped Biome and whitespace checks passed. No app build or permanent
test file added.

# Provider tools, settings and simulator guidance — October 27

OpenCode defaults to opencode/big-pickle unless the note has an explicit model.
A real Big Pickle ACP request returned OK. The earlier Go-provider request used an
expired API key; ACP reported generic authentication-required. Signing into
OpenCode does not renew that provider key. Accounts now labels the provider action
Manage providers rather than Sign in; provider presence is not a validity guarantee.
Manual status refresh is available per account. Background status checks use separate
Claude/OpenCode/Codex cadences (5/10/30 minutes), not assumed token lifetimes. The
agent remains responsible for refreshing OAuth. Claude's authentication docs describe
renewal and expiry warnings without promising a fixed eight-hour logout interval;
Codex's auth docs describe cached sessions and automatic renewal during use.
References: https://code.claude.com/docs/en/authentication and
https://learn.chatgpt.com/docs/auth .

Tool updates across Claude, Codex and OpenCode now pass through core/tools.ts.
Canonical inputs and real outputs stay separate; OpenCode metadata-only completion
and Codex terminal deltas no longer replace output with transport metadata. Replaying
the affected OpenCode note recovered eight command outputs. The focused ACP reducer
checks passed (13); the agent configuration checks passed (4). Tools use readable
input/output details rather than the JSON tree viewer. Auth errors use one compact
row with a shield-cross icon and login action.

Model search filters names, ids and descriptions, supports spaces and keyboard
selection, and has a bounded results viewport. Model and effort popups use the custom
spring wrapper. Native checks covered filtering, empty results, selection, effort
opening/escape, row padding and reopening. Thinking visibility is persisted, defaults
to the simple view, and does not hide tool results. GPUIX wheel containment uses
pointerEvents: auto on the nested scroll surface: native scroll events do not expose
stopPropagation. Scratch native checks verified the thinking content scrolls while
the note and composer stay fixed.

Settings sidebar is Accounts, Vellum, Appearance, Browser, Activity and Trash.
Vellum groups thinking, note defaults, instructions and notifications. Appearance
groups theme, tabs and motion. Persisted keys are unchanged. Scratch native checks
verified grouping, provider label/manual refresh, thought preference and containment;
inspected the settings and picker screenshots. Updated existing smoke-script selectors.

The mobile prompt now prefers the existing native tools, allows an installed CLI,
and reserves scripts for deeper workflows instead of banning scripts. It maps all
seven mobile tools and explains snapshots, failures and fill verification. The
installed SimDriver 0.1.2 package does not ship a CLI executable. docs/mobile-tools.md
records the tool/step arguments and a proposed future CLI mapping using the same
handlers. An MCP SDK client discovered all seven tools through the real stdio proxy;
a fake connected driver verified snapshot text/images and failed-step/current-screen
results, plus the disconnected-phone error. No live simulator actions were taken.
Scoped Biome undeclared-variable checks passed on 19 files; whitespace checks passed.
No desktop build or tsc was run. Temporary verification scripts were removed.

# Complete mobile SDK surface and settings structure — October 27

Expanded the earlier seven mobile tools to ten. core/mobile-tools.ts now owns the
schemas/dispatch; the bridge retains authentication and note scoping. Added
mobile_connection (devices, status, connect, disconnect, boot, shutdown), mobile_input
(raw coordinates/phases, two-finger input, keys/combinations/text and held/repeated
buttons), and mobile_inspect (status, stats, raw accessibility, dimensions, every Grid
operation and recent diagnostic/frame metadata). Snapshot forwards settleMs/cols and
preserves all returned metadata. Every Rust Step variant is advertised with its
arguments, rather than an action-only schema. Existing configuration actions have
explicit schemas too. Calls across notes share one queue; raw input validates its
whole batch before dispatch and releases active contacts after runtime failure.

Checked the actual ~/dev/simdriver/bindings/node/index.js and Rust agent Step enum;
the installed JS wrapper matches the checkout. Its drag signature uses an options
object and accessibility returns parsed JSON, despite stale generated declarations.
The view still owns streaming BGRA frames and the driver. MCP connect opens that view,
passes start options, reuses the selected connection, and disconnect updates the UI.
The existing mobile view's cancelled scroll phase is normalized to native ended.
Driver event-pump internals stay inside the SDK; diagnostics/frame metadata are exposed
without draining the view's stream. The full method mapping is docs/mobile-tools.md.

Verified through the real stdio MCP proxy with a fake driver and simulated xcrun:
all ten tools; schema parity with every Rust Step; snapshot metadata/options; all raw
input families; drag/button parameters; validation before input; failure contact
release; all inspection/Grid methods; events; tap expectations; failure screen state;
concurrent request order; configure/notify/reset; device lifecycle and shared-driver
status. The native window check used a mocked SDK and fake devices: tool-driven view
opening, connection, start options, driver reuse, disconnection and closing passed.
Existing scripts/check-bridge.ts passed its capture, token and note-isolation checks.
No input was sent to the user's simulator and no paid agent prompt was sent.

Settings uses grouped navigation and content surfaces with Vellum tokens:

| Surface | Implementation |
| --- | --- |
| 248px sidebar with search and grouped icon links | ui/settings/Navigation.tsx |
| Inset content card, 720px content and page heading | ui/Settings.tsx |
| Searchable settings metadata | ui/settings/catalog.ts |
| Rounded groups, 64px rows and inset dividers | ui/settings/controls.tsx |
| Theme previews | ThemeCards with the existing dark/light materials |

Vellum is the initial page, keeping thinking, note defaults, instructions and
notifications together. Appearance holds theme previews, tabs and motion. Accounts,
Browser, Activity and Trash keep their controls and saved keys. Search indexes groups
and account names, filters navigation, shows page links and edits the actual stored
preferences. Browser/Activity/Trash use the same settings group surface without
changing the shared modal Sheet components. Existing settings/tab smoke selectors
were updated; long-page checks find notifications/instructions through search.

Scratch native checks passed for the 248px sidebar/content split, initial page, note
defaults, cross-page search and empty state, edits in results, browser port, both theme
cards, tab/motion persistence, accounts controls and Back to note. Inspected 1200x900
screenshots of Vellum, search results and Appearance in dark/light.
Scoped Biome checks passed on 17 files and diff whitespace checks passed. No build or
tsc. Temporary verification scripts were removed; existing user work was preserved.

# Native notifications and compact New note dialog — October 27

Replaced AppleScript notifications with a branded accessory app using macOS
UserNotifications. native/Notifications.swift owns permission, delivery, dismissal
and click callbacks; scripts/notification-helper.ts caches/signs the small helper
for source runs, and packaging includes the helper bundle. Native clicks activate
the parent process and open the relevant note; they never approve a request. macOS
controls notification materials/appearance, including the system glass treatment.
The GPUIX layerShell reference is Wayland-only and does not provide macOS banners.

core/native-notify.ts prefers GPUIX native methods when present; installed 0.11.0
uses AppKit key-window focus detection and the helper fallback. core/notify.ts now
records live requests, errors and replies in an in-memory inbox, with pending Dock
badges and compact foreground alerts for other notes. Background native delivery
respects Never/Requests/All. Reading does not resolve requests; answering/cancelling
settles and dismisses the exact alert immediately. Delayed startup/permission work
rechecks focus and request relevance. Settings exposes native permission status.

ui/Notifications.tsx supplies the shared inbox, Needs you filter and note actions.
New note uses a 440px panel, compact plain header,
52px folder rows and a same-surface footer, retaining existing account/folder flows.

Temporary policy/helper checks passed for focus, routing, deduplication, preferences,
resolution, stale delivery suppression and helper callbacks. Scratch native UI with
a fake agent passed approval/question navigation and immediate badge resolution,
outside dismissal/reopening, the compact dialog and notification settings. No paid
agent prompts or real simulator input were sent. Helper self-check and OS status
query passed; latest permission is authorized. A visible desktop banner and actual
OS notification click have not yet been exercised. Only the small Swift helper was
compiled; no desktop build or tsc. Scoped Biome undeclared-variable checks passed
on 12 files with the Bun global configured; diff whitespace checks passed.

# Compact tool disclosures — October 27

Tool disclosures use a 38px group summary,
40px call rows with tool-category marks, real status/duration and result counts,
then separate Input/Output details with copy controls. Native code renders results;
long output starts at 12 lines and expands within a 260px scroll area. Thinking
remains optional and has its own disclosure inside the group. Mobile code wrappers
get recognizable action labels without showing their entire script in the row.
No retry control is shown because this view has no tool-level retry operation.

Consecutive activity/agent-shell blocks share one group. Empty virtual-list slots
retain their original indices for the timeline. Shell blocks retain their normalized
call arguments and timing in core/threads.ts, including execute wrappers that carry
code instead of a command. File diffs, subagent tasks, capture activity and user
terminals retain their dedicated views. Inspecting tools pauses follow-tail until
the next user paragraph so opening results does not pull the reader to the composer.

Disclosures use Vellum motion/spring tokens and respect reduced motion. The outer
call list follows nested height changes naturally; nested details measure absolute
content so a second height animation cannot clip them. Closed/exiting bodies do
not remain interactive.

Existing core/acp-reduce.test.ts passed: 13 tests, 41 assertions, including all three
agent normalizers and OpenCode content versus completion metadata. Temporary native
UI checks passed at 1200x900 in dark/full-motion and light/reduced-motion modes:
group counts/collapse, execute input retention, separate results, previews, copy,
internal scrolling with unchanged page offset, thinking, rapid reversal and composer
use. Inspected collapsed, call-list and expanded-result screenshots. No paid agent
prompt, simulator input, desktop build or tsc. Scoped Biome checks passed on four
files; whitespace checks passed. Removed the temporary UI verification script.

# Annotations as a compact task list — October 27

ui/Annotations.tsx presents captures as a compact task list.
A 600px side panel contains search/site/project filters,
equal-width All/Open/Resolved/Dismissed filters with counts, and one continuous list
of annotation rows. Each capture row leads with the annotation, source URL, linked
note, real Queued/Seen/Resolved/Dismissed state, element count and capture age. Counts
refer to visible capture rows and update with search/site/project scope. Default
Open retains the existing inbox behavior. No running/review/PR state is invented.

Rows expand with Vellum springs into selected-element thumbnails/full notes, recorded
summary/agent response and workspace context. Details use a bounded scroll surface.
Open note, Resolve, Inspect, Send to agent, route to another note and Dismiss/Reopen
retain their existing callbacks. Escape in filter/action/routing menus is contained
so it closes the menu rather than the entire annotations panel. No core format or
bridge changes were needed. Measurements use Vellum tokens and density.

Temporary native UI checks passed at 1200x900 in dark/full motion and light/reduced
motion: compact rows/counts, all statuses, expansion/collapse, search, site filter,
actual saved Resolve/Reopen updates, destination-note search, contained Escape,
Open note and capture viewer navigation. Inspected both themes and expanded rows.
Destination dispatch/agent execution was not invoked; no paid prompt was sent. Scoped
Biome and diff whitespace checks passed. No desktop build or tsc. Removed the owned
temporary verification script.

# Approval card and MCP connections — October 27

Updated approval and server-connection surfaces. A single
approval has its pending count, real agent/server identity and elapsed wait, tool
title/reason, full argument rows, Deny, exact-rule disclosure and Approve. Existing
command/folder and diff previews remain. No risk labels or broader rules are guessed.
Arrival still leaves composer focus alone; the elevated card closes atomically.

Settings → Connections adds a live MCP manager, expandable tool rows, switches,
read policy, pause/remove, searchable Add server, remote URL and local command forms,
and real browser authorization. Context is an explicitly labeled estimate; the bar
shows server contributions without inventing an 8k limit. Server details use measured
height and the existing spring/reduced-motion tokens. Nested sheets contain Escape.
The directory uses verified vendor endpoints and displays Vercel's client restriction.

core/mcp.ts owns official SDK HTTP/SSE/stdio clients. All three adapters receive
note-scoped proxies using the existing bridge token. Credentials stay in Vellum;
OAuth uses PKCE, random callback state, discovery/registration and refresh. Enabling
reads only trusts explicit read-only/non-destructive annotations. Every invocation
rechecks switches and cancellation after approval; a deny never reaches upstream.
Changing configuration refreshes idle ACP sessions on the next message. Direct CLI
MCP configuration remains with that CLI. Details/limits: docs/mcp-connections.md.

Temporary loopback fixtures passed OAuth callback/state/PKCE and tool pagination,
private credentials/config separation, read/write/unknown/destructive policies,
disabled/paused tools, switch changes during approval, persistence/removal, local
stdio, proxy round trips and note-token isolation. A separate SSE fixture verified
bearer auth, discovery and a tool result; cancellation aborted its proxy request.
A check caught stdin EOF cancelling a request before its reply; EOF now drains
in-flight responses, while explicit MCP cancellation still aborts the exact request.

Native 1200×900 checks passed in dark/full and light/reduced motion: real connection
states, tool expansion/persisted switches, authorization sheet, catalog search,
custom URL connection, one approval, exact scoped read rule, automatic next-message
read, write approval/full arguments and denial. Inspected tool rows and approval
screenshots. The check caught the read rule missing the app's existing suggestions
flag; fixed so the native Always allow action records the chosen policy.
Existing check-agents (all three adapters), check-bridge and check-approval passed.
Scoped Biome undeclared-variable checks passed on 12 files; new modules also passed
unused import/variable checks. No desktop build, tsc, paid prompt or live vendor
sign-in was run. Temporary verification sources were removed.

# Inherited MCP servers, controls and theme — October 27

Connections now reads Codex config.toml via Bun.TOML and Claude/OpenCode JSON/JSONC
into one connection shape. Reads global/user paths, account profile configs and
explicit CLI config-path overrides; OpenCode's local array commands and this Mac's
nested mcp.servers are handled. Project-specific MCP definitions stay out of global
notes. Remote entries deduplicate by normalized URL, retaining query distinctions.
Local entries deduplicate by executable/args/environment/cwd. Source badges identify
providers; Refresh rereads configs. Disabled sources, Vellum overrides, tool switches
and read policies persist. Removed imports stay suppressed locally. Changed local
environments update the same row. Imported HTTP headers use the private credential
file and reach SDK requests; OAuth sessions owned by other CLIs are not copied.
Imported this Mac's 12 distinct definitions without starting their processes or
contacting their servers; source-file hashes were unchanged.

Replaced service initials with bundled vendor vectors for the directory and known
inherited services (Linear, Notion, Figma, Vercel, GitHub, Mobbin, Solana, HeroUI).
Unknown/custom services use a connection glyph. Asset provenance is in
assets/brands/mcp/README.md; there is no runtime favicon request.

Settings pages carried padding on their native scroll host, which GPUIX counted as
overflow. Moved that padding into the non-shrinking content region: short pages now
have no scroll range/thumb, and long pages still scroll. Shared Switch now has a
4px track and 4px thumb, retaining its existing spring and plain click target.

The tool summary's hover was painted by a square child despite the rounded parent.
Its own top/bottom radii now follow the group's inner radius and open state.
Groknight's body/chrome tokens already matched the files under
~/dotfiles/themes/editors/zed and themes/terminals/ghostty. Added semantic primary
control tokens from Groknight's violet button treatment; Button and Switch use them.
Prose and terminal ANSI stay Groknight. All native code/fenced Markdown now use the
same Pierre syntax mapping as diffs, matching ~/dev/pierre-theme/zed/themes/pierre.json
for both appearances. Primary control text contrast across default/hover/pressed was
measured: minimum 7.63:1 dark and 7.16:1 light.

Removed the Native notifications status/Enable row. Desktop-alert preferences remain;
the existing native service requests OS access automatically on its first delivery.
There is no separate Vellum enable step. macOS still owns system permission.

Temporary fixtures verified TOML/JSON/JSONC conversion, nested commands, headers,
working directory, URL dedup/query distinctions, project isolation, refresh/policy
persistence, environment changes, private storage and persistent local removal.
Native dark/full and light/reduced checks covered rounded tool hover/expand, Pierre
code, service marks/source badges, short/overflowing scroll pages, saved square toggles
and the hidden native-notification row. Inspected the dark hover/syntax and controls.
Existing check-bridge passed. Scoped Biome checks passed on 11 source files. No build,
tsc, real server authentication or paid agent turn. Temporary check scripts removed.

# Tool values, runtime capture and virtual output — October 27

Tool activity retains original args, structured results and actual MCP schema/source
metadata across the three ACP providers. Inputs render as named fields; output lists
render readable rows with complete fields on expansion, a raw view and copy actions.
The note-scoped bridge captures actual calls made inside code runners, including
variable-driven loops and caught failures. Only unambiguous active parents group
their children; original script/aggregate output remains behind View code. Older
code-only records have conservative literal fallback; dynamic args cannot be recovered
from those old logs. See docs/tool-display.md.

Output now uses a 260px virtual viewport with 16 mounted top-level rows. The installed
GPUIX virtual-list lost range notifications on a fast jump beyond mounted children;
a measured spacer window driven by ordinary native scroll offsets passed the same
1,000-result jump. Raw/plain output is split into virtual text chunks too. Header
bottom corners remain square until the exit body unmounts, including rapid reopen.

Codex uses the supplied vector; OpenCode's supplied two-tone mark uses a raster asset
to avoid GPUIX's SVG tint-mask behavior. Native notifications no longer show the note
title as an unexplained subtitle; quota/auth text is concise and raw errors persist.

Temporary fixtures passed provider normalization/partial updates, literal fallback,
real loopback MCP runtime traces (status/devices/connect variable args), distinct ids,
caught failure state and note-token isolation. Native dark/full and light/reduced
checks passed formatted inputs/results, source/raw disclosures, a 16-row window over
1,000 results, fast scrolling, exit retention/removal and rapid reopen. Inspected
screenshots of the results, brand marks and closing/closed corners. Notification
delivery was mocked: checked empty subtitle, formatted quota message, preserved raw
error and original-note click routing. Existing ACP reducer, bridge and all-three-agent
checks passed. Scoped Biome checks passed on 22 files with Bun declared as a runtime
global; new rendering/helper modules also passed unused checks. No build, tsc, paid
prompt, live simulator call or real OS notification was run. Temporary fixtures removed.

# Captioned snapshots and tool syntax — October 27

The supplied real snapshot was text prefixed by a device name, so JSON parsing left
the result as plain text. Result decoding now separates that caption from complete
JSON, including old records; new mobile snapshots also return structuredContent.
The supplied result now reports 10 elements and renders ref/label/role rows. Raw
transport output and the screenshot attachment remain preserved. Empty input objects
no longer produce a No fields panel. Literal runner discovery `search({query:...})`
shows the named query with a Find tools title and retains View code.

Pierre syntax colors now cover formatted scalars and compact scalar arrays, with
native highlighting for code/script inputs and shell commands as well as source/raw
views. Multiline object fields use virtual text chunks. A focused check passed against
the actual pasted snapshot, its structured-content variant, caption/attachment/raw
preservation, malformed JSON fallback and conservative search parsing. Native checks
passed in both appearances: actual element rows/count, omitted empty input, search
query/source access and native code nodes for raw/source/input. Inspected dark snapshot
and syntax screenshots. Scoped Biome passed six changed modules. No build or live
simulator/provider call; temporary native fixtures removed.
