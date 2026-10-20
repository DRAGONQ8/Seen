/* Focused Chromium reliability tests. Start: python -m http.server 8765
   Run: node tests/reliability.spec.cjs
   Runtime dependencies: none. Playwright is development-only tooling.
   Local file navigation is blocked by managed browser policy and is not bypassed.
   Direct lexical-state checks exercise persistence invariants; player actions use UI controls. */
'use strict';
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const URL = process.env.SEEN_TEST_URL || 'http://127.0.0.1:8765/index.html';
const results = [], browserErrors = [], externalRequests = [];
let browser;

async function loaded(page) {
  await page.waitForFunction(() => typeof window.SeenDiagnostics !== 'undefined');
}
async function fresh({ deniedStorage = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 448, height: 998 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce', acceptDownloads: true });
  await context.addInitScript(({ denied }) => {
    window.__seenStorageWrites = 0;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (denied) throw new DOMException('Storage unavailable', 'SecurityError');
      if (key === 'seen-khaled-v1') window.__seenStorageWrites++;
      return original.call(this, key, value);
    };
    if (denied) Storage.prototype.getItem = function () { throw new DOMException('Storage unavailable', 'SecurityError'); };
  }, { denied: deniedStorage });
  context.on('page', page => {
    page.on('pageerror', error => browserErrors.push(String(error)));
    page.on('request', request => {
      if (/^https?:/.test(request.url()) && !request.url().startsWith(new global.URL(URL).origin + '/')) externalRequests.push(request.url());
    });
  });
  const page = await context.newPage();
  await page.goto(URL, { waitUntil: 'load' });
  await loaded(page);
  await context.setOffline(true);
  return { page, context };
}
async function state(page) {
  return page.evaluate(() => JSON.parse(JSON.stringify({ progress, prefs, session, route, storageAvailable, storageConflict })));
}
async function muted(page) {
  await page.evaluate(() => { prefs.sound = 0; prefs.music = 0; prefs.reduced = true; prefs.timer = false; applyPrefs(); });
}
async function begin(page, mode = 'solo') {
  // Exercise only restored v1 board compatibility here; current team boards have their own suite.
  if (mode === 'classic') await page.evaluate(() => makeSetup('classic'));
  else await page.locator(`[data-action="setup"][data-mode="${mode}"]`).first().click();
  await page.locator('[data-action="start"]').click();
  assert.equal((await state(page)).route, 'play');
}
async function answer(page) {
  const index = await page.evaluate(() => QUESTION_MAP.get(session.current.id).answer);
  await page.locator(`[data-action="answer"][data-index="${index}"]`).click();
}
async function importJSON(page, value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  await page.locator('#import-file').setInputFiles({ name: 'progress.json', mimeType: 'application/json', buffer: Buffer.from(text) });
}
async function snapshot(page) {
  return page.evaluate(() => JSON.parse(JSON.stringify({ version: 1, prefs, progress })));
}
async function run(name, test) {
  const started = Date.now();
  try { await test(); results.push({ name, ok: true, ms: Date.now() - started }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, ok: false, error: String(error), ms: Date.now() - started }); console.error(`FAIL ${name}\n${error.stack}`); }
}

