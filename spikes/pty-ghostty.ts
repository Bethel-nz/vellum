// Spike 4: Bun PTY → libghostty-vt → cell grid dump. Also checks the key encoder
// and that terminal replies (device attributes) come back through write_pty.
import { VtTerminal } from '../core/ghostty'

const cols = 100
const rows = 12
const replies: string[] = []
const term = new VtTerminal(cols, rows, (b) => replies.push(JSON.stringify(new TextDecoder().decode(b))))

const proc = Bun.spawn(['ls', '-la', '-G', '/Users/APPLE/dev/vellum'], {
  env: { ...process.env, CLICOLOR_FORCE: '1', TERM: 'xterm-256color' },
  terminal: { cols, rows, data: (_t, data) => term.feed(data) },
})
await proc.exited

term.feed('\x1b[c') // primary device attributes query → reply through write_pty
const grid = term.snapshot()
for (const row of grid.rows) {
  const line = row.map((r) => (r.fg !== undefined || r.bold ? `[${r.fg ?? ''}${r.bold ? ' b' : ''}]${r.text}` : r.text)).join('')
  if (line.trim()) console.log(line.trimEnd())
}
console.log('cursor', grid.cursor, 'alternate', grid.alternate)
console.log('replies', replies)

const show = (k: Parameters<VtTerminal['encodeKey']>[0]) => JSON.stringify(new TextDecoder().decode(term.encodeKey(k)))
console.log('keys', {
  a: show({ key: 'a', keyChar: 'a' }),
  A: show({ key: 'a', keyChar: 'A', modifiers: { shift: true } }),
  ctrlC: show({ key: 'c', modifiers: { ctrl: true } }),
  up: show({ key: 'up' }),
  enter: show({ key: 'enter' }),
  tab: show({ key: 'tab' }),
  esc: show({ key: 'escape' }),
  bs: show({ key: 'backspace' }),
})
term.feed('\x1b[?1h') // DECCKM: application cursor keys, as htop/vim enable
console.log('up in app mode', show({ key: 'up' }))
console.log('plain text:\n' + term.text().split('\n').slice(0, 3).join('\n'))
term.dispose()
