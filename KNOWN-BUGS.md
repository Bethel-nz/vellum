# Known Bugs

## Annotation screenshot captures the wrong element

- **Status:** Rebuilt 2026-10-28; pending your check. The host is the Codex app's built-in browser, which loads the extension from `extension/dist`; it isn't Chrome.
- **Cause (likely, 2026-10-28):** Codex's browser appears to keep the screenshot clip's width and height but drop its x and y, so every element capture came back as the page's top-left corner at the element's size. Evidence: the same top-left crop came back through three different ways of measuring the element (the page script's box, the same box scaled for zoom, and Chrome's own node quads), while all three crop correctly in real Chrome. It's inferred: the Codex browser can't be driven from here to confirm it.
- **Fix (2026-10-28):** element shots no longer use the clip (`extension/src/background.ts`).
  - `nodeBox` scrolls the annotated node into view if needed, then measures it with Chrome's own tools: `DOM.getContentQuads`, transforms included, plus `Page.getLayoutMetrics`. That's the DevTools "Capture node screenshot" measurement.
  - `cropped` takes a plain screenshot of what's on screen and cuts the box out of it with a canvas in the extension. Pixels per CSS pixel come from the image width, so zoom and Retina need no extra maths.
  - It covers the annotation camera, the element and context shots sent with a capture, and motion frames. The full-page screenshot is unchanged.
  - Verified on dialkit.dev/photostack in headless Chrome at 2x: the page started scrolled, the photo was scrolled into view, and the crop was exactly the red-leaves photo's region.
- **Element alone (2026-10-29):** for the element's own picture (annotation camera, element shot, motion frames), anything overlapping it gets a temporary `clip-path` with a hole where the element is. An element with a clip-path of its own is hidden for the shot instead. This is `isolate` in `extension/src/content.ts`. Vellum's overlay is cut the same way, so the toolbar and panel stay on screen while the outline and the scan line stay out of the picture. In the send flow, the overlay is hidden only for the context shot and the full-page shot.
- **Checked on dialkit.dev/photostack** (headless Chrome, 2x, with a stand-in overlay):
  - The crop was the back photo alone.
  - The page was pixel-identical after the shot.
  - Outside the element's box, nothing moved or disappeared. The front photo's fine detail was redrawn slightly differently while it had the hole (median 8/255 per channel), for the frame or two of the shot.
- **Shimmer (2026-10-29, the user's call over AGENTS.md's no-gradient, no-keyframe rule):** a soft band sweeps across the element while its picture is taken. It's a keyframed `transform` on a horizontal gradient, so it runs on the compositor and stays smooth while the capture keeps the page's main thread busy. With reduced motion there's no shimmer, and "Capturing…" shows in the status. It sits inside the element's box, so `isolate` keeps it out of the shot (checked).
- **Main-thread cost (2026-10-29):**
  - The decode, crop and PNG encode already run in the extension's service worker.
  - On the page, `isolate` now reads every position before writing any `clip-path`, so the page lays out once. On the dialkit.dev homepage (1,856 elements) it went from about 5 ms to about 2 ms, with the same 7 elements cut.
  - The annotation camera takes the shot right after freezing the element's animations. Reading its styles (`extract`, the slow part) happens after the shot.
- **Limits:** the part of an element bigger than the window is left out.
- **Observed:** 2026-10-26 on the DialKit Photostack example.
- **Steps:** Select and annotate the large split-photo region, open its annotation controls, then capture a screenshot.
- **Actual:** The saved preview shows the smaller centered “Japan” card instead of the annotated split-photo region outlined in blue.
- **Expected:** The annotation capture should show the exact DOM element attached to that annotation. The toolbar camera remains the separate full-page screenshot action.
- **Evidence:** `Screenshot 2026-10-26 at 14.46.23.png` (saved preview) and `Screenshot 2026-10-26 at 14.46.45.png` (annotated region).
- **Debug lead:** Verify which DOM node the annotation ref resolves to at capture time, then compare that node’s live rendered bounds with the screenshot clip. Do not infer the target from the nested control panel or from a stale/document-space box.
- **Attempted fix:** Corrected a viewport/document coordinate mismatch: snapshot capture now measures the selected DOM element's live rendered bounds, adds the current scroll offset, and uses that same box for both the image crop and saved metadata. This change did not resolve the reported Photostack issue; its root cause remains unconfirmed.
- **Verification limits:** The coordinate change passed an unpacked Chrome check on a scrolled, transformed element containing a smaller nested card, including pixel, dimension, ref, and bounds checks before and after layout changes. Focused Biome checks and the extension build passed. These checks did not establish that the original Photostack issue was fixed.
- **Follow-up evidence:** `Screenshot 2026-10-26 at 15.45.14.png` shows the saved “Japan” page/card preview; `Screenshot 2026-10-26 at 15.45.23.png` shows the annotated leaf image. A later live Photostack inspection confirmed the selected DOM ref pointed to the leaf image, but the full screenshot flow was not verified before investigation was deferred.
