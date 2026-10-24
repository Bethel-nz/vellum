# GPUIX animation contract

`components/motion.ts` is the authoritative token source. Arc supplies the design and staging;
the GPUIX renderer determines which motion can be implemented.

## The renderer (what motion can legally be)

1. Motion is tweens only, on width, height, top, right, bottom, left, opacity and borderRadius.
   Each transition has one cubic-bezier ease, a duration and an optional delay. No springs,
   transforms, scale, translate, rotate, blur, keyframes, gradient/backdrop animation,
   letter-spacing animation or box-shadow animation.
2. Arc's critically damped springs become same-duration tweens using the converted presets:
   snappy .26s, smooth .4s and morph .42s. They never overshoot.
3. Every transition goes through tween(), enter(), leave() or wash(). Reduced motion collapses
   every duration to zero. Use useReducedMotion() for mounted controls and setReducedMotion()
   for the settings override.
4. New components import tokens from components/motion.ts. The older table in ui/theme.ts is
   legacy; a motion migration is not a retheme.
5. Native markdown has no per-glyph spans. Streaming mounts immutable StreamChunk rows;
   an already measured virtual-list row never grows with later deltas.
6. Elevated surfaces close atomically. An opacity exit leaves GPUI's separately composited
   shadow painted. Menus, popovers, approvals and toasts unmount whole. Sheets freeze their
   panel while a shadowless scrim fades for .18s, then unmount together; reduced motion skips
   the hold. Lifted defers an entrance shadow until the body has become opaque.
7. First visible streaming content arrives within 200ms of the first delta. Passive arrivals
   never move focus away from the composer. Looping indicators become static and present
   under reduced motion.
8. **Hit-testing:** an animating (motion) element swallows mouse clicks meant for its parent
   or its neighbourhood; hover still passes through. Never make a motion.div the click proxy
   for a region containing other click targets. Put an invisible, non-animated click target
   over that region instead, as the timeline tick bars do. Assume clicks can be lost adjacent
   to an in-flight entrance or exit.
9. A swallowed click can also miss mouse-down-outside. Popup dismissal must not depend on a
   click consumed by a sibling animation, or wait on closedByOutsidePress forever. Use a plain
   dismissal target in the popup layer, above neighbouring animations.

## Tokens

- Ease: enter [.16,1,.3,1], exit [.7,0,.84,0], standard [.22,1,.36,1],
  inOut [.65,0,.35,1], material [.4,0,.2,1].
- Duration: instant .12, fast .16, exit .18, standard .24, considered .48 seconds.
- Enter stagger: .035 seconds per item, capped at four items.
- Offsets: menu 5px, tooltip 3px, dialog 8px, toast 16px, towards the trigger.
- Hover and press washes use wash(), a 100ms tween.

## The translate-or-leave checklist

1. Animate only the eight supported properties.
2. Replace springs with the converted tween presets; no spring physics.
3. Use token-based tween()/enter()/leave()/wash() transitions.
4. Elevated exits are atomic. Only scrims or other shadowless surfaces may fade with leave().
5. Reduced motion is duration zero with a correct final layout. Loops stay present and static.
6. Stagger only entrances, capped at four items and using the stagger tokens.
7. Inspect every AnimatePresence. Keep it only for shadowless content with a correct instant
   reduced-motion exit. Never retain it around an elevated toast or popup.
8. Never take focus for a passive arrival. Deliberately invoked confirmations may follow the
   user's action; asynchronous completion must not pull focus back from the composer.
9. Every clickable region overlapping animation has a plain sibling/overlay owning the click.
   Sweep TabStrip tabs over their sliding indicator, Segmented thumbs, Switch knobs,
   ApprovalCard buttons, Sheet close buttons and Menu rows. A single-action row may own its
   click, but verify backdrop dismissal while rows are still entering.

## Verification

Use Biome for scoped source checks; do not run tsc or an unnecessary build. In the native
renderer, check full and reduced motion, rapid popup open/close cycles, clicks during entrances,
backdrop dismissal beside moving controls, and composer focus. Keep the current send binding,
Cmd-K/Cmd-N, Ctrl-N/Ctrl-P in pickers, Shift-Tab mode cycling and strip collapse working.
Record the actual checks and renderer findings in NOTES.md.
