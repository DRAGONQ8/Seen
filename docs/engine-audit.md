# Team engine audit (baseline 980d233)

This map was produced before engine edits from the current production sources.

## Dependency and ownership map

- `content/*.json` -> build normalization (`content_tools.py`) -> inline `QUESTION_BANK`.
- `team-engine.js` is a DOM/storage/network-free reducer. It owns selection, question snapshots, clocks, assistance inventory, point transactions, history, undo and save validation.
- `team-ui.js` owns the live match, persistence, rendering and user input. It opens a question with `SELECT_TILE` followed by `START_QUESTION` within one UI tap. Revealed award buttons dispatch `RESOLVE_QUESTION` with `{tileId, questionId, token, teamId}`.
- `RESOLVE_QUESTION` is the production atomic API. It calls the same `scoreOutcome` scoring plan used by UI previews, checkpoints undo, consumes deferred assistance, appends linked point transactions and history, marks the tile, rotates the selector and returns `BOARD`/`MATCH_COMPLETE`.
- `ADJUDICATE`/`NEXT_TURN` remain compatibility APIs for developer tests and historical sessions; production hosting must use `RESOLVE_QUESTION`.
- `validateState` validates imported/local saves, immutable question snapshots and each bounded undo snapshot, then pauses recovery. `restore` preserves invalid input for export instead of replacing the game.

## State transitions

`BOARD -> QUESTION_PREVIEW -> QUESTION_ACTIVE -> ANSWER_REVEAL -> RESOLVE_QUESTION -> BOARD | MATCH_COMPLETE`.

`QUESTION_ACTIVE -> STEAL_OPPORTUNITY` on pass/wrong answer/expiry if stealing enabled. Steal uses the other responder but the next selector remains `1 - original selector`. `trap` delegates without inventing a wrong answer. `call` enters `ASSISTANCE_ACTIVE`, preserving a return state and optionally the main clock. Any ordinary state may pause; resume restores its state and rotates question token. Answer knowledge survives undo, making a previously revealed question adjudication-only.

`ADJUDICATE -> TURN_COMPLETE -> NEXT_TURN` is a retained engine compatibility transition, absent from the production award UI. Atomic resolution undo restores `ANSWER_REVEAL`, both scores/statistics/history/tile/turn and helper inventory, with helper effects deferred until the corrected award. It rotates the token to invalidate stale buttons.

## Baseline evidence

`node tests/team-engine.spec.cjs`: **79 passed, 0 failed**; raw bank **648** questions. The existing suite already covers every original and custom helper, timing, steal, snapshots, score-preview agreement, one-tap replay protection and multi-level undo.

## Gaps to investigate and correct

Restore currently checks score continuity but does not fully bind every question transaction to its historical resolution, validate the historical score formula, or require all per-question assistance records/transactions to be accounted for exactly once. Board slots are individually ranged but need uniqueness/canonical identity checks. State winner/completion metadata and pause invariants need stricter checks. New regression tests will mutate valid saves to establish these defects before changing validation.

## Implemented validation and variant work

New restoration mutation tests reproduced six failure groups before tightening validation. Saves now reconcile each question's award/penalty formula using `scoreOutcome`, bind transaction IDs to one history group/question, validate assistance identity and exact ownership, preserve canonical tile/slot identities even after completion, and reject contradictory completion/winner metadata. Manual corrections reserve transaction and score capacity for the remaining board, preventing a valid live match from growing beyond its restore limits.

New selection excludes pending/disputed/public-disabled questions and incomplete source-verification claims. Missing legacy verification remains grandfathered editorial content; existing saved snapshots remain recoverable after later editorial disablement.

`variant` accepts `classic`, `quick`, `challenge`, `visual`, `custom`. Challenge prioritizes higher question levels within equal eligible repetition priority (notably level 4 in the 600 pool); it never changes an assigned point value. Visual prioritizes images at the same repetition priority and explicitly reports any text fallback. Custom accepts `categoryCount` 2/4/6, equal category quotas per team, and a nonempty unique `pointValues` subset of 200/400/600. Other variants retain six categories and all point values. Classic/compact slot counts stay two/one respectively. Generation, validation, score capacity, snapshots and atomic results all use the same board.

Ordering, progressive clues, multipart and logic formats validate their instructions and full-credit judging metadata. `NEXT_CLUE` requires the current question token, increments persisted `revealedClues` within bounds and rotates the token so duplicate taps cannot skip clues. It is legal only while an unrevealed question/steal is active.

## Historical recovery and review follow-up

The authentic V2 fixture `tests/fixtures/match-v2-historical.json` was generated using the repository's `caacb6d` engine, not a simulated version-number edit. It covers the old Double-owner overwrite and an opposite-team host award before an explicit steal. Migration preserves those recorded scoring conventions, while new resolutions add `scoringVersion: 2` so post-migration awards follow the current formula. This avoids rejecting legitimate historical balances when tightening imported-ledger checks.

Independent release review found that a different but valid ordering permutation could disagree with its canonical answer in a saved question. Engine validation now requires normalized agreement between the full ordered answer and `correctAnswer`, matching the build/import validation. A corruption regression covers this exact case.

## Counter replay prevention (P0 review follow-up)

Independent release review reproduced a save whose `serial` alone was lowered to 0, passed validation, and then reissued an existing score transaction ID. Before the fix, the same reproduction confirmed an imported `serial: 1000000000` could advance to 1000000001 and become unrestorable. Restore now requires every minted clock, transaction, group, helper, pending-helper and resolution identity to match its match prefix and type and carry a suffix no greater than the state's serial. Undo snapshots must not have a serial above the live state and receive the same recursive validation. An extreme counter fails dispatch before any timer, score, undo or state mutation, leaving an exportable/restorable state with a clear error. `nextId` also guards overflow directly.

Final engine verification after this follow-up: `tests/team-engine.spec.cjs` **79 passed, 0 failed**; `tests/v4-engine.spec.cjs` **18 passed, 0 failed**, with **720** current questions. The V4 suite includes 60 helper/outcome/floor combinations, custom board completion and final undo, authentic V2 recovery, the ordering inconsistency regression and both lowered-counter and maximum-counter cases. Logs: `/tmp/seen-team-engine-report.log`, `/tmp/seen-v4-engine-report.log`.
