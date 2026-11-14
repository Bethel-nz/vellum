# Desktop Releases Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task.

**Goal:** Build Windows x64 and macOS ARM64 downloads from `core`, and publish both together on GitHub Releases.

**Architecture:** A reusable desktop workflow builds and validates both hosts. A release workflow validates a version tag against package.json, calls that workflow at an exact commit, and publishes the resulting assets after both jobs succeed.

**Tech Stack:** GitHub Actions, Bun 1.4.4, cargo-packager 0.11.8, GitHub CLI.

**Spec:** Design below.

## Design

- Pushes to `core`, pull requests, and manual builds produce downloadable Actions artifacts.
- `v*` tag pushes publish releases. Manual releases build `core` and create the supplied version tag only after builds succeed.
- Release tags must match package.json and refer to a commit in `core`; existing tags must not be moved.
- Windows retains its existing UI and platform checks. macOS runs core/type checks and verifies bundle contents/signature without assuming CI has an interactive desktop.
- macOS uses an ARM64 runner and a ZIP preserving the `.app` bundle. Windows distributes the NSIS installer.
- Signing remains the existing ad hoc macOS signing; Developer ID signing/notarization is not configured.

## Tasks

- [x] Replace Windows-only CI with a reusable two-platform build; include the native addon in the macOS bundle.
- [x] Add version-gated release publication with read-only build permissions and write permission confined to publishing.
- [x] Update README, lint workflows, run relevant local checks, review, commit, push, and inspect the resulting CI run.

## Review focus

- An Intel macOS runner must fail before packaging the wrong architecture.
- Release tags and package version must match; manual inputs must not be interpolated into shell source.
- Both platform artifacts must exist before publication; macOS executable permissions must survive archiving.
- PR builds must never receive release write permissions.
- Retries must not replace an already published release or move an existing tag.

## Execution record

Ruling: Preserve the rewritten local `core` tip on `backup/core-before-sync-133c513` and recreate `core` from origin — the user requested the latest branch, and there were no local edits.

Validation: actionlint passes; stable/prerelease version guards accept matching versions and reject malformed or mismatched inputs; local typecheck passes; Windows core suite passes 138 tests with one macOS-only skip. Review caught a prerelease classification edge for hyphens inside build metadata; classification now ignores metadata after `+`.

Hosted verification: run 43596124485 passed both desktop jobs and uploaded the Windows installer and macOS ARM64 ZIP.

Follow-up request: prepare v1.0.0 and add a Chrome extension ZIP to the same release. A separate Ubuntu job installs the extension's locked dependencies, builds and validates its Manifest V3 output, and checks the extracted ZIP. Publication requires all three downloads. The extension's fixed key/ID must remain unchanged for pairing.

The first v1 release run passed the Chrome job but exposed an intermittent macOS inbox-watcher failure in `core/opener.test.ts`. The polling fallback now covers every platform, so early file handoffs do not depend solely on filesystem notifications. The failed run was canceled before publication; rerun against the corrected `core` commit.
