// Permission asks from the official CLI's control channel. With `--permission-prompts host
// --permission-prompt-tool stdio`, `claude -p` writes a `control_request` with subtype
// `can_use_tool` when a tool needs your OK, and waits for a `control_response` on stdin
// (spikes/permission-host.ts). An ask lives only as long as its process; the answer is recorded.

import path from 'node:path'
import { relPath } from './threads'

/** Claude Code's permission modes, as `--permission-mode` lists them. */
export type PermissionMode = 'manual' | 'acceptEdits' | 'plan' | 'auto' | 'dontAsk' | 'bypassPermissions'
export type Think = 'off' | 'on' | 'max'

export const modes: { id: PermissionMode; label: string; hint: string }[] = [
  { id: 'manual', label: 'Ask', hint: 'Every edit and command asks first' },
  { id: 'acceptEdits', label: 'Edits', hint: 'Edits go through; commands ask' },
  { id: 'plan', label: 'Plan', hint: 'Read and plan, change nothing' },
  { id: 'auto', label: 'Auto', hint: 'Claude decides what needs asking' },
  { id: 'dontAsk', label: "Don't ask", hint: 'Anything that would ask is refused' },
  { id: 'bypassPermissions', label: 'Full access', hint: 'Nothing asks. Use in folders you can lose' },
]
/** ⇧⇥ cycles these; the other modes are a deliberate pick from the menu. */
export const cycleModes: PermissionMode[] = ['manual', 'acceptEdits', 'plan', 'auto']
export const defaultMode: PermissionMode = 'acceptEdits'
export const modeLabel = (id: PermissionMode | undefined) => modes.find((m) => m.id === (id ?? defaultMode))?.label ?? String(id)

export type Ask = {
  requestId: string
  threadId: string
  tool: string
  /** Verb and scope: `Run in vellum/`, `Edit ui/theme.ts`, `Fetch docs.anthropic.com`. */
  title: string
  /** The command, path or URL, in mono. */
  detail: string
  input: Record<string, unknown>
  /** Rules the CLI offers for "always allow"; absent when it offers none. */
  suggestions?: unknown[]
  /** A short label for the always-allow rule, e.g. `bun test`. */
  alwaysLabel?: string
  at: string
}

export type Decision = 'allowed' | 'always' | 'denied'

function host(url: unknown) {
  try {
    return new URL(String(url)).host
  } catch {
    return String(url ?? '')
  }
}

/** What an ask shows, from the tool and its input. */
export function describe(tool: string, input: any, workspace: string, displayName?: string): { title: string; detail: string } {
  const folder = `${path.basename(workspace)}/`
  switch (tool) {
    case 'Bash':
      return { title: `Run in ${folder}`, detail: String(input?.command ?? '') }
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit': {
      const file = relPath(workspace, String(input?.file_path ?? input?.notebook_path ?? ''))
      return { title: `${tool === 'Write' ? 'Write' : 'Edit'} ${file}`, detail: file }
    }
    case 'WebFetch':
      return { title: `Fetch ${host(input?.url)}`, detail: String(input?.url ?? '') }
    case 'WebSearch':
      return { title: 'Search the web', detail: String(input?.query ?? '') }
    default: {
      const detail = JSON.stringify(input ?? {})
      return { title: displayName || tool, detail: detail.length > 160 ? detail.slice(0, 157) + '…' : detail }
    }
  }
}

/** The rule text an always-allow would add, for the button label. */
export function alwaysLabel(suggestions: any[] | undefined): string | undefined {
  for (const s of suggestions ?? []) {
    for (const r of s?.rules ?? []) {
      if (r?.ruleContent) return String(r.ruleContent).replace(/:\*$/, '')
      if (r?.toolName) return String(r.toolName)
    }
    if (s?.type === 'setMode' && s?.mode) return `${modeLabel(s.mode)} mode`
  }
}
