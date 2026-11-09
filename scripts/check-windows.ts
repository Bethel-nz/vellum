// Self-check the Windows-specific command, simulator, Open in and terminal boundaries.
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const home = path.join(tmpdir(), `vellum-windows-check-${Bun.randomUUIDv7()}`)
process.env.VELLUM_HOME = home
const { hasPty, hasTermd, interactiveShell, os, revealLabel, shellArgv } = await import('../core/platform')
const { mobileSupported } = await import('../core/mobile')
const { openTargets } = await import('../core/openin')

if (os !== 'windows') {
  console.log('skip: Windows platform check')
  rmSync(home, { recursive: true, force: true })
  process.exit(0)
}

let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}

const command = shellArgv('echo VELLUM_WINDOWS_CMD')
const result = Bun.spawnSync(command, { stdout: 'pipe', stderr: 'pipe' })
expect('one-shot commands use cmd.exe', command[0] === (process.env.ComSpec ?? 'cmd.exe') && command[1] === '/d' && command[2] === '/s' && command[3] === '/c')
expect('cmd.exe runs a user command', result.exitCode === 0 && result.stdout.toString().includes('VELLUM_WINDOWS_CMD'))
const interactive = interactiveShell()
expect('interactive terminals start cmd.exe', interactive.shell === (process.env.ComSpec ?? 'cmd.exe') && interactive.argv.length === 1)
expect('Open in exposes Explorer only', revealLabel === 'Show folder in Explorer' && openTargets().map((target) => target.id).join(',') === 'files')
expect('the iOS simulator is unavailable', !mobileSupported)
expect('inline terminals use ConPTY', hasPty)
expect('persistent terminal sessions are disabled', !hasTermd)

console.log(failed ? `${failed} failed` : 'all passed')
rmSync(home, { recursive: true, force: true })
process.exit(failed ? 1 : 0)
