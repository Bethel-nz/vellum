# Windows support

Goal: Vellum runs, tests green, and ships as an installable app on Windows x64. Work in phases; each ends with its check passing on a real Windows machine (or VM), not by reading code. Follow AGENTS.md throughout (tokens, comments ≤2 lines, verify by execution).

## Platform boundaries and evidence

- **Commands:** Vellum's `!` runner and interactive terminal use `%ComSpec%` (`cmd.exe`) with Bun's ConPTY. Windows CMD commands work; POSIX shell syntax and POSIX-only utilities are not emulated. See [Bun's terminal documentation](https://bun.com/docs/runtime/child-process#platform-differences) and [Microsoft's `cmd` reference](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/cmd).
- **Mobile simulator:** hidden unless macOS on Apple Silicon (`core/mobile.ts`); its implementation invokes `xcrun simctl`, and the packaged Windows build omits `simdriver`.
- **Open in:** Windows shows Explorer only. Windows app discovery and `sips` icon conversion remain macOS-only (`core/openin.ts`).
- **Desktop notifications:** unavailable outside macOS; the in-app inbox remains available and Settings now says desktop alerts are unavailable.
- **Terminal persistence:** Windows inline terminals use ConPTY; the holder remains disabled because it requires Unix-domain sockets. The Windows terminal self-check verifies input/output and that app-owned sessions end on quit. Bun documents ConPTY differences in raw mode, `\r` input, output sequences, resize signaling, and mouse tracking ([terminal platform differences](https://bun.com/docs/runtime/child-process#platform-differences)); test these on Windows before claiming full terminal parity. Named-pipe persistence is separate optional work.
- **Native UI / packaging:** GPUIX publishes Windows x64 and ARM64 packages ([GPUIX changelog](https://gpuix.dev/changelog)); this project targets x64 first. Cargo Packager documents `.exe` suffix handling, resources beside the app, and current-user NSIS mode ([configuration](https://docs.crabnebula.dev/packager/configuration/)).
- **File associations:** Vellum registers its ProgID, Open With entry, and Default Apps capabilities, but leaves the default choice to the user. Windows requires default-app changes through system UI ([Microsoft default apps platform](https://learn.microsoft.com/en-us/windows/apps/develop/windows-integration/default-apps-platform)); Open With uses `OpenWithProgids` ([Microsoft Open With guidance](https://learn.microsoft.com/en-us/windows/win32/shell/how-to-include-an-application-on-the-open-with-dialog-box)).
- **Named pipes, if persistence is implemented:** Microsoft documents local and remote pipe access and the need to restrict access with an ACL ([named pipes](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipes), [pipe security](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights)).

## Verification status

| Phase | Implementation status | Required evidence still pending |
| --- | --- | --- |
| 1. Dev run and platform-only features | Local Windows platform, Settings, and compiled-app checks pass, including an offline agent turn and file preview. | Manually verify a live provider turn and normal desktop use. |
| 2. Paths and `.vel` portability | Slash-normalized paths and cross-host import mapping are implemented. | Run export/import round trips on Windows and between Windows and macOS. |
| 3. Core tests | Local Windows run: 138 pass, 1 macOS-only skip. Typecheck, bridge, and platform checks pass. CI also runs typecheck and tab/keyboard checks. | Run GitHub Actions on this branch. |
| 4. Inline terminals | Local source and compiled ConPTY checks pass, including input/output, restart lifecycle, and terminal escape shortcuts. Unix-socket holder checks explicitly skip Windows. | Run CI; separately verify resize, input/output edge cases, and mouse behavior on supported Windows versions. Persistent sessions are not implemented. |
| 5. Packaging and associations | NSIS build and silent install passed. The same smoke check passed for both `dist/Vellum.exe` and the installed copy: per-user registry entries, text-file handoff, offline agent turn, and ConPTY. The Ghostty Wasm build plugin now matches Windows paths. | Verify a user-selected `.vel` default association through Windows Settings, then run CI. |

Local Windows x64 verification (2026-11-14, Bun 1.4.4): `bun test ./core` passed 138 tests with 1 macOS-only skip; `bun run typecheck`, `git diff --check`, and the Windows, bridge, Settings, tabs, terminal, and compiled-app checks passed. `bun run package` produced `dist/bundle/Vellum_0.1.0_x64-setup.exe`; a silent installation into `dist/installed-smoke` exited 0, and `VELLUM_APP_BINARY=.../dist/installed-smoke/Vellum.exe bun scripts/check-app.ts` passed against that copy too. One core run timed out in the existing 5-second submodule test while toolchain installation was busy; a complete rerun passed. GitHub Actions and manual default-association selection remain pending.

Local prerequisites: Bun 1.4.4, Rust/Cargo 1.100.0, MSVC x64 tools, Windows SDK 10.0.26100.0, and cargo-packager 0.11.8. The SDK's initial broad install failed on an optional Application Verifier shortcut; the subsequent x64 C++ SDK installation exited 0, and a Rust executable compiled and ran from a normal shell. Saved user `CARGO_HOME` and `CARGO_INSTALL_ROOT` point to `C:\Users\DELL\.cargo`; `CARGO_TARGET_DIR` points to `C:\Users\DELL\AppData\Local\Rust\target`. Restart pre-existing terminals to replace inherited `D:` settings.

The local run found and fixed three portability defects: the native build's Ghostty Wasm plugin only matched POSIX paths, picked file names containing spaces did not become context tokens, and the screenshot helper used absolute developer-machine paths. Windows shortcut labels now spell Tab correctly; tab checks use the host's primary modifier and cover new/close note, numbered tabs, and Ctrl+PageUp/PageDown. Terminal checks cover Ctrl+Shift+K and Ctrl+backtick. The compiled smoke check opens its text fixture inside the active workspace, so it verifies draft context without accidentally switching projects.

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
- **Terminal support:** Bun 1.4.4 provides ConPTY through `Bun.spawn({ terminal })`, so inline terminals can run on Windows. The persistent terminal holder still uses a Unix-domain socket and stays off there; sessions fall back to the app-owned PTY and end when Vellum exits.
- **Window chrome:** Windows keeps the system title bar (`app.tsx:2385`).
- **File association** (`core/opener.ts`):
  - registration: `registerWindows`, per-user ProgID, Open with, and Default Apps capabilities;
  - single instance: `fileArgs` / `handOff`, with the inbox in `~/.vellum/inbox`;
  - status: untested.
- **GPUIX:** publishes `@gpuix/native-win32-x64-msvc` and `-win32-arm64-msvc` at 0.11.0.

## Phase 1 — dev run (`bun app.tsx`)

1. On Windows: run `bun install`, then `bun app.tsx`. Fix whatever stops it from opening a window and sending a turn through OpenCode's free model, run in a scratch `VELLUM_HOME` (see `scripts/fake-acp.ts` for an offline agent).
2. `app.tsx`: interactive shell creation uses `interactiveShell()`; one-shot `!` commands use the platform-specific `shellArgv()`.
3. `core/platform.ts:138`: `revealFile` uses `open -R` → `explorer /select,"<file>"` on Windows, and `xdg-open` on the folder on Linux.
4. **Mac-only features:** hide them off macOS instead of letting them fail.
   - Mobile simulator: `core/mobile.ts` uses `xcrun simctl`; `mobileSupported` gates the view and tools to macOS on Apple Silicon.
   - Open in: `core/openin.ts` finds macOS apps with `open -a` and makes icons with `sips`; Windows lists Explorer only.
   - Notifications: `core/native-notify.ts` reports `unavailable`; Settings now explains desktop alerts are unavailable while the in-app inbox remains available.
   - Dock: `core/dock.ts` is already a no-op off darwin.

**Done when:** the app opens, a note sends and streams, the file pane opens a file, Settings opens, and nothing logs an error at launch.

## Phase 2 — paths (the likeliest real bugs)

`path.relative` returns backslashes on Windows, but tags, the changes map, git output and links use `/`. Pick one rule: **relative paths inside Vellum always use `/`** (git output already does, `core/gitsnap.ts:80`). Convert at the edges with `.split(path.sep).join('/')`.

1. Audit every `path.relative(` and `split('/')` in `app.tsx`, `ui/`, `core/` (about 9 `split('/')` today):
   - `fileChanges` in `app.tsx`;
   - `readPreview().rel` (`core/preview.ts:67`);
   - `ui/FileTree.tsx`, `core/filetree.ts`;
   - `core/filelinks.ts` (`fileRef` returns `path.relative`);
   - `core/agents.ts` (folder-config paths shown in the trust warning);
   - `core/export.ts` (asset paths use `/` in exports and convert to the local separator on import);
   - `core/changes.ts`, tag values in `core/tags.ts`.
2. `core/export.ts` `readVel`: a `.vel` made on macOS opened on Windows, and the reverse. `header.home` and workspace paths differ in separators, roots, and drive letters; imported absolute tool paths must move with the note.
3. `core/opener.ts` `fileArgs`: drive-letter paths and quoted `"%1"`.

**Done when:** a `#src\\file.ts`-style tag can't appear (tags always show `/`), the file pane's Show changes button shows up for an edited file, and the round-trip `.vel` test passes on both OSes.

## Phase 3 — `bun test ./core` green on Windows

1. Run `bun test ./core` on Windows. Fix the failures; expect separators, `/tmp` assumptions, POSIX permissions and `realpath` (`/private/var` on macOS versus 8.3 short names on Windows).
2. The `scripts/check-*.ts` fakes write `#!/bin/sh` shims (`scripts/check-login.ts:14`, `check-move.ts:14`, `fake-acp.ts:56`, `check-termd.ts:32`). Give them a `.cmd` twin on Windows, or spawn `bun` directly.
3. Add a GitHub Actions `windows-latest` job: frozen Bun install, core tests, platform-boundary check, bridge and Settings checks, terminal UI self-check, package build, and compiled-app smoke check.

**Done when:** CI is green on windows-latest, with the same core-test count as macOS (no new skips without a reason in the test name); the terminal self-check exercises ConPTY rather than skipping Windows.

## Phase 4 — terminal persistence (optional, larger)

Windows inline terminals use Bun's ConPTY implementation. The Unix-socket holder remains disabled there; sessions end with Vellum. To persist sessions across restarts:

1. Replace the Unix-domain socket in `core/term.ts` and `core/termd.ts` with a per-user named pipe. Microsoft documents `\\\\.\\pipe\\<name>` and connect-based client access; `existsSync` is not a pipe availability check.
2. Restrict the pipe to the current user and avoid remote clients; Windows named pipes can be reachable over the network unless access is restricted.
3. Run the terminal and holder checks on Windows. ConPTY has different input/output behavior and Windows 10's inbox host drops mouse tracking, so verify keyboard input, resize, exit, and mouse interactions on supported Windows versions.

**Done when:** `scripts/check-termd.ts` and `scripts/check-terminals.ts` pass on Windows and held sessions survive quitting Vellum.

## Phase 5 — build and install

The Windows build branch is configured to emit `dist/Vellum.exe`, place its GPUIX addon, browser helper, and MCP helper beside it, and use cargo-packager to create a current-user NSIS installer. The build, installer, and registered file-type launch path below remain to be verified on Windows.

1. Verify the packaged addon loads from the helper directory in a compiled Windows executable; the source run must continue using `@gpuix/native`'s platform selection.
2. **`scripts/build-app.ts`** has a Windows branch that compiles `Vellum.exe`, copies Windows helpers and creates a per-user NSIS installer from `packager.windows.json`. The native title bar remains; macOS icon conversion, notification helper, opener app, simulator helper and codesign are skipped. Add a Windows `.ico` and real code signing when ready for distribution.
3. First launch of the built app: `registerFileTypes()` writes the per-user registry entries.

**Done when:** Windows lists Vellum in Open with and Default Apps; after the user chooses Vellum, double-clicking a `.vel` opens the note; Open with → Vellum on a `.txt` adds it to the draft; and opening another file while Vellum runs reaches the existing window without a second app window. Windows requires default-app choices through system UI, so registration must never force the user's choice.

## Out of scope

- The iOS simulator: it's macOS-only by nature.
- Native desktop notifications: GPUIX doesn't provide them on Windows.
- ARM64 builds: x64 first; arm64 is a target flag once x64 ships.
