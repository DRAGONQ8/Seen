# V4 baseline and test dependency audit

Inspected main commit `980d233` before production changes. This baseline records actual executions, not earlier reports.

## Dependency map

- `build.py` calls `content_tools.load_bank`/`audit`, embeds `content/*.json`, font, `ui.css`, `team-ui.css`, then `graphics.js`, `media-v2.js`, `team-engine.js`, `app.js`, `team-ui.js` into the playable `index.html`.
- `team-engine.spec.cjs` runs the pure engine in a Node VM against normalized content; Python `test_build.py` checks schema and script escaping; `team-content.spec.cjs` validates content/eligibility and optional browser import safety; `v3-media.spec.cjs` checks bundled media bytes and offline decoding.
- `one-tap.spec.cjs` drives the supported `SeenTeamUI` adapter and real award/undo controls. `team-browser.spec.cjs`, `v3-team-ui.spec.cjs`, `v3-build-browser.spec.cjs`, and `team-accessibility.spec.cjs` exercise the same multiplayer API.
- `solo-v3*.spec.cjs`, `game.spec.cjs`, `reliability.spec.cjs`, and `accessibility.spec.cjs` depend on the obsolete `session`/`setup`/`progress` architecture and unsupported solo/survival/practice/duo/tournament routes. They must be removed with the solo implementation; multiplayer recovery/import/a11y coverage remains and is expanded.
- One navigation case in `team-browser.spec.cjs` explicitly requires a solo route. Replace it with supported routes and an assertion that no playable solo entry exists.
- `tests/run.cjs` currently activates every obsolete suite. Replace the explicit suite list; do not use a wildcard that could reactivate removed files.

## Executed baseline

- `npm ci`: passed (3 development packages installed).
- `node tests/team-engine.spec.cjs`: 79 passed, 0 failed; actual bank 648 questions.
- `python -m unittest discover -s tests -p 'test_*.py'`: 6 passed, 0 failed.
- Browser baseline is recorded below after completion.

## Test environment

Linux cloud executor. `/usr/bin/chromium` is available; Playwright and axe are development dependencies only. Firefox and WebKit installation attempted through Playwright's configured download mirrors. No physical Samsung, iPhone, or tablet testing is claimed. Viewport emulation does not establish physical-device behavior.

## Completed browser baseline

`node tests/one-tap.spec.cjs`: **16 passed, 0 failed**, including full 36-question winner and tied matches, direct Blue/Gold/nobody scoring, undo, rapid double taps, stale tokens after reload, doubled points, Pit, Trap, timer, storage denial and backup recovery. No uncaught errors or outbound runtime requests were observed. See `baseline-one-tap.json` for actual case results and measured layout dimensions.

Firefox 146.0.1 and WebKit 26.0 browser archives downloaded successfully through supported Playwright fallback mirrors. Firefox launches. WebKit initially cannot launch because seven shared libraries are missing. `npx playwright install-deps firefox webkit` failed because this executor cannot authenticate `su`; this is an environment limitation, not a game test result.
