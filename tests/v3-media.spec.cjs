/* V3 media provenance, byte integrity, answer concealment and offline SVG decoding.
   node tests/v3-media.spec.cjs [--browser]
   Browser tooling is development-only; the released HTML needs no dependencies. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/media/v3-credits.json'), 'utf8'));
const context = {};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'graphics.js'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'media-v2.js'), 'utf8') + '\nglobalThis.visuals=VISUALS;globalThis.src=imageSrc;', context);
const visuals = context.visuals;
const bank = fs.readdirSync(path.join(ROOT, 'content')).filter(f => f.endsWith('.json')).flatMap(f => JSON.parse(fs.readFileSync(path.join(ROOT, 'content', f), 'utf8')));
const normalize = s => String(s).normalize('NFKC').replace(/[\u064b-\u065f\u0670\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS', name); } catch (e) { failed++; console.error('FAIL', name, e.message); } }

test('24 new meaningful diagrams retain the approved category distribution', () => {
  assert.equal(manifest.items.length, 24);
  assert.equal(new Set(manifest.items.map(m => m.key)).size, 24);
  const counts = manifest.items.reduce((c, m) => (c[m.category] = (c[m.category] || 0) + 1, c), {});
  assert.deepEqual(counts, { anime: 8, football: 6, islamic: 4, games: 4, geo: 2 });
});
test('every visual retains its offline source bytes and SHA-256 provenance', () => {
  for (const item of manifest.items) {
    const bytes = fs.readFileSync(path.join(ROOT, 'assets/media', item.file));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), item.sha256, item.key);
    assert.equal(visuals[item.key].svg, bytes.toString('utf8'), item.key);
    assert.equal(visuals[item.key].width, 720, item.key);
    assert.equal(visuals[item.key].height, 432, item.key);
    assert(bytes.length < 16000, item.key + ' unexpectedly large');
    assert(context.src(item.key).startsWith('data:image/svg+xml;charset=utf-8,'), item.key);
  }
});
test('all original SVGs have explicit license, authorship and stable source paths', () => {
  for (const m of manifest.items) {
    assert.equal(m.license, 'CC0-1.0', m.key);
    assert.equal(m.licenseUrl, 'https://creativecommons.org/publicdomain/zero/1.0/', m.key);
    assert.equal(m.source, 'https://github.com/DRAGONQ8/Seen/blob/main/assets/media/' + m.file, m.key);
    assert(m.creator && m.modifications && m.notes && m.alt && m.credit, m.key);
    assert(/[\u0600-\u06ff]/.test(m.alt), m.key);
    assert.equal(visuals[m.key].alt, m.alt, m.key);
    assert.equal(visuals[m.key].source, m.source, m.key);
  }
});
test('SVGs contain no executable content, network references or hidden answer metadata', () => {
  for (const m of manifest.items) {
    const svg = visuals[m.key].svg;
    assert(!/<(?:script|foreignObject|iframe|image|style|title|desc)\b/i.test(svg), m.key);
    assert(!/\bon\w+\s*=|(?:href|src)\s*=|url\s*\(|<!DOCTYPE|<!ENTITY|<!--/i.test(svg), m.key);
    assert(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u202a-\u202e\u2066-\u2069]/u.test(svg), m.key);
    assert(!/[٠-٩۰-۹]/.test(svg), m.key);
    assert(/viewBox="0 0 720 432" width="720" height="432"/.test(svg), m.key);
    assert(!/nan|infinity|undefined/i.test(svg), m.key);
  }
});
test('each diagram belongs to a unique question in its intended category', () => {
  for (const item of manifest.items) {
    const questions = bank.filter(q => q.image === item.key);
    assert.equal(questions.length, 1, item.key + ' needs exactly one question');
    const q = questions[0];
    assert.equal(q.category, item.category, q.id);
    assert.equal(q.imageLicense, item.license, q.id);
    assert(q.imageAttribution, q.id);
    const answer = normalize(q.correctAnswer || q.options[q.answer]);
    assert(answer && !normalize(item.alt).includes(answer), q.id + ' answer leaked in alt');
    assert(!normalize(item.file).includes(answer), q.id + ' answer leaked in filename');
    assert(!/صورة رسمية|لقطة من|صورة فوتوغرافية/.test(item.alt), q.id + ' misleading visual claim');
  }
});

async function browserTest() {
  if (!process.argv.includes('--browser')) return;
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || process.env.SEEN_CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 915 } });
    await page.context().setOffline(true);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.setContent('<html lang="ar" dir="rtl"><meta charset="utf-8"><style>body{margin:0;background:#10182e}img{display:block;width:100%;height:auto;max-width:720px}</style>' + manifest.items.map(m => '<img width="720" height="432" alt="' + m.alt.replaceAll('"', '&quot;') + '" src="' + context.src(m.key) + '">').join('') + '</html>');
    await page.waitForFunction(() => [...document.images].every(i => i.complete));
    const images = await page.locator('img').evaluateAll(a => a.map(i => ({ ok: i.complete && i.naturalWidth === 720 && i.naturalHeight === 432, w: i.getBoundingClientRect().width, h: i.getBoundingClientRect().height })));
    assert.equal(images.filter(i => i.ok).length, 24);
    assert(images.every(i => i.w === 320 && i.h === 192), 'mobile image proportions');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320);
    assert.deepEqual(errors, []);
    passed++; console.log('PASS all 24 SVGs decode offline and retain proportions at 320 pixels');
  } catch (e) { failed++; console.error('FAIL offline SVG decoding:', e.stack); }
  finally { await browser.close(); }
}
browserTest().finally(() => { console.log(JSON.stringify({ passed, failed, skipped: 0, newImages: manifest.items.length })); if (failed) process.exitCode = 1; });