(async () => {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  await run('Arabic normalization handles marks, hamza, tatweel, digits and proper names', async () => {
    const { page, context } = await fresh();
    const pairs = [
      ['إِبْرَاهِيم', 'ابراهيم'], ['مُوسَى', 'موسى'], ['فَاطِمَة', 'فاطمة'],
      ['خــالــد', 'خالد'], ['  أَبو   بَكر  ', 'ابو بكر'], ['١٢٣ ۴۵۶', '123 456'],
      ['NARUTO-SHIPPUDEN', 'naruto shippuden'], ['بِسْمِ ٱللَّهِ', 'بسم الله']
    ];
    for (const [value, expected] of pairs) assert.equal(await page.evaluate(v => normalizeArabic(v), value), expected);
    assert.notEqual(await page.evaluate(() => normalizeArabic('علي')), await page.evaluate(() => normalizeArabic('عمر')));
    assert.notEqual(await page.evaluate(() => normalizeArabic('على')), await page.evaluate(() => normalizeArabic('علي')), 'Preserve distinct ى and ي');
    assert.notEqual(await page.evaluate(() => normalizeArabic('فاطمة')), await page.evaluate(() => normalizeArabic('فاطمه')), 'Preserve distinct ة and ه');
    await context.close();
  });

  await run('cross-tab save conflict locks stale UI without write ping-pong, then reloads latest', async () => {
    const { page: older, context } = await fresh();
    await muted(older);
    await begin(older);
    await context.setOffline(false);
    const newer = await context.newPage();
    await newer.goto(URL, { waitUntil: 'load' });
    await loaded(newer);
    await context.setOffline(true);
    await older.evaluate(() => { window.__seenStorageWrites = 0; });
    await newer.evaluate(() => { window.__seenStorageWrites = 0; progress.profile.name = 'نسخة أخرى'; progress.xp = 75; prefs.theme = 'light'; persist(); });
    const latest = await newer.evaluate(() => localStorage.getItem(STORAGE_KEY));
    await older.waitForFunction(() => storageConflict);
    assert.equal(await older.evaluate(() => timerHandle), null);
    assert.equal((await state(older)).session.current.paused, true);
    assert.equal(await older.locator('#dialog').evaluate(el => el.open), true);
    await older.keyboard.press('Escape');
    assert.equal(await older.locator('#dialog').evaluate(el => el.open), true, 'Conflict dialog must remain modal');
    const before = await state(older);
    await older.evaluate(() => {
      document.querySelector('[data-action="theme"]').click();
      commitAnswer(QUESTION_MAP.get(session.current.id).answer);
      persist();
      closeDialog();
    });
    await older.waitForTimeout(650);
    assert.equal(await older.evaluate(() => window.__seenStorageWrites), 0);
    assert.equal(await newer.evaluate(() => window.__seenStorageWrites), 1);
    assert.equal((await state(newer)).storageConflict, false);
    assert.equal((await state(older)).progress.answers, before.progress.answers);
    assert.equal((await state(older)).prefs.theme, before.prefs.theme);
    assert.equal(await older.evaluate(() => localStorage.getItem(STORAGE_KEY)), latest);
    await newer.close();
    await context.setOffline(false);
    await Promise.all([older.waitForNavigation({ waitUntil: 'load' }), older.locator('[data-action="reload"]').click()]);
    await loaded(older);
    const restored = await state(older);
    assert.equal(restored.storageConflict, false);
    assert.equal(restored.progress.profile.name, 'نسخة أخرى');
    assert.equal(restored.progress.xp, 75);
    assert.equal(restored.prefs.theme, 'light');
    assert.equal(restored.session.current.paused, true);
    await context.close();
  });

  await run('corrupt survival session is discarded on reload while valid profile survives', async () => {
    const { page, context } = await fresh();
    await muted(page);
    await begin(page, 'survival');
    await page.evaluate(() => { session.players[0].lives = 4; progress.xp = 123; persist(); });
    await context.setOffline(false);
    await page.reload({ waitUntil: 'load' });
    await loaded(page);
    const restored = await state(page);
    assert.equal(restored.session, null);
    assert.equal(restored.progress.xp, 123);
    assert.equal(restored.route, 'home');
    assert.equal(restored.storageAvailable, true);
    assert.equal(await page.locator('[data-action="resume"]').count(), 0);
    await context.close();
  });

  await run('session validation rejects malformed fields and duplicate board/category identifiers', async () => {
    const { page, context } = await fresh();
    await muted(page);
    await begin(page);
    const checks = await page.evaluate(() => {
      const base = JSON.parse(JSON.stringify(session));
      const edits = [
        s => { s.players[0].lives = 4; }, s => { s.current.base = 9999; },
        s => { s.current.timed = 'yes'; }, s => { s.current.deadline = {}; },
        s => { s.current.earned = -1; }, s => { s.current.correct = 'yes'; },
        s => { s.current.text = {}; }, s => { s.current.hint = 'yes'; },
        s => { s.current.remainingMs = 180001; }, s => { s.current.order = [0, 0, 1, 2]; },
        s => { s.cats = ['anime', 'anime']; }, s => { s.remaining.push(s.remaining[0]); }
      ];
      return edits.map(edit => { const s = structuredClone(base); edit(s); return validateSession(s) === null; });
    });
    assert(checks.every(Boolean));
    assert.equal(await page.evaluate(() => validateSession(JSON.parse(JSON.stringify(session))) !== null), true);
    await context.close();
  });

  await run('storage denial allows a complete game and downloadable valid progress export', async () => {
    const { page, context } = await fresh({ deniedStorage: true });
    await muted(page);
    assert.equal((await state(page)).storageAvailable, false);
    await begin(page);
    for (let i = 0; i < 10; i++) {
      await answer(page);
      assert.equal((await state(page)).progress.answers, i + 1);
      await page.locator('[data-action="next"]').click();
    }
    const finished = await state(page);
    assert.equal(finished.session.status, 'done');
    assert.equal(finished.progress.games, 1);
    assert.equal(finished.progress.correct, 10);
    assert.equal(finished.storageAvailable, false);
    await page.locator('[data-action="nav"][data-route="settings"]:visible').first().click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-action="export"]').click()]);
    assert.match(download.suggestedFilename(), /^seen-khaled-\d{4}-\d{2}-\d{2}\.json$/);
    const saved = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
    assert.equal(saved.progress.correct, 10);
    assert.equal(saved.progress.games, 1);
    assert.equal(saved.session, undefined);
    assert.equal(await page.evaluate(data => validateSave(data).progress.correct, saved), 10);
    await context.close();
  });

  await run('import rejects malformed schemas, invalid values and prototype keys without replacing progress', async () => {
    const { page, context } = await fresh();
    const valid = await snapshot(page), before = await state(page);
    const wrongVersion = structuredClone(valid); wrongVersion.version = 99;
    const wrongStats = structuredClone(valid); wrongStats.progress.correct = 1;
    const wrongPrefs = structuredClone(valid); wrongPrefs.prefs.music = -1;
    const bad = [wrongVersion, wrongStats, wrongPrefs, '{not json}', JSON.stringify(valid).slice(0, -1) + ',"__proto__":{"polluted":true}}'];
    for (const item of bad) {
      await importJSON(page, item);
      await page.waitForTimeout(120);
      assert.equal(await page.locator('#confirm-import').count(), 0);
      const after = await state(page);
      assert.deepEqual(after.progress, before.progress);
      assert.deepEqual(after.prefs, before.prefs);
      assert.equal(await page.evaluate(() => Object.prototype.polluted), undefined);
      assert.match(await page.locator('#toast').textContent(), /[\u0600-\u06ff]/);
    }
    await context.close();
  });

  await run('import confirmation and sanitization preserve archived v1 classic compatibility', async () => {
    const { page, context } = await fresh();
    await muted(page);
    const data = await snapshot(page);
    data.progress.profile.name = '<img src=x onerror=x=1>';
    data.progress.profile.favorites = ['anime', 'anime', 'geo', 'unknown'];
    data.progress.xp = 200;
    data.session = { players: [{ name: '<script>', lives: 999 }] };
    await page.evaluate(() => { window.x = 0; });
    await importJSON(page, data);
    await page.locator('#confirm-import').waitFor();
    assert.equal((await state(page)).progress.xp, 0, 'Import must wait for explicit confirmation');
    await page.locator('#confirm-import').click();
    const after = await state(page);
    assert.equal(after.progress.xp, 200);
    assert.deepEqual(after.progress.profile.favorites, ['anime', 'geo']);
    assert(!/[<>]/.test(after.progress.profile.name));
    assert.equal(after.session, null);
    assert.equal(await page.evaluate(() => window.x), 0);
    assert.equal(await page.locator('img[src="x"]').count(), 0);
    await page.locator('[data-action="nav"][data-route="home"]:visible').first().click();
    await begin(page, 'classic');
    const board = (await state(page)).session.board;
    assert.equal(board.length, 12);
    assert.equal(new Set(board.map(t => t.key)).size, 12);
    await context.close();
  });

  await run('saved music preference never autostarts; a gesture enables sound and disabling stops voices', async () => {
    const { page, context } = await fresh();
    assert.equal(await page.evaluate(() => audioContext), null);
    assert.equal(await page.evaluate(() => musicHandle), null);
    await page.evaluate(() => { prefs.music = 35; prefs.sound = 0; persist(); });
    await context.setOffline(false);
    await page.reload({ waitUntil: 'load' });
    await loaded(page);
    await page.waitForTimeout(300);
    assert.equal((await state(page)).prefs.music, 35);
    assert.equal(await page.evaluate(() => audioContext), null);
    assert.equal(await page.evaluate(() => musicHandle), null);
    await page.locator('[data-action="theme"]').click();
    assert.equal(await page.evaluate(() => audioContext !== null), true);
    assert.equal(await page.evaluate(() => musicHandle !== null), true);
    await page.locator('[data-action="nav"][data-route="settings"]:visible').first().click();
    await page.locator('#pref-music').focus();
    await page.locator('#pref-music').press('Home');
    assert.equal((await state(page)).prefs.music, 0);
    assert.equal(await page.evaluate(() => musicHandle), null);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => musicVoices.size), 0);
    await page.locator('#pref-duration').selectOption('45');
    await page.locator('#pref-textSize').selectOption('115');
    await page.reload({ waitUntil: 'load' });
    await loaded(page);
    const restored = await state(page);
    assert.equal(restored.prefs.theme, 'light');
    assert.equal(restored.prefs.music, 0);
    assert.equal(restored.prefs.duration, 45);
    assert.equal(restored.prefs.textSize, 115);
    assert.equal(await page.evaluate(() => audioContext), null);
    await context.close();
  });

  await run('quick timer expires once after 12 seconds and no gameplay interval survives feedback', async () => {
    const { page, context } = await fresh();
    await muted(page);
    await page.clock.install();
    await begin(page, 'quick');
    assert.equal((await state(page)).session.current.remainingMs, 12000);
    await page.clock.fastForward(13000);
    const expired = await state(page);
    assert.equal(expired.session.current.outcome, 'timeout');
    assert.equal(expired.session.current.phase, 'feedback');
    assert.equal(expired.session.results.length, 1);
    assert.equal(expired.progress.answers, 1);
    assert.equal(await page.evaluate(() => timerHandle), null);
    await page.clock.fastForward(60000);
    assert.equal((await state(page)).progress.answers, 1);
    assert.equal(await page.evaluate(() => timerHandle), null);
    await context.close();
  });

  await run('already-expired first ticker call resolves once without creating a lingering interval', async () => {
    const { page, context } = await fresh();
    await muted(page);
    await begin(page, 'quick');
    await page.evaluate(() => { session.current.deadline = Date.now() - 1; render(); });
    assert.equal((await state(page)).session.current.outcome, 'timeout');
    assert.equal((await state(page)).progress.answers, 1);
    assert.equal(await page.evaluate(() => timerHandle), null);
    await page.waitForTimeout(650);
    assert.equal((await state(page)).session.results.length, 1);
    await context.close();
  });

  await run('all reliability cases have no uncaught errors and no external network requests', async () => {
    assert.deepEqual(browserErrors, []);
    assert.deepEqual(externalRequests, []);
  });
  await browser.close();
  const report = { testURL: URL, browser: 'Chromium with Android touch/phone viewport emulation; no physical Samsung hardware', localFileWorkflow: 'Not executed: managed browser blocks file:// navigation', tests: results, passed: results.filter(t => t.ok).length, failed: results.filter(t => !t.ok).length, browserErrors, externalRequests };
  await fs.writeFile('/tmp/seen-reliability-report.json', JSON.stringify(report, null, 2));
  console.log(`\n${report.passed} passed, ${report.failed} failed; /tmp/seen-reliability-report.json`);
  if (report.failed) process.exitCode = 1;
})().catch(async error => { console.error(error.stack); await browser?.close(); process.exitCode = 1; });
