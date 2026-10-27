import { useAgent } from './AgentContext'
import { Icon } from './Icon'
import { useM } from './theme'

/** Same margin and size as the user's author mark; never takes focus. Each agent's own mark; a plain one where there isn't one yet. */
export function AgentMark() {
  const agent = useAgent()
  const m = useM()
  const claude = agent.id === 'claude'
  return <div testId="agent-author" role="img" aria-label={agent.title} style={{ position: 'absolute', left: -26, top: 3, width: 16, height: 16, pointerEvents: 'none' }}><Icon name={agent.id} size={16} color={claude ? '#d97757' : m.textMuted} /></div>
}
