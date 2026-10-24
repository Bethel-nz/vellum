// The material every component reads its colours from. Components take tokens only.

import { createContext, useContext } from 'react'
import { dark, type Material } from '../ui/theme'

export const MaterialContext = createContext<Material>(dark)
export const useM = () => useContext(MaterialContext)
