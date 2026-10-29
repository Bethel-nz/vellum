// Above the composer of a note whose folder ships config that runs its own code (hooks, MCP
// servers, plugins) when the agent starts there. Nothing is sent from the folder until you trust it.
import { Button, Label } from './Button'
import { Icon } from './Icon'
import { useM } from './theme'
import { radiusXl, type } from '../ui/theme'

export function TrustNotice({ files, agent, onTrust }: { files: string[]; agent: string; onTrust: () => void }) {
  const m = useM()
  return <div testId="trust-warning" role="alert" style={{ display: 'flex', flexDirection: 'row', alignItems: 'start', maxWidth: '100%', minWidth: 0, gap: 10, padding: 10, borderRadius: radiusXl - 2, backgroundColor: m.chipBg }}>
    <div style={{ width: 16, height: 19, paddingTop: 2, flexShrink: 0 }}><Icon name="shield" size={16} color={m.warning} /></div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
      <text style={{ ...type.label, fontWeight: 500, color: m.textUi }}>{`Trust this folder before ${agent} starts here`}</text>
      <text testId="trust-warning-files" style={{ fontSize: 13, lineHeight: 19, color: m.textMuted }}>{`It has ${files.join(', ')}. Its hooks, MCP servers or plugins run without asking once ${agent} starts. Send only if you trust where this folder came from.`}</text>
    </div>
    <Button testId="trust-folder" title="Trust this folder and send" onPress={onTrust} style={{ flexShrink: 0 }}><Label>Trust folder</Label></Button>
  </div>
}
