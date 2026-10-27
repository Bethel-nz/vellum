// Which agent the note on screen runs (core/agents.ts), for the places that name it or show its
// mark: the margin beside a reply, "Claude is waiting on you", the approval card. App sets it
// from the active note's account.
import { createContext, useContext } from 'react'
import { agents, type Agent } from '../core/agents'

export const AgentContext = createContext<Agent>(agents.claude)
export const useAgent = () => useContext(AgentContext)
