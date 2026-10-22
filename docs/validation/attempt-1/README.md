# First release-candidate validation (failed)

Artifact: `index.html`, 720 questions, 2,558,241 bytes, SHA-256 `27a2a0e49843d662f3a20b3c4e777fc9fb2302566378e03fe2d5e873bcab2938`.

`npm test` executed all 14 suite commands: 11 passed, 3 failed. This evidence is retained and must not be presented as a passing release.

- `team-browser`: the compact board at a 320px viewport produced 38.5px-wide tiles, below the 44px minimum.
- `team-accessibility`: the same compact-board defect caused 6 touch-target checks to fail across dark/light screens. Classic boards retained adequate targets.
- `team-content --browser`: the 1200-owner-question capacity case timed out waiting for the file picker. Its old test helper left a rejected promise unhandled and therefore did not write a fresh JSON report. The test helper was corrected to use `Promise.all`; a focused rerun reproduced the underlying failure.

The capacity diagnostic used a fresh mobile browser context and a single page. After writing a 1,687,486-character synthetic team save and reloading, the new document received a deferred storage event containing the exact save it had just loaded (same key and page URL; old value null). The application incorrectly opened its other-window conflict modal, which intercepted the import button. Desktop timing often avoided this event. This is a false conflict after navigation, not evidence that the native picker was unavailable.

All state/scoring suites, the 24-check cross-engine suite, the 10-check V4 UI suite, and the other browser scenarios passed in this attempt. The final evidence in the parent directory is recorded separately after the source fixes and a clean complete rerun.
