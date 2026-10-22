# Final validation evidence

`npm test` completed successfully: **14 suite commands passed, 0 failed**. All final JSON reports and the complete log in this directory belong to the same generated artifact.

- Artifact: `index.html`, 2,558,651 bytes.
- SHA-256: `bfed1732dbb89a625a78040d626d4d4143ac0aaf8a08d83047ecd08dfe435d7f`.
- The rebuild performed by `npm test` matched the release candidate byte for byte.

| Command | Named cases passed | Failed | Repeated source cases |
| --- | ---: | ---: | ---: |
| `python -m unittest discover -s tests -p test_*.py` | 13 | 0 | 0 |
| `node tests/team-engine.spec.cjs` | 79 | 0 | 0 |
| `node tests/v4-engine.spec.cjs` | 18 | 0 | 0 |
| `node tests/team-content.spec.cjs` | 27 | 0 | 0 |
| `node tests/v3-media.spec.cjs` | 5 | 0 | 0 |
| `node tests/one-tap.spec.cjs` | 16 | 0 | 0 |
| `node tests/team-browser.spec.cjs` | 30 | 0 | 0 |
| `node tests/v3-team-ui.spec.cjs` | 8 | 0 | 0 |
| `node tests/v3-build-browser.spec.cjs` | 15 | 0 | 0 |
| `node tests/v4-ui.spec.cjs` | 11 | 0 | 0 |
| `node tests/v4-browser.spec.cjs` | 26 | 0 | 0 |
| `node tests/team-accessibility.spec.cjs` | 131 | 0 | 0 |
| `node tests/team-content.spec.cjs --browser` | 7 | 0 | 27 |
| `node tests/v3-media.spec.cjs --browser` | 1 | 0 | 5 |

The content/media browser invocations rerun source checks; those repeated runs are identified separately. These are named-case counts, not a claim about unique assertions across overlapping suites.

Browsers actually executed: chromium 154.0.8037.57, firefox 146.0.1. No uncaught runtime errors or external runtime requests were observed in the archived browser reports.

Firefox loaded the real `file://` artifact and scored offline. Managed Chromium policy blocked native file navigation; Chromium also booted and played from the exact local HTML bytes with networking disabled before startup. WebKit was downloaded but could not launch because seven system shared libraries were unavailable; the executor could not authenticate a system dependency installation.

Mobile testing used touch events, explicit viewports and DPR values. No physical Samsung, iPhone or tablet testing occurred. axe completed 92 screen/theme/size audits with 131 checks passed and 0 violations. It retained 88 incomplete contrast records for gradients/illustrations; these are not claimed as successful contrast determinations.

The [first attempt](attempt-1/README.md) is retained as failed, superseded evidence. It exposed undersized compact tiles and a false recovery conflict from a delayed storage event; both were fixed and checked in the final clean run. The [targeted logs](targeted/) record focused proof before the complete rerun.

See [summary.json](summary.json) for machine-readable command results, versions, limits and artifact identity, and [test-run.log](test-run.log) for the exact complete output. Automated behavior/schema tests do not independently verify every trivia fact.
