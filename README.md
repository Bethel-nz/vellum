# Vellum

A markdown note you can talk to.

Vellum brings your prompts, agent responses, file changes, terminal output, and
browser captures into one readable document. Pick a project, connect an agent,
and work on the page.

Built with React, TypeScript, [GPUIX](https://gpuix.dev/), and GPUI. Agents connect
through the [Agent Client Protocol](https://agentclientprotocol.com/).

## What you can do

- Work with Claude Code, Codex, or OpenCode using your existing local sign-in.
- Keep separate notes and accounts, with searchable history and project tabs.
- Add files, line ranges, folders, and skills as context.
- Review diffs, answer permission requests, and run commands inside the note.
- Use an embedded terminal and preview project files beside your writing.
- Save reusable prompts as recipes and export notes as Markdown or `.vel` files.
- Send annotated browser captures to a note with the Vellum Snapshot extension.
- Use dark or light appearance and keyboard shortcuts throughout the app.

## Platform support

| Platform | Current status |
| --- | --- |
| Windows x64 | Native app and per-user NSIS installer. Local tests cover startup, agent communication, file handoff, Settings, keyboard shortcuts, and embedded terminals. |
| macOS on Apple Silicon | Native app bundle, with simulator integration through `simdriver` and Xcode. |
| Windows ARM64 / Linux | Not verified or packaged by this repository's current build workflow. |

On Windows, shell commands run through `cmd.exe`, and embedded terminals use
ConPTY. Their sessions end when Vellum exits. The iOS simulator and desktop
notification delivery are currently macOS-only; Windows keeps the in-app
notification inbox.

## Download a build

Published versions are available on [GitHub Releases](https://github.com/Bethel-nz/vellum/releases):

- **Windows x64:** `Vellum_<version>_x64-setup.exe`.
- **macOS Apple Silicon:** `Vellum_<version>_macos-arm64.zip`. Extract the ZIP and
  move `Vellum.app` to Applications. The app is ad hoc signed, without Apple
  notarization.
- **Chrome extension:** `Vellum_Snapshot_<version>_chrome.zip`. Extract it, open
  `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and
  select the extracted folder. Run Vellum on the same computer to connect it.

For the latest development build, open [Desktop builds](https://github.com/Bethel-nz/vellum/actions/workflows/desktop.yml),
choose a successful run for `core`, and download `vellum-windows-x64-installer`
or `vellum-macos-arm64`, or the `vellum-chrome-extension` artifact. GitHub may
require you to sign in to download artifacts.

Extract the archive and run `Vellum_1.0.0_x64-setup.exe`. The installer installs
for your Windows account. Vellum registers itself in **Open with** and
**Default Apps**; you choose any default file associations in Windows Settings.

During first-run setup, choose an agent, sign in if needed, and select a project
folder. Install the agent's own CLI first: the Claude and Codex ACP adapters are
bundled, while OpenCode uses your installed `opencode acp` command. Your agent's
account and provider settings determine model access.

## Run from source

Use **Bun 1.4.4**, the version pinned in CI, and Git. Install your chosen
agent CLI and make it available on `PATH`.

```sh
git clone https://github.com/Bethel-nz/vellum.git
cd vellum
bun install --frozen-lockfile
bun run dev
```

`bun run dev` enables hot reload. Use `bun run start` for a normal source run.
GPUIX supplies a prebuilt native renderer; running from source does not require
building GPUI or installing Rust.

## Keyboard shortcuts

| Action | Windows | macOS |
| --- | --- | --- |
| Send | Ctrl+Enter | Cmd+Enter |
| New note | Ctrl+N | Cmd+N |
| Open project folder | Ctrl+O | Cmd+O |
| Search notes | Ctrl+K | Cmd+K |
| Settings | Ctrl+, | Cmd+, |
| Close tab | Ctrl+Shift+W | Cmd+Shift+W |
| Select tab | Ctrl+1–9 | Cmd+1–9 |
| Next / previous tab | Ctrl+Tab / Ctrl+Shift+Tab | Ctrl+Tab / Ctrl+Shift+Tab |
| Show / hide tabs | Ctrl+Shift+T | Cmd+Shift+T |
| Open file pane | Ctrl+Shift+E | Cmd+Shift+E |
| Stop the agent | Ctrl+. | Cmd+. |
| Leave the embedded terminal | Ctrl+backtick | Cmd+Esc |

Inside a Windows terminal, Ctrl stays with the shell. Use Ctrl+Shift for app
shortcuts there, such as Ctrl+Shift+K to open the Library. The in-app Help note
has more shortcuts and context commands.

## Build an installer or app bundle

Packaging additionally requires Rust/Cargo and `cargo-packager`:

```sh
cargo install cargo-packager --locked --version 0.11.8
bun run package
```

- **Windows x64:** install the Visual Studio C++ build tools and a Windows SDK.
  Packaging produces `dist/Vellum.exe`, `dist/helpers/`, and
  `dist/bundle/Vellum_1.0.0_x64-setup.exe`.
- **macOS on Apple Silicon:** install Xcode and its command-line tools. Packaging
  produces `dist/bundle/Vellum.app` with an ad hoc signature.

Keep `helpers/` beside the standalone executable. It contains the native renderer
and other runtime files. The installer and app bundle arrange those files for you.

## Publish a release

Desktop CI builds Windows x64, macOS ARM64, and the Chrome extension on pushes to
`core`, pull requests, and manual runs. Release builds use the same workflow.

Set the same version in `package.json`, `packager.json`, and
`packager.windows.json`, plus `extension/package.json`. Set the numeric version
in `extension/manifest.json` too (omit any prerelease suffix there). Commit to
`core`, then push a matching version tag:

```sh
git tag v1.0.0
git push origin v1.0.0
```

You can also run the [Release workflow](https://github.com/Bethel-nz/vellum/actions/workflows/release.yml)
manually and enter the version tag. An existing tag builds that tagged commit;
a new tag builds the latest `core` and is created when the release is published.
The tag must match the package version and belong to `core` history.

All builds must pass before the workflow publishes the installer, macOS ZIP,
and Chrome extension ZIP to one GitHub Release. Tags with a prerelease suffix, such as `v1.1.0-beta.1`,
produce prereleases. An already published release is left unchanged on reruns.

To build the extension locally, install its separate dependencies with
`bun install --frozen-lockfile` from `extension/`, then run
`bun run build:extension` and `bun scripts/check-extension-build.ts` from the
repository root. The output is `extension/dist/`, ready to load unpacked.

## Development checks

```sh
bun run typecheck
bun test ./core
```

Create a `screenshots` directory before running UI checks. Windows-specific checks:

```sh
bun scripts/check-windows.ts
bun scripts/check-agent-consoles.ts
bun scripts/check-bridge.ts
bun scripts/check-settings.ts
bun scripts/check-tabs.ts
bun scripts/check-terminals.ts
bun run package
bun scripts/check-app.ts
```

These checks use temporary Vellum homes and fake agents where applicable. Desktop CI
runs these UI checks on Windows. macOS CI runs core tests, typechecking, and bridge
checks, then verifies the bundle contents and code signature before archiving it.

## Local data

Vellum stores settings, profiles, drafts, captures, and notes under `~/.vellum`
(`%USERPROFILE%\.vellum` on Windows). Notes have append-only `.jsonl` records
and readable Markdown transcripts. Set `VELLUM_HOME` to use another data directory.

Default exports go under `~/Downloads/vellum/export/<project>`. You can change
the export folder in Settings.

## Repository guide

| Path | Contents |
| --- | --- |
| `app.tsx` | App state, project navigation, and window composition |
| `core/` | Agent transport, accounts, notes, files, terminals, and tests |
| `ui/` | Product screens, document blocks, and design tokens |
| `components/` | Shared controls and interaction primitives |
| `extension/` | Vellum Snapshot browser extension; build with `bun run build:extension` |
| `scripts/` | Packaging, fixtures, screenshots, and UI checks |

Read [AGENTS.md](AGENTS.md) before changing the UI. See
[KNOWN-BUGS.md](KNOWN-BUGS.md) for tracked issues and the
[Windows support plan](docs/plans/2026-11-07-windows-support.md) for verification
evidence and remaining platform work.
