# Browser and Capture Implementation Plan

**Goal:** Deliver the local bridge, note browser, and Chrome capture extension described in VELLUM-V2-PLAN.md.

**Architecture:** One authenticated loopback bridge owns capture persistence, scoped MCP access and browser registrations. Native note components consume append-only records. A Vite+ extension uses the selection package's public primitives and delegates privileged capture operations to its service worker.

**Spec:** /Users/APPLE/dev/vellum/VELLUM-V2-PLAN.md

## Global constraints

- Latest user instructions supersede the plan's older package and bundler restrictions: import React Grab and use Vite+.
- Preserve existing local work. Do not modify file-pane-owned files or commit unrelated work.
- Use scratch homes and fake agents for checks. No paid Claude turns or desktop interruption.
- No unnecessary builds or type checking. Use Biome for focused static checks; do not run tsc.
- Keep all Vellum storage behind core/store.ts paths. Never send the pairing token to page code.

## Tasks

- [x] Shared capture schema and extension identity: core/capture.ts, extension/manifest.json.
- [x] Bridge, capture persistence and scoped stdio MCP: core/bridge.ts, core/captures.ts, scripts/vellum-mcp.ts; verify authentication, note isolation and upload limits.
- [x] Capture extension: extension/ with Vite+, selection primitives, annotation, extraction, animations, debugger screenshots, pairing and note delivery.
- [x] Native integration: records/replay, capture cards, pending panel, Browser settings, agent environment and session tools, queue delivery, trash lifecycle.
- [x] Browser wrapper and native stream viewer: bin/browser, core/browser.ts, ui/BrowserBlock.tsx; persist browser records and ship wrapper alongside compiled app.
- [x] Verify focused boundary checks and produce the unpacked extension artifact once; document limitations and installation.

## Review focus

Authentication and Origin rejection; agent note scoping; malformed multipart and filename traversal; busy-note queue delivery; browser disconnect and debugger cleanup.

## Decisions and progress

The supplied plan is the approved design and the user requested execution. Work continues in the current checkout to retain the uncommitted native changes; edits are limited by file ownership. Runtime additions belong to the extension package. Stdio MCP ships without requiring a paid capability probe.

Verification completed with isolated homes and fake agents. The native app was exercised from source; extension/dist is built. Optional browser video recording and the paid live-agent MCP round trip remain outside this delivery. Existing local changes were preserved and no commits were made.
