/* Actual two-team Chromium accessibility checks. Test tooling only.
   Start a local static server on 127.0.0.1:8765, then run:
   SEEN_AXE_PATH=/absolute/path/to/axe.min.js node tests/team-accessibility.spec.cjs
   Runtime index.html remains dependency-free. Managed Chromium blocks file://;
   these checks use localhost, then disable network after the initial load.
   Automated contrast checks can be incomplete over gradients and illustrations. */
'use strict';
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const URL = process.env.SEEN_TEST_URL || 'http://127.0.0.1:8765/index.html';
const AXE_PATH = process.env.SEEN_AXE_PATH;
const audits = [], checks = [], errors = [], outbound = [];
let browser;
async function check(name, run) {
  try { await run(); checks.push({ name, ok: true }); console.log('PASS', name); }
  catch (error) { checks.push({ name, ok: false, error: String(error) }); console.log('FAIL', name, String(error).slice(0, 1200)); }
}
async function audit(page, screen, width, theme) {
  const data = await page.evaluate(() => {
    const visible = e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && !e.matches('.skip-link');
    const targets = [...document.querySelectorAll('button:not(:disabled),a[href],input:not([type="hidden"]):not([type="file"]),select,textarea,summary')].filter(visible).map(e => {
      const target = e.matches('input[type="checkbox"],input[type="radio"]') ? e.closest('label') || e : e;
      const r = target.getBoundingClientRect();
      return { label: (e.getAttribute('aria-label') || e.textContent || e.labels?.[0]?.textContent || e.id).trim().slice(0, 100), width: Math.round(r.width * 100) / 100, height: Math.round(r.height * 100) / 100 };
    });
    return {
      viewport: innerWidth, scroll: document.documentElement.scrollWidth,
      emptyButtons: [...document.querySelectorAll('button')].filter(visible).filter(e => !(e.getAttribute('aria-label') || e.textContent).trim()).map(e => e.outerHTML),
      tinyTargets: targets.filter(t => t.width < 43.5 || t.height < 43.5),
      heading: [...document.querySelectorAll('h1,h2,h3,h4')].filter(visible).map(e => ({ level: e.tagName, text: e.textContent.trim() })),
      bottomNavigation: getComputedStyle(document.querySelector('.bottom-nav')).display,
      focus: { tag: document.activeElement.tagName, id: document.activeElement.id },
      easternDigits: /[٠-٩۰-۹]/.test(document.body.innerText)
    };
  });
  let axe = { violations: [], incomplete: [] };
  if (AXE_PATH) axe = await page.evaluate(async () => {
    const out = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice'] } });
    const compact = v => ({ id: v.id, impact: v.impact, description: v.description, nodes: v.nodes.map(n => ({ target: n.target, html: n.html.slice(0, 450), summary: n.failureSummary })) });
    return { violations: out.violations.map(compact), incomplete: out.incomplete.map(compact) };
  });
  audits.push({ screen, width, theme, ...data, ...axe });
  await fs.writeFile('/tmp/seen-team-accessibility-partial.json', JSON.stringify({ checks, audits, errors }, null, 2));
  assert(data.scroll <= data.viewport + 1, `horizontal overflow ${data.scroll} > ${data.viewport}`);
  assert.deepEqual(data.emptyButtons, [], 'unlabelled buttons');
  assert.deepEqual(data.tinyTargets, [], 'touch targets below 44px');
  assert.equal(data.easternDigits, false, 'non-Western interface digits');
  if (screen.startsWith('match-')) assert.equal(data.bottomNavigation, 'none', 'bottom navigation must not overlap match controls');
}
async function renderAudit(page, screen, width, theme) {
  await check(`${screen} / ${width} / ${theme}`, () => audit(page, screen, width, theme));
}
(async () => {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  for (const width of [320, 1470]) for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ viewport: { width, height: width === 320 ? 780 : 956 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push({ width, theme, error: String(e) }));
    page.on('request', r => { if (/^https?:/.test(r.url()) && !r.url().startsWith(new globalThis.URL(URL).origin)) outbound.push(r.url()); });
    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForFunction(() => window.SeenTeamUI?.ready());
    await page.evaluate(theme => { prefs.theme = theme; prefs.textSize = 130; prefs.sound = 0; prefs.music = 0; prefs.reduced = true; applyPrefs(); persist(); render(); }, theme);
    await context.setOffline(true);
    if (AXE_PATH) await page.addScriptTag({ path: AXE_PATH });
    await renderAudit(page, 'home', width, theme);
    await page.locator('[data-team-action="new"]').first().click();
    for (let step = 0; step < 9; step++) {
      await page.locator(`[data-team-action="step"][data-step="${step}"]`).click();
      await renderAudit(page, `wizard-${step + 1}`, width, theme);
    }
    await check(`wizard select retains keyboard focus / ${width} / ${theme}`, async () => {
      await page.locator('[data-team-action="step"][data-step="5"]').click();
      const select = page.locator('#tc-transition');
      await page.keyboard.press('Tab'); await select.focus();
      await select.selectOption('host');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'tc-transition');
      await select.selectOption('auto');
    });
    await check(`wizard keyboard step keeps navigation context / ${width} / ${theme}`, async () => {
      const step = page.locator('[data-team-action="step"][data-step="3"]');
      await page.keyboard.press('Tab'); await step.focus(); await page.keyboard.press('Enter');
      assert.equal(await page.locator('[aria-current="step"]').getAttribute('data-step'), '3');
      const focused = await page.evaluate(() => ({ tag: document.activeElement.tagName, inside: !!document.activeElement.closest('#main'), id: document.activeElement.id }));
      assert(focused.inside, `keyboard context lost to ${focused.tag}#${focused.id}`);
    });
    await page.evaluate(() => { SeenTeamUI.draft.timer = false; });
    await page.locator('[data-team-action="step"][data-step="8"]').click();
    await page.locator('[data-team-action="start-match"]').click();
    await renderAudit(page, 'match-compact', width, theme);
    await page.locator('[data-team-action="tile"]').first().click();
    await renderAudit(page, 'match-preview', width, theme);
    await page.locator('[data-team-action="engine"][data-type="START_QUESTION"]').click();
    await renderAudit(page, 'match-question', width, theme);
    await check(`question hidden answer and screenreader focus / ${width} / ${theme}`, async () => {
      assert.equal(await page.locator('.canonical-answer').count(), 0);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'team-question-heading');
      assert.equal(await page.locator('.match-question-panel .answers-grid').count(), 0, 'oral mode must not render options');
    });
    await page.locator('[data-team-action="incorrect"]').click();
    await renderAudit(page, 'match-steal', width, theme);
    await check(`steal screen keeps solution hidden / ${width} / ${theme}`, async () => {
      assert.equal(await page.locator('.canonical-answer').count(), 0);
      assert.equal(await page.locator('.steal-banner').count(), 1);
    });
    await page.locator('[data-team-action="reveal"]').click();
    await renderAudit(page, 'match-reveal', width, theme);
    await check(`reveal focuses canonical answer / ${width} / ${theme}`, async () => assert.equal(await page.evaluate(() => document.activeElement.classList.contains('canonical-answer')), true));
    await page.locator('[data-team-action="award"][data-team="1"]').click();
    await renderAudit(page, 'adjudication-dialog', width, theme);
    await check(`dialog keyboard stays in modal / ${width} / ${theme}`, async () => {
      // Native Chromium may report BODY while focus visits browser chrome;
      // it must never land on a background page control outside the modal.
      for (let i = 0; i < 8; i++) { await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement === document.body || !!document.activeElement.closest('dialog')), true, 'Tab reached a background page control'); }
    });
    await page.locator('#confirm-team-award').click();
    await renderAudit(page, 'match-receipt', width, theme);
    await page.locator('[data-team-action="engine"][data-type="NEXT_TURN"]').click();
    // The core engine has a separate exhaustive suite. Complete its remaining
    // already-validated transitions here to expose the real result/history UI.
    await page.evaluate(() => {
      let s = SeenTeamUI.match;
      for (const tile of s.board.filter(t => !t.done)) {
        for (const action of [{ type: 'SELECT_TILE', tileId: tile.id }, { type: 'START_QUESTION' }, { type: 'REVEAL' }, { type: 'ADJUDICATE', teamId: 0 }]) s = TeamEngine.dispatch(s, action, QUESTION_BANK, Date.now());
        if (!s.board.every(t => t.done)) s = TeamEngine.dispatch(s, { type: 'NEXT_TURN' }, QUESTION_BANK, Date.now());
      }
      SeenTeamUI.store.match = s; SeenTeamUI.dispatch({ type: 'NEXT_TURN' });
    });
    await renderAudit(page, 'match-results', width, theme);
    await page.evaluate(() => SeenTeamUI.go('teamHistory'));
    await renderAudit(page, 'history', width, theme);
    await page.evaluate(() => SeenTeamUI.go('library'));
    await renderAudit(page, 'library', width, theme);
    await check(`every visual clue has an Arabic non-answer alt / ${width} / ${theme}`, async () => {
      const bad = await page.evaluate(() => QUESTION_BANK.filter(q => q.image && (!VISUALS[q.image]?.alt?.trim() || !/[\u0600-\u06ff]/.test(VISUALS[q.image].alt) || VISUALS[q.image].alt.includes(q.correctAnswer || q.options[q.answer]))).map(q => q.id));
      assert.deepEqual(bad, []);
    });
    await page.evaluate(() => { SeenTeamUI.startSetup(); SeenTeamUI.draft.board = 'classic'; SeenTeamUI.draft.timer = false; });
    await page.locator('[data-team-action="step"][data-step="8"]').click();
    await page.locator('[data-team-action="start-match"]').click();
    await renderAudit(page, 'match-classic', width, theme);
    await page.screenshot({ path: `/tmp/seen-team-axe-${width}-${theme}.png`, fullPage: true });
    await context.close();
  }
  if (AXE_PATH) await check('axe WCAG A/AA and best-practice findings', async () => assert.deepEqual(audits.flatMap(a => a.violations.map(v => ({ screen: a.screen, width: a.width, theme: a.theme, ...v }))), []));
  else checks.push({ name: 'axe-core WCAG checks', skipped: true, reason: 'Set SEEN_AXE_PATH to an installed local axe.min.js file.' });
  await check('no uncaught browser errors', async () => assert.deepEqual(errors, []));
  await check('no outbound network dependencies', async () => assert.deepEqual(outbound, []));
  const report = { url: URL, browser: 'Chromium touch emulation; not physical Samsung hardware', localFile: 'Not executed: managed browser file:// restriction', axeEnabled: !!AXE_PATH, checks, audits, errors, outbound, contrastIncomplete: audits.flatMap(a => a.incomplete.filter(v => v.id === 'color-contrast').map(v => ({ screen: a.screen, width: a.width, theme: a.theme, ...v }))) };
  await fs.writeFile('/tmp/seen-team-accessibility-report.json', JSON.stringify(report, null, 2));
  await browser.close();
  console.log(JSON.stringify({ passed: checks.filter(c => c.ok).length, failed: checks.filter(c => c.ok === false).length, skipped: checks.filter(c => c.skipped).length, report: '/tmp/seen-team-accessibility-report.json' }));
  if (checks.some(c => c.ok === false)) process.exitCode = 1;
})().catch(async error => { console.error(error); await browser?.close(); process.exitCode = 1; });
