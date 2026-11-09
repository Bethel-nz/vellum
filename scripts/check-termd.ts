// Self-check for the terminal holder, no UI: a held shell outlives the Vellum that started it,
// the next one gets it back with its output and can type into it, and once nothing is held and
// nobody is connected the holder leaves by itself.
//   bun scripts/check-termd.ts
import { tmpdir } from 'node:os'
import path from 'node:path'
import { present, scratchDir } from './scratch'

if (process.platform === 'win32') {
  console.log('skip: Windows inline terminals use ConPTY; the persistent holder still requires Unix sockets')
  process.exit(0)
}

let failed = 0
const expect = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`)
}
const until = async (ok: () => boolean, ms = 5000) => {
  const start = Date.now()
  while (!ok() && Date.now() - start < ms) await Bun.sleep(50)
  return ok()
}
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// Each "Vellum" is a child process running one step against the same scratch home.
const step = process.argv[2]
if (step === 'start') {
  const { holdTerm } = await import('../core/term')
  const s = await holdTerm({ argv: ['/bin/sh'], cwd: tmpdir(), env: { PATH: process.env.PATH, PS1: '$ ' }, cols: 80, rows: 24 }, { kind: 'shell', title: 'sh' })
  s.write('echo first-$((40+2))\n')
  expect('a Vellum starts a held shell', await until(() => s.text().includes('first-42')))
  process.exit(failed)
}
if (step === 'return') {
  const { heldTerms } = await import('../core/term')
  const held = await heldTerms()
  expect('the next Vellum gets the shell back', held.length === 1, String(held.length))
  const s = held[0]?.session
  if (!s) process.exit(1)
  expect('with what it said', s.text().includes('first-42'))
  expect('and what it was', (held[0]!.meta as any)?.title === 'sh')
  s.write('echo again-$((40+3))\n')
  expect('typing into it works', await until(() => s.text().includes('again-43')))
  s.resize(100, 30)
  s.write('stty size\n')
  expect('it follows a resize', await until(() => s.text().includes('30 100')))
  const mask = '0' + process.umask().toString(8).padStart(3, '0')
  s.write('umask\n')
  expect('the shell has your usual umask, not the socket’s', await until(() => s.text().includes(`\n${mask}`)), mask)
  if (process.argv[3] === 'exit') {
    s.write('exit\n')
    expect('exiting the shell ends it', (await Promise.race([s.exited, Bun.sleep(5000).then(() => 'timeout')])) === 0)
    expect('nothing is left to get back', (await heldTerms()).length === 0)
  }
  process.exit(failed)
}

const home = await scratchDir('vellum-termd-')
const sock = path.join(home, 'run', 'termd.sock')
const run = async (...args: string[]) => {
  const p = Bun.spawn(['bun', import.meta.path, ...args], { env: { ...process.env, VELLUM_HOME: home }, stdout: 'inherit', stderr: 'inherit' })
  return (await p.exited) === 0
}
let pid: number | undefined
try {
  expect('…and quits', await run('start'))
  pid = await present(sock + '.pid') ? Number(await Bun.file(sock + '.pid').text()) : undefined
  expect('the holder is still running', pid !== undefined && alive(pid))
  const mode = async (p: string) => ((await Bun.file(p).stat()).mode & 0o777).toString(8)
  expect('only you can reach its socket', (await mode(path.dirname(sock))) === '700' && (await mode(sock)) === '600', `${(await mode(path.dirname(sock)))} ${(await mode(sock))}`)
  expect('a quit and another return keep it', (await run('return')) && (await run('return', 'exit')))
  expect('with nothing held and nobody connected, the holder leaves', await until(() => !alive(pid!), 15_000))
  expect('…and takes its socket with it', !await present(sock))
} finally {
  if (pid && alive(pid)) process.kill(pid)
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
