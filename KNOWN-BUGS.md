# Known Bugs

## Annotation screenshot captures the wrong element

- **Status:** Unresolved — user confirmed the same issue persists after the latest rebuild (2026-10-26). Investigation deferred at the user's request.
- **Observed:** 2026-10-26 on the DialKit Photostack example.
- **Steps:** Select and annotate the large split-photo region, open its annotation controls, then capture a screenshot.
- **Actual:** The saved preview shows the smaller centered “Japan” card instead of the annotated split-photo region outlined in blue.
- **Expected:** The annotation capture should show the exact DOM element attached to that annotation. The toolbar camera remains the separate full-page screenshot action.
- **Evidence:** `Screenshot 2026-10-26 at 14.46.23.png` (saved preview) and `Screenshot 2026-10-26 at 14.46.45.png` (annotated region).
- **Debug lead:** Verify which DOM node the annotation ref resolves to at capture time, then compare that node’s live rendered bounds with the screenshot clip. Do not infer the target from the nested control panel or from a stale/document-space box.
- **Attempted fix:** Corrected a viewport/document coordinate mismatch: snapshot capture now measures the selected DOM element's live rendered bounds, adds the current scroll offset, and uses that same box for both the image crop and saved metadata. This change did not resolve the reported Photostack issue; its root cause remains unconfirmed.
- **Verification limits:** The coordinate change passed an unpacked Chrome check on a scrolled, transformed element containing a smaller nested card, including pixel, dimension, ref, and bounds checks before and after layout changes. Focused Biome checks and the extension build passed. These checks did not establish that the original Photostack issue was fixed.
- **Follow-up evidence:** `Screenshot 2026-10-26 at 15.45.14.png` shows the saved “Japan” page/card preview; `Screenshot 2026-10-26 at 15.45.23.png` shows the annotated leaf image. A later live Photostack inspection confirmed the selected DOM ref pointed to the leaf image, but the full screenshot flow was not verified before investigation was deferred.
