// Loaded before every test file (bunfig.toml): Vellum's home and the ~/.claude stand-in are
// scratch folders before any module reads them, so no test can write to the real ~/.vellum or
// ~/.claude. (store.ts fixes its paths when it is first imported.)
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = mkdtempSync(path.join(tmpdir(), 'vellum-test-'))
process.env.VELLUM_HOME = path.join(root, 'vellum')
process.env.VELLUM_CLAUDE_HOME = path.join(root, 'claude-home')
