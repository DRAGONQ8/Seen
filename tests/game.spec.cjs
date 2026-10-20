/* Actual Chromium integration tests. Run a local static test server, then node tests/game.spec.cjs
   This managed browser blocks file:// navigation; local-file execution remains untested.
   Playwright is test tooling only; index.html has no runtime dependencies. */
'use strict';
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const HTML = path.resolve(__dirname, '..', 'index.html');
const URL = process.env.SEEN_TEST_URL || 'http://127.0.0.1:8765/index.html';
const TEST_ORIGIN = new globalThis.URL(URL).origin;
const results = [];
let browser;
const errors = [];
const network = [];
const measurements = {};
async function fresh(viewport = { width: 1470, height: 956 }) {
  const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce', acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  page.on('request', r => { if (/^https?:/.test(r.url()) && new globalThis.URL(r.url()).origin !== TEST_ORIGIN) network.push(r.url()); });
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.SeenDiagnostics !== 'undefined');
  await context.setOffline(true);
  // Preference setup only; all gameplay is exercised via real UI controls.
  await page.evaluate(() => { prefs.sound = 0; prefs.music = 0; prefs.reduced = true; applyPrefs(); persist(); });
  return { page, context };
}
async function state(page) {
  return page.evaluate(() => JSON.parse(JSON.stringify({ session, prefs, progress, route, setup })));
}
async function currentAnswer(page) {
  return page.evaluate(() => {
    const c = session.current, q = QUESTION_MAP.get(c.id);
    return { id: q.id, answer: q.answer, label: q.options[q.answer], base: c.base, level: q.level, order: c.order, format: c.format, claimIndex: c.claimIndex, image: q.image || null };
  });
}
async function nav(page, route) {
  const visible = page.locator(`[data-action="nav"][data-route="${route}"]:visible`).first();
  await visible.click();
  assert.equal((await state(page)).route, route);
}
async function start(page, mode, { format, cats, players } = {}) {
  await page.locator(`[data-action="setup"][data-mode="${mode}"]`).first().click();
  if (cats) {
    const selected = (await state(page)).setup.cats;
    for (const id of [...new Set([...selected, ...cats])]) {
      if (selected.includes(id) !== cats.includes(id)) await page.locator(`[data-action="toggle-category"][data-id="${id}"]`).click();
    }
  }
  if (format) await page.locator('#format').selectOption(format);
  if (players) await page.locator('#player-count').selectOption(String(players));
  await page.locator('[data-action="start"]').click();
  assert.equal((await state(page)).route, 'play');
}
async function ready(page) {
  const s = (await state(page)).session;
  if (s.handoff) await page.locator('[data-action="ready"]').click();
  if ((await state(page)).session.current?.paused) await page.locator('[data-action="unpause"]').click();
}
async function choose(page, correct = true, keyboard = false) {
  const a = await currentAnswer(page);
  let index = correct ? a.answer : (a.answer + 1) % 4;
  if (a.format === 'boolean') {
    index = a.claimIndex === a.answer ? 1 : 0;
    if (!correct) index = 1 - index;
  }
  if (a.format === 'text') {
    const text = correct ? a.label.replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي') : 'إجابة خاطئة عمدًا';
    await page.locator('#written-answer').fill(`  ${text}  `);
    await page.locator('#written-answer').press('Enter');
  } else if (keyboard) {
    const position = a.format === 'boolean' ? [1, 0].indexOf(index) : a.order.indexOf(index);
    await page.locator('body').click({ position: { x: 1, y: 1 } });
    await page.keyboard.press(String(position + 1));
  } else {
    await page.locator(`[data-action="answer"][data-index="${index}"]`).click();
  }
  return a;
}
async function run(name, fn) {
  if (process.env.SEEN_TEST_FILTER && !name.includes(process.env.SEEN_TEST_FILTER)) return;
  const started = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - started }); console.log(`PASS ${name} (${Date.now() - started}ms)`); }
  catch (error) { results.push({ name, ok: false, error: String(error), ms: Date.now() - started }); console.error(`FAIL ${name}\n${error.stack}`); }
}
async function complete(page, mode) {
  const ids = new Set();
  while ((await state(page)).session.status === 'active') {
    await ready(page);
    let s = (await state(page)).session;
    if (!s.current) await page.locator('[data-action="tile"]:enabled').first().click();
    s = (await state(page)).session;
    const c = s.current;
    assert.equal(c.phase, 'answer');
    assert(!ids.has(c.id), `Repeated question within ${mode}: ${c.id}`);
    ids.add(c.id);
    assert.equal(await page.locator('.feedback').count(), 0);
    assert.equal(await page.locator('.source-link').count(), 0, 'Answer metadata must stay concealed until commit');
    const correct = mode !== 'survival';
    const before = s.players[s.turn];
    const a = await choose(page, correct);
    s = (await state(page)).session;
    assert.equal(s.current.phase, 'feedback');
    assert.equal(s.current.correct, correct);
    const expected = !correct || mode === 'practice' ? 0 : a.base + Math.min(250, Math.floor(before.streak / 2) * 50);
    assert.equal(s.current.earned, expected);
    assert.equal(s.players[s.turn].score, before.score + expected);
    assert.equal(s.results.length, ids.size, 'Exactly one result per committed question');
    assert.equal(await page.locator('[data-action="answer"]:enabled').count(), 0);
    assert(/^https:\/\//.test(await page.locator('.source-link').first().getAttribute('href')));
    await page.locator('[data-action="next"]').click();
    const after = (await state(page)).session;
    if (mode === 'classic' && after.status === 'active') {
      assert.equal(await page.locator('.point-tile.used:disabled').count(), ids.size);
    }
    if (mode === 'duo' || mode === 'tournament') {
      if (after.status === 'active') {
        assert.equal(after.turn, (s.turn + 1) % s.players.length);
        assert.equal(after.handoff, true);
        assert.equal(after.current, null, 'Next question must wait for handoff');
      }
    }
  }
  const final = await state(page);
  assert.equal(final.route, 'result');
  assert.equal(final.progress.games, 1);
  assert.equal(final.session.results.length, mode === 'survival' ? 3 : final.session.target);
  assert.equal(new Set(final.session.results.map(r => r.id)).size, ids.size);
  assert.equal(final.progress.answers, ids.size);
  if (mode === 'practice') {
    assert.equal(final.progress.points, 0);
    assert.equal(final.progress.xp, ids.size * 5);
  } else if (mode !== 'survival') assert(final.progress.points > 0);
  if (mode === 'images') assert.equal(final.progress.imageCorrect, ids.size);
  return final;
}
(async () => {
  // A short, bounded wait allows a concurrent build to finish without hiding a missing deliverable.
  for (let i = 0; i < 10; i++) {
    try { await fs.access(HTML); break; } catch { if (i === 9) throw new Error('index.html is not built'); await new Promise(r => setTimeout(r, 1000)); }
  }
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  await run('local launch, Arabic RTL, bank validation and navigation', async () => {
    const { page, context } = await fresh();
    assert.equal(await page.locator('html').getAttribute('lang'), 'ar');
    assert.equal(await page.locator('html').getAttribute('dir'), 'rtl');
    const counts = await page.evaluate(() => SeenDiagnostics.counts());
    assert.equal(Object.keys(counts).length, 8);
    assert(Object.values(counts).every(n => n >= 40));
    assert.equal(await page.evaluate(() => SeenDiagnostics.questionCount), Object.values(counts).reduce((a, b) => a + b, 0));
    assert.deepEqual(await page.evaluate(() => SeenDiagnostics.validateBank()), []);
    assert.equal(await page.locator('.mode-card').count(), 8);
    assert(!/[٠-٩۰-۹]/.test(await page.locator('body').innerText()));
    for (const route of ['categories', 'profile', 'settings', 'home']) await nav(page, route);
    await page.locator('[data-action="about"]:visible').click();
    assert(await page.locator('#dialog').isVisible());
    assert((await page.locator('#dialog').innerText()).includes('900'));
    await page.locator('[data-action="close-dialog"]').first().click();
    await page.screenshot({ path: '/tmp/seen-home-tablet.png', fullPage: true });
    await context.close();
  });
  for (const mode of ['solo', 'quick', 'classic', 'images', 'survival', 'practice', 'duo', 'tournament']) {
    await run(`complete mode: ${mode}`, async () => {
      const { page, context } = await fresh();
      await start(page, mode);
      if (mode === 'classic') {
        const s = (await state(page)).session;
        assert.equal(s.board.length, s.cats.length * 6);
        assert.equal(new Set(s.board.map(t => t.id)).size, s.board.length);
        for (const cat of s.cats) assert.deepEqual(s.board.filter(t => t.category === cat).map(t => t.points), [100, 200, 300, 400, 500, 600]);
        await page.screenshot({ path: '/tmp/seen-board-tablet.png', fullPage: true });
      }
      if (mode === 'images') {
        await page.locator('.question-media img').waitFor({ state: 'visible' });
        await page.waitForFunction(() => [...document.images].every(i => i.complete && i.naturalWidth > 0));
        assert((await currentAnswer(page)).image.startsWith('flag-'));
        await page.locator('[data-action="zoom"]').click();
        assert(await page.locator('.zoom-image').isVisible());
        await page.locator('[data-action="close-dialog"]').first().click();
        await ready(page);
        await page.screenshot({ path: '/tmp/seen-image-question.png', fullPage: true });
      }
      await complete(page, mode);
      await context.close();
    });
  }
  await run('classic category counts and exhausted series guard', async () => {
    const { page, context } = await fresh();
    await page.locator('[data-mode="classic"]').first().click();
    await page.locator('[data-action="toggle-category"][data-id="games"]').click();
    assert(await page.locator('[data-action="start"]').isDisabled());
    await page.locator('[data-action="toggle-category"][data-id="geo"]').click();
    assert(await page.locator('[data-action="start"]').isEnabled());
    await page.locator('[data-action="start"]').click();
    assert.equal((await state(page)).session.board.length, 12);
    await context.close();
  });
  await run('all six helpers, second attempt, elimination, multipliers and skip', async () => {
    const { page, context } = await fresh();
    await start(page, 'solo');
    const initial = await state(page);
    const a = await currentAnswer(page);
    await page.locator('[data-helper="time"]').click();
    let s = (await state(page)).session;
    assert(s.current.deadline >= initial.session.current.deadline + 14900);
    assert.equal(s.bags[0].time, 0);
    await page.locator('[data-helper="hint"]').click();
    assert(await page.locator('.hint-box').isVisible());
    await page.locator('[data-helper="double"]').click();
    await page.locator('[data-helper="second"]').click();
    await choose(page, false);
    s = (await state(page)).session;
    assert.equal(s.current.phase, 'answer');
    assert.equal(s.current.attempted, true);
    assert.equal(s.results.length, 0);
    assert.equal(s.players[0].score, 0);
    await page.locator('[data-helper="fifty"]').click();
    s = (await state(page)).session;
    assert.equal(s.current.eliminated.length, 3);
    assert(!s.current.eliminated.includes(a.answer));
    assert.equal(await page.locator('[data-action="answer"]:enabled').count(), 1);
    await choose(page);
    s = (await state(page)).session;
    assert.equal(s.current.earned, a.base * 2);
    assert.equal(s.results.length, 1);
    await page.locator('[data-action="next"]').click();
    await page.locator('[data-helper="skip"]').click();
    s = (await state(page)).session;
    assert.equal(s.current.outcome, 'skip');
    assert.equal(s.current.earned, 0);
    assert.equal(s.results.length, 2);
    assert.equal(s.bags[0].skip, 0);
    assert.equal((await state(page)).progress.answers, 2);
    await context.close();
  });
  await run('pause, refresh, exact question/order/progress restoration and resumption', async () => {
    const { page, context } = await fresh();
    await start(page, 'solo');
    await choose(page);
    await page.locator('[data-action="next"]').click();
    await page.locator('[data-action="pause"]').click();
    const before = await state(page);
    assert.equal(before.session.current.paused, true);
    assert.equal(before.session.current.deadline, null);
    await page.waitForTimeout(1100);
    assert.equal((await state(page)).session.current.remainingMs, before.session.current.remainingMs);
    await context.setOffline(false);
    await page.reload({ waitUntil: 'load' });
    await context.setOffline(true);
    const loaded = await state(page);
    assert.deepEqual(loaded.session.current.order, before.session.current.order);
    assert.equal(loaded.session.current.id, before.session.current.id);
    assert.equal(loaded.session.current.remainingMs, before.session.current.remainingMs);
    assert.equal(loaded.session.results.length, 1);
    assert.equal(loaded.progress.points, before.progress.points);
    await page.locator('[data-action="resume"]').click();
    assert(await page.locator('[data-action="unpause"]').isVisible());
    await page.locator('[data-action="unpause"]').click();
    await choose(page);
    assert.equal((await state(page)).session.results.length, 2);
    await context.close();
  });
  await run('keyboard choices, Arabic normalized text and true/false answers', async () => {
    const one = await fresh();
    await start(one.page, 'solo');
    await choose(one.page, true, true);
    assert.equal((await state(one.page)).session.current.correct, true);
    await one.page.locator('body').click({ position: { x: 1, y: 1 } });
    await one.page.keyboard.press('Enter');
    assert.equal((await state(one.page)).session.current.phase, 'answer');
    await one.page.keyboard.press('Escape');
    assert.equal((await state(one.page)).session.current.paused, true);
    await one.context.close();
    const two = await fresh();
    assert.equal(await two.page.evaluate(() => SeenDiagnostics.normalizeArabic(' إِجَابَةٌ  أُخْرَى ١٢ ')), 'اجابه اخري 12');
    await start(two.page, 'solo', { format: 'text', cats: ['football'] });
    assert(await two.page.locator('[data-helper="fifty"]').isDisabled());
    await choose(two.page);
    assert.equal((await state(two.page)).session.current.correct, true);
    await two.context.close();
    const three = await fresh();
    await start(three.page, 'solo', { format: 'boolean' });
    assert.equal(await three.page.locator('.answer-card').count(), 2);
    assert(await three.page.locator('[data-helper="fifty"]').isDisabled());
    await choose(three.page, true, true);
    assert.equal((await state(three.page)).session.current.correct, true);
    await three.context.close();
  });
  await run('quick challenge expires once after real 12-second countdown', async () => {
    const { page, context } = await fresh();
    await start(page, 'quick');
    const a = await currentAnswer(page);
    await page.waitForFunction(() => session.current.phase === 'feedback', null, { timeout: 16000 });
    const s = (await state(page)).session;
    assert.equal(s.current.id, a.id);
    assert.equal(s.current.outcome, 'timeout');
    assert.equal(s.current.correct, false);
    assert.equal(s.current.earned, 0);
    assert.equal(s.results.length, 1);
    await page.waitForTimeout(500);
    assert.equal((await state(page)).session.results.length, 1);
    await context.close();
  });
  await run('local export/import validation, confirmation, XSS handling and reset', async () => {
    const { page, context } = await fresh();
    await start(page, 'solo');
    await choose(page);
    const before = await state(page);
    await nav(page, 'settings');
    await page.locator('#profile-name').count();
    const downloaded = page.waitForEvent('download');
    await page.locator('[data-action="export"]').click();
    const download = await downloaded;
    const saved = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
    assert.equal(saved.version, 1);
    assert.equal(saved.progress.answers, 1);
    assert.equal(saved.progress.points, before.progress.points);
    assert(!('session' in saved));
    await page.locator('#import-file').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('تعذّرت قراءة'));
    assert.equal((await state(page)).progress.answers, 1);
    const invalid = structuredClone(saved); invalid.progress.correct = 99999;
    await page.locator('#import-file').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(invalid)) });
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('غير متناسقة'));
    assert.equal(await page.locator('#confirm-import').count(), 0);
    saved.progress.profile.name = 'خالد المختبر';
    await page.locator('#import-file').setInputFiles({ name: 'saved.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) });
    await page.locator('#confirm-import').waitFor({ state: 'visible' });
    assert.equal((await state(page)).progress.profile.name, 'خالد');
    await page.locator('#confirm-import').click();
    assert.equal((await state(page)).progress.profile.name, 'خالد المختبر');
    assert.equal((await state(page)).session, null);
    await nav(page, 'settings');
    const nickname = page.locator('[data-profile="name"]');
    await nickname.fill('<img src=x onerror=alert(1)>');
    await nickname.press('Tab');
    assert(!(await state(page)).progress.profile.name.includes('<'));
    assert.equal(await page.locator('img[src="x"]').count(), 0);
    await page.locator('[data-action="reset"]').click();
    assert.equal((await state(page)).progress.answers, 1);
    await page.locator('[data-action="close-dialog"]').first().click();
    assert.equal((await state(page)).progress.answers, 1);
    await page.locator('[data-action="reset"]').click();
    await page.locator('#confirm-reset').click();
    assert.equal((await state(page)).progress.answers, 0);
    assert.equal((await state(page)).progress.points, 0);
    await context.close();
  });
  await run('deterministic local daily challenge and one completion per day', async () => {
    const one = await fresh(), two = await fresh();
    await one.page.locator('[data-action="daily"]').click();
    await two.page.locator('[data-action="daily"]').click();
    const s1 = (await state(one.page)).session, s2 = (await state(two.page)).session;
    assert.deepEqual([s1.current.id, ...s1.remaining], [s2.current.id, ...s2.remaining]);
    assert.deepEqual(s1.current.order, s2.current.order);
    assert.equal(s1.date, await one.page.evaluate(() => localDate()));
    await complete(one.page, 'daily');
    await nav(one.page, 'home');
    assert(await one.page.locator('[data-action="daily"]').isDisabled());
    assert.equal((await state(one.page)).progress.daily[s1.date].completed, true);
    await one.context.close(); await two.context.close();
  });
  await run('phone/tablet layouts, rotation persistence, touch targets, light and enlarged text', async () => {
    const { page, context } = await fresh({ width: 412, height: 915 });
    const views = [
      { width: 412, height: 915, name: 'phone-portrait' },
      { width: 915, height: 412, name: 'phone-landscape' },
      { width: 320, height: 640, name: 'small-phone' },
      { width: 800, height: 1280, name: 'tablet-portrait' },
      { width: 1848, height: 1200, name: 'tablet-landscape' }
    ];
    await start(page, 'solo');
    const original = (await state(page)).session.current.id;
    for (const view of views) {
      await page.setViewportSize({ width: view.width, height: view.height });
      await page.waitForTimeout(100);
      const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, answer: [...document.querySelectorAll('.answer-card')].map(x => ({ w: x.getBoundingClientRect().width, h: x.getBoundingClientRect().height })) }));
      assert(layout.scroll <= layout.width + 1, `${view.name}: horizontal overflow ${layout.scroll}/${layout.width}`);
      assert(layout.answer.every(r => r.h >= 44 && r.w >= 90), `${view.name}: small answer targets`);
      assert.equal((await state(page)).session.current.id, original);
      await page.screenshot({ path: `/tmp/seen-${view.name}.png`, fullPage: true });
    }
    await choose(page);
    await nav(page, 'settings');
    await page.locator('[data-pref="theme"]').selectOption('light');
    await page.locator('[data-pref="textSize"]').selectOption('130');
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    await page.setViewportSize({ width: 412, height: 915 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: '/tmp/seen-settings-light-phone.png', fullPage: true });
    await context.close();
  });
  await run('6-category board at phone and tablet sizes without document overflow', async () => {
    const { page, context } = await fresh({ width: 412, height: 915 });
    await start(page, 'classic', { cats: ['anime', 'football', 'geo', 'games', 'prophets', 'seerah'] });
    assert.equal((await state(page)).session.board.length, 36);
    for (const viewport of [{ width: 412, height: 915 }, { width: 915, height: 412 }, { width: 800, height: 1280 }, { width: 1848, height: 1200 }]) {
      await page.setViewportSize(viewport);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `6-category board overflows at ${viewport.width}`);
      assert.equal(await page.locator('.point-tile:enabled').count(), 36);
    }
    await context.close();
  });
  await run('3-player tournament has five turns each and independent helpers', async () => {
    const { page, context } = await fresh();
    await start(page, 'tournament', { players: 3 });
    assert.equal((await state(page)).session.target, 15);
    await ready(page);
    await page.locator('[data-helper="hint"]').click();
    let s = (await state(page)).session;
    assert.equal(s.bags[0].hint, 1);
    assert.equal(s.bags[1].hint, 2);
    assert.equal(s.bags[2].hint, 2);
    const final = await complete(page, 'tournament');
    assert.deepEqual(final.session.players.map(p => p.answered), [5, 5, 5]);
    await context.close();
  });
  await run('insufficient classic filter preserves saved session', async () => {
    const { page, context } = await fresh();
    await start(page, 'solo');
    await choose(page);
    const saved = (await state(page)).session.id;
    await nav(page, 'home');
    await page.locator('[data-mode="classic"]').first().click();
    for (const id of ['geo', 'games']) await page.locator(`[data-action="toggle-category"][data-id="${id}"]`).click();
    await page.locator('#series').selectOption('Solo Leveling');
    assert(await page.locator('[data-action="start"]').isDisabled());
    assert.equal((await state(page)).session.id, saved);
    await nav(page, 'home');
    await page.locator('[data-action="resume"]').click();
    assert.equal((await state(page)).session.results.length, 1);
    await context.close();
  });
  await run('duplicate imported favorites are deduplicated safely', async () => {
    const { page, context } = await fresh();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem(STORAGE_KEY)));
    saved.progress.profile.favorites = ['geo', 'geo', 'football', 'football', 'unknown'];
    await nav(page, 'settings');
    await page.locator('#import-file').setInputFiles({ name: 'duplicates.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) });
    await page.locator('#confirm-import').click();
    assert.deepEqual((await state(page)).progress.profile.favorites, ['geo', 'football']);
    await nav(page, 'home');
    await start(page, 'classic');
    assert.equal((await state(page)).session.board.length, 12);
    await context.close();
  });
  await run('corrupted stored survival lives are rejected without crashing', async () => {
    const { page, context } = await fresh();
    await start(page, 'survival');
    // A corrupt save is injected before the application starts, never into live runtime state.
    await page.addInitScript(() => {
      const saved = JSON.parse(localStorage.getItem('seen-khaled-v1'));
      saved.session.players[0].lives = 4;
      localStorage.setItem('seen-khaled-v1', JSON.stringify(saved));
    });
    await context.setOffline(false);
    await page.reload({ waitUntil: 'load' });
    await context.setOffline(true);
    assert.equal((await state(page)).session, null);
    assert.equal((await state(page)).route, 'home');
    assert.equal(await page.locator('.mode-card').count(), 8);
    await context.close();
  });
  await run('expired restored timer resolves exactly once without live interval', async () => {
    const { page, context } = await fresh();
    await start(page, 'quick');
    await page.addInitScript(() => {
      const saved = JSON.parse(localStorage.getItem('seen-khaled-v1'));
      saved.session.current.deadline = Date.now() - 1000;
      saved.session.current.remainingMs = 0;
      saved.session.current.paused = false;
      localStorage.setItem('seen-khaled-v1', JSON.stringify(saved));
    });
    await context.setOffline(false);
    await page.reload({ waitUntil: 'load' });
    await context.setOffline(true);
    assert.equal((await state(page)).session.current.remainingMs, 0);
    await page.locator('[data-action="resume"]').click();
    await page.locator('[data-action="unpause"]').click();
    assert.equal((await state(page)).session.current.outcome, 'timeout');
    assert.equal((await state(page)).session.results.length, 1);
    assert.equal(await page.evaluate(() => timerHandle), null);
    await page.waitForTimeout(500);
    assert.equal((await state(page)).session.results.length, 1);
    await context.close();
  });
  await run('daily completion keeps the start date after local midnight', async () => {
    const { page, context } = await fresh();
    await page.clock.install({ time: new Date('2026-10-20T23:59:58Z') });
    await page.locator('[data-action="daily"]').click();
    const date = (await state(page)).session.date;
    await page.locator('[data-action="pause"]').click();
    await page.clock.fastForward(5000);
    assert.notEqual(await page.evaluate(() => localDate()), date);
    await ready(page);
    await complete(page, 'daily');
    const p = (await state(page)).progress;
    assert.equal(p.daily[date].completed, true);
    assert.equal(Object.keys(p.daily).length, 1);
    await context.close();
  });
  await run('bounded DOM/listeners/heap after repeated navigation and embedded font load', async () => {
    const { page, context } = await fresh();
    // Warm up browser automation and the audio context before measuring retained state.
    for (const route of ['categories', 'profile', 'settings', 'home']) await nav(page, route);
    await page.evaluate(() => document.fonts.ready);
    assert(await page.evaluate(() => document.fonts.check('16px "Noto Sans Arabic"')));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    await cdp.send('HeapProfiler.collectGarbage');
    const before = await cdp.send('Memory.getDOMCounters');
    const heapBefore = (await cdp.send('Performance.getMetrics')).metrics.find(m => m.name === 'JSHeapUsedSize').value;
    for (let i = 0; i < 32; i++) await nav(page, ['categories', 'profile', 'settings', 'home'][i % 4]);
    await cdp.send('HeapProfiler.collectGarbage');
    const after = await cdp.send('Memory.getDOMCounters');
    const heapAfter = (await cdp.send('Performance.getMetrics')).metrics.find(m => m.name === 'JSHeapUsedSize').value;
    measurements.navigation = { cycles: 32, before, after, heapBefore, heapAfter, domContentLoadedMs: await page.evaluate(() => performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd) };
    assert(after.jsEventListeners <= before.jsEventListeners + 4, 'Document listeners grow after navigation');
    assert(after.nodes <= before.nodes + 200, 'DOM nodes grow after navigation');
    assert(heapAfter < heapBefore + 5 * 1024 * 1024, 'Unexpected retained heap growth after navigation');
    await context.close();
  });
  await run('no network requests or uncaught browser errors', async () => {
    assert.deepEqual(network, []);
    assert.deepEqual(errors, []);
  });
  await browser.close();
  const report = { browser: 'Chromium, emulated Android touch; no physical Samsung hardware', testURL: URL, testFilter: process.env.SEEN_TEST_FILTER || null, localFileWorkflow: 'Not executed: managed Chromium policy blocks file://', offlineAfterLoad: true, tests: results, passed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, browserErrors: errors, networkRequests: network, measurements };
  await fs.writeFile('/tmp/seen-browser-report.json', JSON.stringify(report, null, 2));
  console.log(`\n${report.passed} passed, ${report.failed} failed. Report: /tmp/seen-browser-report.json`);
  if (report.failed) process.exitCode = 1;
})().catch(async error => { console.error(error.stack); await browser?.close(); process.exitCode = 1; });
