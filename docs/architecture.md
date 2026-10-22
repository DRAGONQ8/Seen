# V4 repository audit and dependency map

Baseline: `980d233` on latest `origin/main`, inspected 2026-10-21 before editing.

- `content/*.json` → `content_tools.load_bank` (normalization and provenance) → `audit` → `build.py` → embedded `QUESTION_BANK` in generated `index.html`.
- `assets/NotoSansArabic-Regular.ttf` + OFL → build embeds font and license. `graphics.js` contains category registry/icons/original SVGs; `media-v2.js` embeds licensed photos/maps/illustrations with credits. Both precede gameplay scripts.
- `team-engine.js`: pure immutable reducer + config/content/state validation + deterministic board selection + atomic scoring/undo ledger. No DOM/storage dependencies.
- `app.js`: legacy mixed shell/utilities/preferences AND obsolete single-player engine, progression, eight-mode navigation, timers, recovery, imports, listeners. `team-ui.js` consumes shared helpers but owns independent `seen-khaled-teams-v2` storage.
- `team-ui.js`: setup → engine.create → dispatch → localStorage → rendering; editorial library validates imported packs and snapshots live questions. Engine question snapshots protect active matches from later library changes.
- `ui.css`: shared visual primitives plus obsolete mode/result/profile rules. `team-ui.css`: setup/board/question/help/history/library, responsive RTL controls.
- `tests/run.cjs`/package scripts explicitly included solo-v3 and legacy solo browser flows; these must be removed rather than bypassed. `tests/fixtures/question-ids-v3.json` protects all 648 historical IDs.
- Prior reports are historical evidence only. Current baseline recount: 648 questions, 8 categories, 63 media-backed questions; existing pure-engine baseline: 79 tests pass.

## Gameplay transitions

Normal host path: BOARD → OPEN_TILE → QUESTION_ACTIVE → REVEAL → ANSWER_REVEAL → RESOLVE_QUESTION(token,winner) → BOARD / MATCH_COMPLETE. Award reducer checks token/phase, checkpoints once, resolves assists/penalties/statistics/tile/history/turn in a single immutable state.

Additional supported paths: preview/START for old saves; active → STEAL_OPPORTUNITY after failure where enabled; active → ASSISTANCE_ACTIVE for phone call → prior active state; PAUSE → PAUSED → RESUME; adjudication/TURN_COMPLETE legacy recovery; UNDO returns revealed question with a fresh token and reverses linked ledger effects; manual SCORE_ADJUST has separate checkpoint/transaction.

## Ownership and edits

Preserve scoring implementation, storage key and version-3 team recovery. Replace only obsolete mixed app runtime with shared multiplayer shell; migrate allowlisted display/favorite/repetition preferences and seen IDs after successful write, then remove unused legacy game storage. New variants reuse reducer/config rather than scoring branches. Exclude explicit pending/disputed claims from new public matches while preserving bank IDs and already-snapshotted match questions.

Detailed engine, UI, content and baseline audits are separate files in this directory. Generated HTML is rebuilt only from sources. External references never execute or load during gameplay.
