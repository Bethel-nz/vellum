// The material every component reads its colours from. Components take tokens only.

import { createContext, useContext } from 'react'
import { groknight, type Material } from '../ui/theme'

export const MaterialContext = createContext<Material>(groknight)
export const useM = () => useContext(MaterialContext)
