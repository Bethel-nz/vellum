import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'motion/react'
import { Popup } from './ui/Popup'
import { loadFonts } from './ui/appearance'
import './popup.css'

document.documentElement.classList.add('vellum-ui')
void loadFonts()
createRoot(document.getElementById('app')!).render(createElement(MotionConfig, { reducedMotion: 'user' }, createElement(Popup)))
