# PR #1 branch reconciliation — 2026-10-22

PR: https://github.com/DRAGONQ8/Seen/pull/1

## Cause and safe update

The merge base is `980d2334a9236353c1e6b532b59ed0c148aa6c19`. The PR tip was `b87c4c8538b8f00e4ec087dfe2cf863582385d8c`; main advanced independently through `4834b68`, `f76c27c`, and `bfa6910dbb06f78811356342ca1050ac5b637a23`. Both sides rewrote shared application, engine, UI, content policy, generated HTML and tests. The update merges main into the existing PR branch with both parents; it does not rewrite the original PR commit or update main.

Taking either side wholesale would discard behavior. These are the reconciliation decisions:

| Area | Preserved from main | Preserved from PR / chosen behavior |
| --- | --- | --- |
| Engine/import | Board/score/transaction ledger integrity, serial bounds, correction guards, historical-save validation | Explicit failed attempts, judgment and operation identities, monotonic Undo, timers, early end, tournament compatibility |
| Setup/presenter | Custom 2/4/6-category boards and point values; challenge and visual variants; ordering/clues/multipart/logic rendering | Single lobby, Party/Family12+, tournament bracket, serialized cross-window writes |
| Content | All 72 Kuwait/Science/Logic additions and source/schema/editorial evidence | All 666 PR IDs and payloads; 18 Space additions, reviewed family tags, strict checked-only defaults |
| Eligibility | Editorial Logic remains in owner library; structured formats and owner-pack validation remain | New boards require full source-checked evidence. Visual variant may announce text fallback; strict visual preset still requires full inventory |
| Recovery | Owner edits preserved, malformed imports cannot replace progress, identical storage events do not lock host | Legacy solo envelope remains untouched; only shared preferences/favorites/seen IDs migrate, never solo scores |
| Delivery | CI workflow, .nojekyll, downloadable ZIP | Regenerated HTML, deterministic manifest and refreshed ZIP containing the same HTML bytes |
| Tests | V4 engine/UI/cross-browser and schema/pack regressions | Multiplayer reliability, both accessibility suites, tournament and stress coverage. Retired solo-only tests stay retired |

All IDs from both tips are retained: 738 questions / 12 categories. Counts: 237 source-checked, 413 editorial, 83 pending, 5 disputed; 227 default-eligible under conservative spoilers. The 27 shared payload differences favor PR's content/family corrections; main did not modify those original content files. This is a preservation audit, not fresh independent fact checking.

## Regressions caught during reconciliation

The first local integration run was stopped after finding real CSS defects: an unclosed print media query suppressed following team styles, shrinking touch targets to roughly 31px, and the generic hover translation caused a scoring control to oscillate by 2px at its hit-test boundary. The style block was corrected, scoring-control transforms removed, and a browser regression now checks edge-pointer geometry across animation frames. The failed attempt is retained in `reports/pr1-update/attempt-1.log`; it must not be counted as a passing validation run.

Engine reconciliation also caught overlapping identity schemas, old penalty-accounting differences and early-ended helper evidence; targeted restore/Undo regressions cover these. Future verification dates are rejected consistently by Python, UI and engine.

## Evidence boundaries

The original 15/15 suites, 369 unique checks and 120 simulations / 20,871 transitions describe the earlier PR artifact only. The initial GitHub API lookup returned no Actions runs or commit status entries for that tip. Repository-hosted reports must not be described as newly successful GitHub Actions checks. Current execution and artifact hashes are in `validation-report.json`; subsequent GitHub Actions results must be associated with the updated branch SHA.

Historical reports in `docs/validation`, `docs/ENGINEERING_AUDIT.md` and source-evidence JSON files remain historical records. They do not certify the reconciled artifact.

## Final local execution

After the CSS fixes, the full local run passed 16 suites and exposed two V4 test-adapter failures: assertions ran before serialized Web Locks commits, and one library navigation used the old shell entry point. Those adapters were updated to wait for committed state and navigate through Settings, keeping the result/import/Undo assertions. Only the two changed test suites were rerun; production sources and the tested HTML hash stayed unchanged. `validation-report.json` retains the original 16/18 result and the targeted rerun results separately; effective suite coverage is 18/18 when both reruns pass. GitHub Actions on the pushed commit is a separate full execution and must be checked directly.

The content preservation audit is retained in `reports/pr1-update/content-preservation.json`. The additional 120 historical-engine snapshot check was executed transiently in Node; its successful tool output is not represented as a retained raw report.

## Physical Samsung gate before merge

No physical Galaxy S24 Ultra, Galaxy Tab S11 Ultra, or Samsung Internet execution is available in this managed Linux environment. Touch/viewport/DPR emulation and offline document startup do not substitute for it. Managed Chromium blocks direct `file://` navigation; tests must record this limitation and separately test exact HTML bytes with networking disabled. Any successful direct file test in another engine applies to that engine only.

On both devices, using Samsung Internet, download the exact `index.html` (or extract it from the ZIP), open it from local storage and repeat in airplane mode. Exercise portrait/landscape and enlarged text; start, reveal and award each team/Nobody; double-tap, Undo, modifiers, timer and pause; complete a full match and a tournament including a tie; reload/restore after backgrounding or restart; export/import with Android's file picker; verify images, Arabic font, audio/fullscreen and visible storage-failure recovery. Record device/browser versions and artifact SHA-256. Keep the PR open if device behavior, conflicting changes, or regressions remain unresolved.
