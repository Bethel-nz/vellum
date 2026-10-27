// Files imported `with { type: 'file' }`: their path, inside the binary once compiled (bin.ts).
declare module '*.ttf' {
  const path: string
  export default path
}
declare module '*.node' {
  const path: string
  export default path
}
declare module '*.svg' {
  const source: string
  export default source
}
// The Codex ACP adapter ships no types; bin.ts only runs it (`--agent codex`).
declare module '@agentclientprotocol/codex-acp/dist/index.js'

declare module '*.png' {
  const path: string
  export default path
}
