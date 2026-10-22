# Multiplayer engineering audit — 2026-10-21

Audited base: `main` at `980d233` (cloned from the remote for this execution). The historical V3.1 figures were recomputed: 648 questions, 8 categories, 63 media questions, 155 fully documented checked questions, 400 editorial, 88 pending, 5 disputed. Historical passing-suite counts were not reused as new test evidence.

## Reviewed scope

`app.js`, `team-engine.js`, `team-ui.js`, both UI stylesheets, `graphics.js`, `media-v2.js`, `build.py`, `content_tools.py`, every `content/*.json`, media manifests/credits and embedded assets, package scripts, tests/fixtures, previous content/validation/rules reports and generated `index.html`. Work was split among engine, host UI/persistence, content/rules, tournament and QA, with root integration and artifact review.

## Confirmed defects and fixes

| Confirmed issue | Implemented fix |
| --- | --- |
| Single-player routes, daily challenges, sessions, statistics, XP, achievements and backups remained in `app.js`; the team wizard routed back into them. | Replaced the application shell with allowlisted multiplayer routes; deleted the legacy engine/rendering/events/imports and the wizard's individual-play paths. Retired exclusively obsolete tests and removed 419 retired CSS selectors. Shared media, accessibility and persistence utilities remain. |
| Removing the UI alone could still restore a legacy individual session. | Version 4 preferences migrate allowlisted shared settings/favorites/seen IDs only. No individual session, counters, history, achievements or score records are restored. The old envelope is retained untouched; existing two-team storage remains independently versioned at its original key. |
| The setup required nine screens for routine customization. | One lobby contains format, two team names and 3+3 distinct categories. Search, filters, favorites, fair random distribution and optional identity fields are touch accessible. Advanced rules are expandable. Quick-start creates a valid default board immediately. |
| New-board eligibility checked structure and sources but could admit editorial, pending and disputed facts. | Require complete `source-checked` evidence, apply spoiler/content filters, and validate every category/value inventory before creation. Existing saved question snapshots remain usable to preserve legitimate matches. |
| Awarding a competitor was treated as evidence of a wrong selecting-team attempt; some penalties could follow mere nonresponse. | New matches version attempt accounting separately. Only explicit wrong attempts affect incorrect statistics and attempt penalties. Timer expiry, reveal and Nobody alone do not invent a failed attempt. Legacy history retains its original interpretation. |
| Repeated/stale adjudication and correction commands needed stronger identities. | Question tokens plus persisted judgment identifiers and transaction groups; guarded current question/tile/state; idempotent processing; correction operation IDs; monotonic serials through Undo. Exactly three award controls show computed outcomes and commit directly to the board. |
| Undo could expose stale controls or lose consistency between score/tile/turn/powers. | Restore one serialized checkpoint, retain known-answer knowledge, rotate question/judgment tokens and preserve monotonic revision identity. Stale controls cannot apply to a new judgment. |
| Save revision checks alone could miss conflicting same-serial or different-match changes. | Compare complete persisted snapshots before mutations, serialize judgments and host corrections through Web Locks or an IndexedDB transaction, and lock stale windows. Quota/denied-storage states remain playable in memory with clear export controls. Corrupt originals are preserved for recovery. |
| Presenter controls lacked supported timer/early-end engine actions. | Validated paused timer configuration and confirmed early-end transitions. Early results remain explicitly partial; tournament qualification requires a fully completed board. Score correction requires a reason and a ledger entry. |
| Tournament was a legacy individual-player mode rather than a two-team bracket. | Added a pure validated 2/4/8-team knockout bracket that binds normal core-engine matches, records standings, advances qualified teams and replays quick matches on ties. Save/import/export and Undo-related bracket safeguards are implemented. |
| Old media assumptions treated all valid assets as SVG. | Verify licensed data-URI SVG and raster assets; browser decoding tests cover every bundled media item offline. No runtime CDN or image requests are required. |
| Startup validation rejected the new content schema. | Explicitly accepts schema 4; diagnostics now validate the complete generated bank. |
| Solo-specific presentation clutter and unreachable styling remained. | Native Arabic multiplayer shell, dark/light tokens, readable question and answer surfaces, touch targets, reduced motion, mute and fullscreen controls; remove obsolete presentation paths. |
| Build success did not prove source/output synchronization. | Deterministic single-file packaging and a SHA-256 source/output manifest, verified by regression tests. Hostile script-terminator and malformed-JSON tests remain release gates. |

