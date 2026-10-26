import path from 'node:path'

const cwd = import.meta.dir
const dist = path.join(cwd, 'dist')
for (const args of [[], ['--config', 'vite.content.config.ts']]) {
  const result = Bun.spawn(['bun', 'x', '--no-install', 'vp', 'build', ...args], { cwd, stdout: 'inherit', stderr: 'inherit' })
  if (await result.exited) process.exit(1)
}
await Bun.write(path.join(dist, 'manifest.json'), Bun.file(path.join(cwd, 'manifest.json')))
for (const icon of new Bun.Glob('**/*').scanSync({ cwd: path.join(cwd, 'icons') })) await Bun.write(path.join(dist, 'icons', icon), Bun.file(path.join(cwd, 'icons', icon)))
const manifest = await Bun.file(path.join(cwd, 'manifest.json')).json()
await Bun.write(path.join(dist, 'INSTALL.txt'), 'Load this directory in chrome://extensions with Developer mode enabled.\nOpen Vellum on this computer. The extension connects automatically.\n')
console.log(`Vellum Snapshot ${manifest.version}: ${dist}`)
