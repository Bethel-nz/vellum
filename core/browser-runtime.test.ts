import { expect, test } from 'bun:test'
import { browserArguments, browserTitle } from './browser-runtime'

test('preserves values verbatim but reserves Vellum ownership options', () => {
  expect(browserArguments(['fill', '@e1', 'two words "quoted"'])).toEqual(['fill', '@e1', 'two words "quoted"'])
  for (const flag of ['--session=other', '--namespace', '--config', '--cdp', '--profile', '--auto-connect', '--pin-tab', '-p']) {
    expect(() => browserArguments(['open', 'https://example.com', flag])).toThrow('Vellum')
  }
  for (const args of [[], ['connect', '9222'], ['session', 'stop'], ['stream', 'disable'], ['install'], ['plugin', 'install']]) expect(() => browserArguments(args)).toThrow()
})
test('browser journal summaries never include entered values or URL credentials', () => {
  expect(browserTitle(['fill', '@e1', 'super-secret'])).toBe('Fill')
  expect(browserTitle(['open', 'https://user:password@example.com/path?token=secret'])).toBe('Open · example.com')
})

test('serializes note actions, waits for cancellation settlement, holds control and rolls generations', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const path = await import('node:path')
  const home = mkdtempSync(path.join(tmpdir(), 'vellum-browser-runtime-'))
  try {
    const source = `
      import { expect } from 'bun:test';
      import { browserCommand, getBrowserSession, requestBrowserControl, releaseBrowserControl, stopBrowserSession } from './core/browser-runtime';
      const signal = new AbortController();
      const a = browserCommand('fixture', {args:['wait','180']}, {signal:signal.signal});
      const b = browserCommand('fixture', {args:['fill','@e1','two words "quoted"']}, {signal:new AbortController().signal});
      const [first, second] = await Promise.all([a,b]);
      expect(first.exitCode).toBe(0); expect(second.exitCode).toBe(0);
      const generation = first.key.generation;
      const pending = browserCommand('fixture', {args:['wait','180']}, {signal:signal.signal});
      await Bun.sleep(70); signal.abort();
      let held = false; const lease = requestBrowserControl('fixture').then(() => {held = true});
      await Bun.sleep(30); expect(held).toBe(false);
      expect((await pending).exitCode).toBe(130); await lease; expect(held).toBe(true);
      await expect(browserCommand('fixture', {args:['snapshot']}, {signal:new AbortController().signal})).rejects.toThrow('control');
      await releaseBrowserControl('fixture'); await stopBrowserSession('fixture');
      expect(getBrowserSession('fixture').phase).toBe('closed');
      const next = await browserCommand('fixture', {args:['snapshot']}, {signal:new AbortController().signal});
      expect(next.key.generation).not.toBe(generation); await stopBrowserSession('fixture');
      const events = (await Bun.file(process.env.VELLUM_BROWSER_FIXTURE_LOG).text()).trim().split('\\n').map(JSON.parse);
      const actions = events.filter(e=>['wait','fill'].includes(e.args[0]));
      expect(actions.map(e=>e.event)).toEqual(['start','end','start','end','start','end']);
      expect(actions[2].args).toEqual(['fill','@e1','two words "quoted"']);
    `
    const process = Bun.spawn([globalThis.process.execPath, '-e', source], { cwd: path.resolve(import.meta.dir, '..'), env: { ...globalThis.process.env, VELLUM_HOME: home, VELLUM_BROWSER_EXECUTABLE: path.resolve(import.meta.dir, '../scripts/fake-browser.ts'), VELLUM_BROWSER_FIXTURE_LOG: path.join(home, 'cli.log') }, stdout: 'pipe', stderr: 'pipe' })
    const [exit, stderr] = await Promise.all([process.exited, new Response(process.stderr).text()])
    expect(exit, stderr).toBe(0)
  } finally { rmSync(home, { recursive: true, force: true }) }
}, 15_000)
