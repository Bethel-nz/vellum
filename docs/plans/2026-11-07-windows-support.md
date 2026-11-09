# Windows support

Goal: Vellum runs, tests green, and ships as an installable app on Windows x64. Work in phases; each ends with its check passing on a real Windows machine (or VM), not by reading code. Follow AGENTS.md throughout (tokens, comments ≤2 lines, verify by execution).

## Already in place

These were written for Windows and need testing, not writing:

- **Key labels:** `keys()` (`core/platform.ts:59`) turns ⌘ into Ctrl, and `primary()` reads the platform's modifier.
- **Platform helpers in `core/platform.ts`:**
  - clipboard: PowerShell `Set-/Get-Clipboard`;
  - shell: `%ComSpec% /d /s /c`;
  - links: junctions instead of symlinks (`:186`);
  - folders: `revealFolder` uses `explorer`;
  - Claude's binary: found through PATHEXT, so `claude.exe` or `claude.cmd`.
- **Elsewhere:**
  - fonts: `core/fonts.ts:17`;
  - the browser helper's name: `agent-browser.exe` (`core/browser.ts:8`);
  - URL opening: `core/mcp.ts:33`.
- **Terminals off on Windows on purpose:** `hasPty = os !== 'windows'` (`core/platform.ts:162`), and the app falls back where it's checked (`app.tsx:1482,1546,1639,2010`).
- **Window chrome:** Windows keeps the system title bar (`app.tsx:2385`).
- **File association** (`core/opener.ts`):
  - registration: `registerWindows`, per-user `reg add`;
  - single instance: `fileArgs` / `handOff`, with the inbox in `~/.vellum/inbox`;
  - status: untested.
- **GPUIX:** publishes `@gpuix/native-win32-x64-msvc` and `-win32-arm64-msvc` at 0.11.0.

## Phase 1 — dev run (`bun app.tsx`)

1. On Windows: run `bun install`, then `bun app.tsx`. Fix whatever stops it from opening a window and sending a turn through OpenCode's free model, run in a scratch `VELLUM_HOME` (see `scripts/fake-acp.ts` for an offline agent).
2. `app.tsx:1448`: `process.env.SHELL || '/bin/zsh'` → use `shellArgv` / `shellCommand` from `core/platform.ts`.
3. `core/platform.ts:138`: `revealFile` uses `open -R` → `explorer /select,"<file>"` on Windows, and `xdg-open` on the folder on Linux.
4. **Mac-only features:** hide them off macOS instead of letting them fail.
   - Mobile simulator: `core/mobile.ts` uses `xcrun simctl`. Gate the phone button and its menus on `isMac`.
   - Open in: `core/openin.ts` finds macOS apps with `open -a` and makes icons with `sips`. Either list Windows targets (VS Code `code`, Cursor, Explorer, Windows Terminal `wt -d`) or show Explorer only.
   - Notifications: `core/native-notify.ts:54` already reports `unavailable`. Confirm Settings says so plainly.
   - Dock: `core/dock.ts` is already a no-op off darwin.

**Done when:** the app opens, a note sends and streams, the file pane opens a file, Settings opens, and nothing logs an error at launch.

## Phase 2 — paths (the likeliest real bugs)

`path.relative` returns backslashes on Windows, but tags, the changes map, git output and links use `/`. Pick one rule: **relative paths inside Vellum always use `/`** (git output already does, `core/gitsnap.ts:80`). Convert at the edges with `.split(path.sep).join('/')`.

1. Audit every `path.relative(` and `split('/')` in `app.tsx`, `ui/`, `core/` (about 9 `split('/')` today):
   - `fileChanges` in `app.tsx`;
   - `readPreview().rel` (`core/preview.ts:67`);
   - `ui/FileTree.tsx`, `core/filetree.ts`;
   - `core/filelinks.ts` (`fileRef` returns `path.relative`);
   - `core/export.ts` (`assetPath` splits on `path.sep`, and asset paths are stored with whichever separator wrote them; normalize to `/` in the file and convert on read);
   - `core/changes.ts`, tag values in `core/tags.ts`.
2. `core/export.ts` `readVel`: a `.vel` made on macOS opened on Windows, and the reverse. `header.home` prefixes differ in separator and drive letter.
3. `core/opener.ts` `fileArgs`: drive-letter paths and quoted `"%1"`.

**Done when:** a `#src\\file.ts`-style tag can't appear (tags always show `/`), the file pane's Show changes button shows up for an edited file, and the round-trip `.vel` test passes on both OSes.

## Phase 3 — `bun test ./core` green on Windows

1. Run `bun test ./core` on Windows. Fix the failures; expect separators, `/tmp` assumptions, POSIX permissions and `realpath` (`/private/var` on macOS versus 8.3 short names on Windows).
2. The `scripts/check-*.ts` fakes write `#!/bin/sh` shims (`scripts/check-login.ts:14`, `check-move.ts:14`, `fake-acp.ts:56`, `check-termd.ts:32`). Give them a `.cmd` twin on Windows, or spawn `bun` directly.
3. Add a GitHub Actions `windows-latest` job: `bun install`, `bunx tsc --noEmit`, `bun test ./core`.

**Done when:** CI is green on windows-latest, with the same count as macOS (no new skips without a reason in the test name).

## Phase 4 — terminals (optional, larger)

Terminals are off on Windows. To turn them on:

1. Check whether Bun's `Bun.spawn({ terminal })` (`core/termd.ts:121`) works on Windows in the pinned Bun. If it doesn't, the PTY needs ConPTY, through `node-pty`'s prebuilt binary or a small helper.
2. `termd` listens on a Unix socket (`core/term.ts:323,352`). On Windows use a named pipe `\\\\.\\pipe\\vellum-termd-<user>`. `existsSync(socketPath())` (`core/term.ts:454`) can't test a pipe, so replace it with a connect attempt.
3. Then set `hasPty` from the capability rather than the OS.

**Done when:** `scripts/check-termd.ts` and `scripts/check-terminals.ts` pass on Windows.

## Phase 5 — build and install

1. `bin.ts:12` imports `@gpuix/native-darwin-arm64` directly. Pick the addon per build target, for example a `define` set by the build or one entry file per target.
2. **`scripts/build-app.ts`** is macOS-only (`sips`, `iconutil`, `codesign`, `.app`, Swift notification helper). Add a Windows branch:
   - compile: `bun build --compile --target=bun-windows-x64` to `dist/Vellum.exe`;
   - icon: `.ico` from `assets/icon.png`;
   - helpers: copy `agent-browser.exe` and `vellum-mcp.ts`. `bin/browser` is a `#!/bin/sh` wrapper, so give it a `.cmd` equivalent or call `Vellum.exe --browser` directly;
   - installer: cargo-packager's `nsis` (or `wix`) format in `packager.json`, as a per-user install;
   - skip the notification helper and `codesign` (sign with a real certificate later).
3. First launch of the built app: `registerFileTypes()` writes the per-user registry entries.

**Done when:** you can double-click a `.vel` to open it in Vellum; Open with → Vellum on a `.txt` adds it to the draft; and opening a second file while Vellum runs goes to the same window, with no second window.

## Out of scope

- The iOS simulator: it's macOS-only by nature.
- Native desktop notifications: GPUIX doesn't provide them on Windows.
- ARM64 builds: x64 first; arm64 is a target flag once x64 ships.
