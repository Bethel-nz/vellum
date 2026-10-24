import { expect, test } from 'bun:test'
import { printedFile } from './printed'

test('a command that only prints one file names it', () => {
  expect(printedFile('cat ui/theme.ts')).toBe('ui/theme.ts')
  expect(printedFile('cat -n app.tsx')).toBe('app.tsx')
  expect(printedFile('head -n 40 core/agent.ts')).toBe('core/agent.ts')
  expect(printedFile('tail -20 NOTES.md')).toBe('NOTES.md')
  expect(printedFile("sed -n '10,80p' core/threads.ts")).toBe('core/threads.ts')
  expect(printedFile('cd /Users/me/dev/vellum && cat "ui/Settings.tsx"')).toBe('ui/Settings.tsx')
  expect(printedFile('/bin/cat package.json')).toBe('package.json')
  expect(printedFile('bat -pp --line-range 1:40 src/main.rs')).toBe('src/main.rs')
})

test('anything that changes the output, or prints more than one file, names none', () => {
  expect(printedFile('cat app.tsx | grep foo')).toBeUndefined()
  expect(printedFile('cat a.ts b.ts')).toBeUndefined()
  expect(printedFile('cat *.ts')).toBeUndefined()
  expect(printedFile('cat $FILE')).toBeUndefined()
  expect(printedFile('cat app.tsx > copy.tsx')).toBeUndefined()
  expect(printedFile('npm test && cat log.txt')).toBeUndefined()
  expect(printedFile("sed -i 's/a/b/' app.tsx")).toBeUndefined()
  expect(printedFile("sed 's/a/b/' app.tsx")).toBeUndefined()
  expect(printedFile('cat')).toBeUndefined()
  expect(printedFile('ls -la')).toBeUndefined()
  expect(printedFile('echo "cat app.tsx"')).toBeUndefined()
})
