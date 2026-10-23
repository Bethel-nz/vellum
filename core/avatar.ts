// Your face beside your paragraphs: the account picture the system already has (core/platform.ts
// says where each OS keeps it), cached as ~/.vellum/me.jpg for a day when it has to be decoded.
// A profile can point at its own image instead, so a second Claude account can look different.
// With no picture, the UI draws a monogram.

import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { accountPicture } from './platform'
import type { Profile } from './profiles'
import { paths } from './store'

export { realName } from './platform'

const DAY = 86_400_000

/** The account picture's path, refreshed at most once a day; undefined when there is none. */
export function machineAvatar(): string | undefined {
  const file = path.join(paths.home, 'me.jpg')
  if (existsSync(file) && Date.now() - statSync(file).mtimeMs < DAY) return file
  const pic = accountPicture()
  if (!pic) return existsSync(file) ? file : undefined
  if ('file' in pic) return pic.file
  mkdirSync(paths.home, { recursive: true })
  writeFileSync(file, pic.bytes)
  return file
}

export type Identity = { src?: string; initial: string; name: string }

export function identityFor(profile: Profile | undefined, fallback: { src?: string; name: string }): Identity {
  const src = profile?.avatarImage && existsSync(profile.avatarImage) ? profile.avatarImage : fallback.src
  const name = fallback.name
  return { src, name, initial: (name.trim()[0] ?? '?').toUpperCase() }
}
