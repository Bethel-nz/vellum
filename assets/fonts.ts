// The fonts Vellum registers, imported as files so a compiled binary carries them (bin.ts).
// Geist for UI and prose, Geist Mono for code; Inter stays registered as the sans fallback.
import geist from './fonts/Geist-Regular.ttf' with { type: 'file' }
import geistMedium from './fonts/Geist-Medium.ttf' with { type: 'file' }
import geistSemiBold from './fonts/Geist-SemiBold.ttf' with { type: 'file' }
import geistItalic from './fonts/Geist-Italic.ttf' with { type: 'file' }
import geistMono from './fonts/GeistMono-Regular.ttf' with { type: 'file' }
import geistMonoMedium from './fonts/GeistMono-Medium.ttf' with { type: 'file' }
import inter from './fonts/Inter-Regular.ttf' with { type: 'file' }
import interMedium from './fonts/Inter-Medium.ttf' with { type: 'file' }
import interSemiBold from './fonts/Inter-SemiBold.ttf' with { type: 'file' }

export const FONTS = [geist, geistMedium, geistSemiBold, geistItalic, geistMono, geistMonoMedium, inter, interMedium, interSemiBold]
