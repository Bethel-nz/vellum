// The reply scripts/fake-acp.ts streams for a prompt that says "stream", in ~100 small deltas.
// A module of its own so scripts/check-stream.ts can read it without starting the fake agent.
export const STREAMED = [
  'Here is the plan. I read the helper and its tests first,',
  'then changed one line.',
  '',
  '## What changed',
  '',
  '`concentric()` now clamps at zero, so an inset deeper than its parent gets square corners instead of a negative radius.',
  '',
  '```ts',
  'export function concentric(parentRadius: number, inset: number) {',
  '  return Math.max(0, parentRadius - inset)',
  '}',
  '```',
  '',
  'The tests pass. Next I would look at the sheet radius, which has the same shape of bug.',
].join('\n')
