// Your face beside your paragraphs: the account picture the system already has (core/platform.ts
// says where each OS keeps it), cached as ~/.vellum/me.jpg for a day when it has to be decoded.
// A profile can point at its own image instead, so a second Claude account can look different.
// With no picture, the UI draws a monogram.

import path from 'node:path'
import { accountPicture } from './platform'
import type { Profile } from './profiles'
import { paths } from './store'

export { realName } from './platform'

const DAY = 86_400_000

/** The account picture's path, refreshed at most once a day; undefined when there is none. */
export async function machineAvatar(): Promise<string | undefined> {
  const cached = Bun.file(path.join(paths.home, 'me.jpg'))
  // A missing file has size 0; `lastModified` is its mtime.
  if (cached.size > 0 && Date.now() - cached.lastModified < DAY) return cached.name
  const pic = await accountPicture()
  if (!pic) return cached.size > 0 ? cached.name : undefined
  if ('file' in pic) return pic.file
  await Bun.write(cached, pic.bytes)
  return cached.name
}

export type Identity = { src?: string; initial: string; name: string }

export function identityFor(profile: Profile | undefined, fallback: { src?: string; name: string }): Identity {
  const src = profile?.avatarImage && Bun.file(profile.avatarImage).size > 0 ? profile.avatarImage : fallback.src
  const name = fallback.name
  return { src, name, initial: (name.trim()[0] ?? '?').toUpperCase() }
}
