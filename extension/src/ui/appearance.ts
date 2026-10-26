import regular from '../assets/fonts/Geist-Regular.ttf?inline'
import medium from '../assets/fonts/Geist-Medium.ttf?inline'
import semibold from '../assets/fonts/Geist-SemiBold.ttf?inline'
import mono from '../assets/fonts/GeistMono-Regular.ttf?inline'

export type Appearance = 'dark' | 'light'
export function setAppearance(root: HTMLElement, material: Appearance) {
  if (root.dataset.theme === material) return
  root.classList.add('vellum-theme-change')
  root.dataset.theme = material
  void root.offsetWidth
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('vellum-theme-change')))
}

const fontBytes = (url: string) => Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (character) => character.charCodeAt(0)).buffer

export async function loadFonts() {
  const faces = [
    new FontFace('Vellum Geist', fontBytes(regular), { weight: '400' }),
    new FontFace('Vellum Geist', fontBytes(medium), { weight: '500' }),
    new FontFace('Vellum Geist', fontBytes(semibold), { weight: '600' }),
    new FontFace('Vellum Geist Mono', fontBytes(mono), { weight: '400' }),
  ]
  await Promise.allSettled(faces.map(async (face) => { document.fonts.add(await face.load()) }))
}
