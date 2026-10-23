// Dump what the bundled libghostty-vt wasm exports, so we know which C API is reachable.
import { VtModule } from '../node_modules/libghostty-vt-node/dist/module.js'
const mod = VtModule.load() as any
const fns = Object.keys(mod.exports).filter((k) => k.startsWith('ghostty_')).sort()
console.log(fns.join('\n'))
console.log('\nTYPES:', Object.keys(mod.manifest.types).sort().join(', '))