Additional factual corrections and their question IDs are recorded in `content-audit.json`, with the actual supporting references in `content-verification-evidence.json`. No source URL alone was used to certify a fact. A final result-copy regression also fixes the legacy-statistics warning: new attempt-accounting version 3 omits it, while saved versions 1/2 retain the caveat.

## Data and compatibility

The 648 original stable question IDs remain; 18 source-checked questions were added under `space`. A second content pass resolved a retrograde-planet ambiguity by specifying rocky planets and moved the easy Khufu visual question from 600 to 200 rather than preserving an inappropriate difficulty label. A separate suitability pass tagged 33 facts for Family12+. New matches use strict eligibility and the board's immutable question snapshots. Previously valid v2/v3 team saves and match history remain independently recoverable; no individual scores are migrated into teams. Full backup validation precedes a destructive replacement confirmation. Damaged imports cannot replace valid current progress.

Scoring is a synchronous pure engine transition, then an atomic storage record write; a failed disk write keeps a coherent memory state and visibly indicates that it must be exported. Browser storage cannot offer cross-device transactions or rescue a page closed after all storage and manual export have failed. No encryption claim is made for Base64 backups.

## Explicit scope limits

- This is a coherent implementation of the highest-priority multiplayer release, not completion of every item in the broader mission.
- 9 meaningful categories are shipped, not 24. The checked pool is 189, with 179 eligible under conservative spoiler defaults. The remaining 477 editorial/pending/disputed questions are retained for review and excluded from new default matches. Another 10 checked questions exceed conservative spoiler filters.
- Only 34 facts were independently checked in this execution (16 existing +18 new). The other checked statuses are inherited; the entire bank was audited structurally, not independently recertified.
- Family12+ is a functioning 18-question preset from 33 explicitly reviewed short, nonviolent facts across six complete categories, with strict age/suitability filtering. This is editorial suitability review, not a child study or approval for younger children. A visual-only board is unavailable because its six-category tier inventory is insufficient; licensed visuals work in ordinary matches and the lobby explains the shortage.
- True question replacement is not implemented; the existing skip power closes a question without normal answer points and is clearly described as skip. It is not mislabeled as replacement.
- Power counts/timing/scoring and deterministic engine cases exist, but no physical host/participant play study or universal balance claim is made.
- Direct `file://` navigation is blocked by managed Chromium policy (`ERR_BLOCKED_BY_ADMINISTRATOR`). The generated document is tested from its exact bytes with networking disabled and after local HTTP loading followed by offline play. Direct file behavior on physical Galaxy S24 Ultra/Tab S11 Ultra and Samsung Internet remains untested.
- Local browser storage and IndexedDB depend on browser permissions; their failures are surfaced. Multi-device synchronization is outside this standalone architecture. Moving an active tournament requires both its bracket export and the team-match export, as explained in the import dialog.
- The host UI remains a sizeable module with explicit shared shell globals; the scoring and tournament cores are pure independent modules. Further UI extraction would improve maintainability, but no additional gameplay engine is introduced.

## Verification evidence

The final suite results, checked viewports, runtime/network errors, exclusions and limitations are written to `validation-report.json` from actual execution. `build-manifest.json` records the byte count and input/output hashes. Test logs are preserved with the release report; the final standalone artifact is the repository's `index.html`.
