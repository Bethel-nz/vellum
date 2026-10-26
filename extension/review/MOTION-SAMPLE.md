# Motion capture sample

Recorded from a local React demo using motion/react, version 13.4.0.
The extension's recording UI, observeAnimations, sample, extract, and uploadCapture
serializer produced the data. A local sample receiver replaced the desktop bridge.
This verifies extraction and serialization, not production delivery. The two PNGs were
captured with the browser screenshot API and passed to the serializer; the extension's
debugger screenshot path was not exercised here.

- motion-sample.request.json: readable multipart fields, complete capture JSON, and image metadata.
- motion-sample.capture.json: the exact JSON value of the capture form field.
- motion-sample.multipart: raw multipart body with both image parts, without authentication headers.
- motion-sample.summary.json: a derived summary, not the wire schema.
- motion-element.png and motion-context.png: the actual images supplied.

## Known demo source

```tsx
<motion.button
  id="motion-pill"
  initial={false}
  animate={{ x: moved ? 180 : 0, rotate: moved ? 7 : 0, scale: moved ? 1.1 : 1, opacity: moved ? .75 : 1 }}
  transition={{ type: 'spring', stiffness: 100, damping: 11, mass: 1 }}
  onClick={() => setMoved(!moved)}
>
  Play Motion spring
</motion.button>
```

The annotation was entered before arming Record next interaction, then the button was
clicked. The result contains two opacity keyframes with the browser's computed spring
easing curve, and 122 movement samples over two seconds. Translation overshoots its
180px target to 202.737px. Rotation and scale appear in the sampled transform matrix.

## Demonstrated limits

The React component/source field was unavailable. The original Motion props, stiffness,
damping and mass are not recovered; the source above documents the known demo setup.
The capture preserves the runtime easing curve and measured movement. The JavaScript
sampler records the selected element's bounds, transform and opacity; it does not
capture every animated property or independently sample every descendant. Record while
the interaction runs. This verifies this specimen, not every possible Motion, canvas,
WebGL, scroll-driven or custom-renderer animation.

## Agent digest benchmark

`motion-sample.capture.json` remains the unchanged detailed capture. The bridge returns
`motion-sample.compact.json` by default; set `full: true` to request detailed CSS and
motion data, and `images: true` to receive screenshots as image blocks.

| Measure | Raw capture | Default digest |
| --- | ---: | ---: |
| JSON bytes as sent to MCP | 29,207 | 5,652 |
| Pretty raw artifact on disk | 57,587 | — |
| Observed samples | 122 | 29 retained points |
| MCP JSON size reduction | — | 80.6% |

The retained curve meets per-field linear-interpolation tolerances: 0.5 CSS px for
position and size, 0.005 for opacity and matrix/scale values, and 0.01 for other numeric
tracks. The digest calls the curve simplified and keeps a path back to exact raw samples.
It separately reports the observed window (~1,997 ms) and the recorded timing metadata
(2,000 ms), as well as the extracted WAAPI duration (1,100 ms). The raw artifact keeps
the original 110-point `linear()` easing exactly; the digest includes bounded control
points and a raw-field reference.

The 18k-token raw estimate came from the original report. This repository has no
configured model tokenizer, so this benchmark reports exact JSON bytes rather than
claiming an unverified token count. Screenshot data is stored as image files and is not
injected into default agent text.
