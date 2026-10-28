import type { IconName } from '../icons'

export const pages = ['Vellum', 'Appearance', 'Accounts', 'Connections', 'Browser', 'Activity', 'Trash'] as const
export type SettingsPage = (typeof pages)[number]
export const navigation: readonly (readonly SettingsPage[])[] = [['Vellum', 'Appearance'], ['Accounts', 'Connections', 'Browser'], ['Activity', 'Trash']]
export const pageInfo: Record<SettingsPage, { icon: IconName; intro: string }> = {
  Vellum: { icon: 'settings', intro: 'Make the workspace work the way you do.' },
  Appearance: { icon: 'sun', intro: 'The look and feel of your workspace.' },
  Accounts: { icon: 'user', intro: 'Your agents and their connected accounts.' },
  Connections: { icon: 'mcp', intro: 'MCP servers for your notes.' },
  Browser: { icon: 'link', intro: 'Connect Vellum Snapshot to your workspace.' },
  Activity: { icon: 'history', intro: 'A little perspective on time spent in your projects.' },
  Trash: { icon: 'trash', intro: 'Restore deleted notes or remove them for good.' },
}

export const groups = [
  { id: 'onboarding', page: 'Vellum', words: 'Welcome onboarding setup getting started first note tour' },
  { id: 'thinking', page: 'Vellum', words: 'Model thinking reasoning thoughts simple view tool results' },
  { id: 'new-notes', page: 'Vellum', words: 'New notes defaults mode ask edits plan auto effort low high max account at launch last note startup' },
  { id: 'instructions', page: 'Vellum', words: 'Instructions agent custom prompt project conventions' },
  { id: 'notifications', page: 'Vellum', words: 'Notifications native macOS desktop alerts notify never requests approvals questions replies background permission enable' },
  { id: 'theme', page: 'Appearance', words: 'Theme dark light colors' },
  { id: 'interface', page: 'Appearance', words: 'Interface tab strip pinned auto hidden motion animations system reduced full' },
  { id: 'accounts', page: 'Accounts', words: 'Accounts agents providers Claude Codex OpenCode login sign in log out refresh add account' },
  { id: 'browser', page: 'Browser', words: 'Browser capture extension Vellum Snapshot connection port automatic bridge restart' },
  { id: 'mcp', page: 'Connections', words: 'MCP servers tools integrations connections local stdio HTTP SSE remote OAuth authorization sign in add server token permissions read write' },
  { id: 'activity', page: 'Activity', words: 'Activity track project time today week all active agent local privacy idle' },
  { id: 'trash', page: 'Trash', words: 'Trash deleted notes restore empty remove permanently storage days' },
] as const satisfies readonly { id: string; page: SettingsPage; words: string }[]
export type SettingsGroup = (typeof groups)[number]
export const slug = (page: SettingsPage) => page.toLowerCase()
export function matches(group: SettingsGroup, query: string, accountNames = '') {
  const text = `${group.page} ${pageInfo[group.page].intro} ${group.words} ${group.id === 'accounts' ? accountNames : ''}`.toLowerCase()
  return query.trim().toLowerCase().split(/\s+/).every((word) => text.includes(word))
}
