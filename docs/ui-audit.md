# V4 presentation dependency audit

Baseline: `980d233` on latest `main`, inspected from production sources, not prior reports.

## Dependencies and transitions

- `build.py` embeds graphics, media, pure `TeamEngine`, shared `app.js` shell, then `TeamUI` into standalone `index.html`; CSS merges shared and team sheets.
- `TeamUI` owns `seen-khaled-teams-v2`: current match, presets, preferred config, completed history, local edits/disabled IDs/reports. `TeamEngine` owns state validation and transitions; UI writes only validated transition results.
- Shared shell provides escaping, URL checks, JSON backup codec, preferences/repetition `seen`, media rendering, navigation, dialog, sound and download helpers. Legacy presentation still calls `session`, `pauseSession`, `makeSetup`; those dependencies are obsolete and are removed in V4.
- Normal path: BOARD → SELECT_TILE preview (internal only) → START_QUESTION → QUESTION_ACTIVE → REVEAL → ANSWER_REVEAL → RESOLVE_QUESTION (token + tile + question) → BOARD/MATCH_COMPLETE. No additional UI confirmation exists on that path.
- Alternative states include STEAL_OPPORTUNITY, ASSISTANCE_ACTIVE and PAUSED. UI hides timer ticks when paused/navigating. ANSWER_REVEAL exposes exactly 3 award controls. Undo returns to a revealed, closed question, preventing a known answer from reopening play.
- `presentTransition` applies one pure reducer result, persists once, renders, announces the outcome; it also normalizes legacy TURN_COMPLETE immediately. New question opening performs selection/optional Pit/start in memory before one presentation write.
- Import validates a full candidate bank/config/history/match before a confirmation mutation. `safeQuestion` handles untrusted data; content HTML is escaped. Import URL schemes use `safeURL` and image IDs must exist locally.

## Confirmed issues and existing working functionality

- Solo training remains selectable in team setup and dispatches into old app routes. Extra checks and user messages retain obsolete solo dependencies. These must be removed alongside the shared shell rewrite.
- Category search, random distribution, named match presets, one-tap scoring, score edits, pause and editorial tools already exist and should be retained; implementation must improve them without duplicating components.
- Favorites live in shared preferences but setup has no favorite controls/filter. Search currently matches only category title; eligibility-limited cards can still be selected, producing avoidable setup errors.
- Assistance configuration has all 10 types but no concise Classic/Enhanced presets. Custom house rules are described in text, but host setup is unnecessarily dense.
- Standalone scoring controls already have minimum touch targets, safe-area treatment, focus restoration, exact result tokens and a transient one-tap undo button.
- `applyEdits` overwrites upstream disabled flags instead of retaining them. Question imports flatten every format to image/text; structured question fields need strict validation and persistence.
- The editorial tools are local owner tools; client-side controls cannot prove identity. V4 labels this accurately rather than adding a pretend security password.

## V4 changes covered by this file owner

Remove obsolete solo presentation; add favorites and normalized search, name presets, clear assistance presets, visual/risk presets using one reducer, strict structured-format import and reliable progressive clue reveal; retain core existing selectors and score actions. Browser verification is recorded in the release validation report, not inferred from this audit.

## Implemented result and verification

- Removed every solo branch, legacy session check and navigation dependency from `team-ui.js`.
- Existing one-tap score token handlers remain intact. Exactly three outcome controls remain after reveal; reversible owner question disabling now applies directly in one tap.
- Category favorites share the host preferences with keyboard operation and persistence. Search normalizes Arabic; insufficient categories cannot be newly selected. Name presets and Classic/Enhanced help presets reduce setup work.
- Classic/Quick retain 36/18 questions. Challenge prefers higher available question levels within unchanged point pools and configures 30-second risk rules; Visual prefers local images and explicitly warns when text is required. Custom safely exposes 2/4/6 total categories and nonempty subsets of 200/400/600 with either one or two question slots.
- Ordering, multi-part, logic and progressive clues render explicit instructions and full-credit judging. Clue steps use reducer tokens/persistence; the last step retains keyboard focus. The editor preserves structured data, while JSON import validates permutations, canonical answers, unsupported types, exact source-verification records and real/nonfuture dates.
- Backup import validates the complete candidate before mutation, including duplicate question text, disabled IDs, reports and preset records. Explicit unsupported verification statuses cannot become editorially eligible.
- Team statistics previously confined to an obsolete profile route now appear in match history. Local editorial tools explicitly identify the host/device owner and explain the lack of account authentication in an offline file.

Targeted browser suite `tests/v4-ui.spec.cjs`: **10 passed, 0 failed**, using Chromium touch/viewport emulation against a temporary current build with 720 questions. No uncaught runtime errors or external gameplay requests. Included actual variant starts, custom scoring/reload, malformed structured imports, progressive-clue recovery, keyboard favorites and awards, and portrait/landscape layouts. Final generated-artifact regression results are recorded by the root release process. No physical Samsung/iPhone tests were performed.

Final full-suite review caught a compact-board CSS regression: an unnecessary value-count grid rule reduced 320px touch widths to 38.5px. Removing that override restores the original vertical compact tiles. A fresh isolated build then passed **72/72** bounding/layout cases: Quick6/Custom2/Custom4, dark/light, 100%/130% text, phone portraits 320/360/412 and landscapes 640/740/915. Minimum tested tile size was 80×44px, with no horizontal overflow or runtime errors. The 320px and 412px screenshots were visually inspected; the existing responsive and accessibility suites retain regression coverage.

A second final recovery check exposed a queued storage notification after reload: identical bytes already loaded by `init` could incorrectly lock the host as another window. `lastObservedRaw` now tracks the initialization read and each successful write; only a different stored value triggers the existing conflict lock. The targeted exact-byte-versus-different-byte browser regression passed, while the full 1200-owner-question mobile import/editor capacity scenario also passed. Authentic legacy `owner-reviewed` questions migrate only through legacy validation to `editorial`, preserving their original historical metadata; unknown statuses still reject. Final-byte checks against SHA256 `bfed1732dbb89a625a78040d626d4d4143ac0aaf8a08d83047ecd08dfe435d7f`: **27/27** content unit checks, **1/1** focused capacity browser scenario, **11/11** V4 UI browser scenarios; no runtime or external-request errors.
