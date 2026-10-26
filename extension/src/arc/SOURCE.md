# Arc components in Vellum Snapshot

Copied with permission from the local MIT-licensed Arc Library at
`/Users/APPLE/dev/arc-library/registry/components/`:

- button
- textarea
- checkbox
- segmented-control

`motion-tokens.ts` comes from the same library's `registry/motion-tokens.ts`.
The original license is retained in `LICENSE`. The source library is unchanged.

Vellum adaptations: local motion imports; desktop material and density tokens;
0.96 press feedback over 150 ms; static toolbar-button option; a contextual icon cross-fade. The original component class names remain flat.
Styles are shared by the popup and the closed-shadow capture panel. The latter
uses constructed stylesheets and in-memory font sources to remain independent
of the captured page's styles and asset policies.

The connection settings entrance follows Arc popover/dropdown-menu: it starts 5px
toward its trigger at 0.97 scale, fades in over 160ms, and settles on the smooth
spring. Closing takes 130ms and returns to 0.98 scale with half the offset.

The expanding comment controls follow Arc expandable-card's real-height spring.
Content fades in over 240ms after a 120ms delay; closing fades it out over 100ms
and holds the box for 60ms before shrinking. Controls stay mounted so edits and
open folders survive closing. Reduced motion keeps only the short fades.
These adaptations do not use Arc's optional text-blur effects.
