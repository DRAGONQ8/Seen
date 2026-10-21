#!/usr/bin/env python3
"""Optional maintainer packager. Playing index.html needs no build or server.
Run: python build.py. Only Python's standard library is required.
"""
import base64
import json
import re
from pathlib import Path
from content_tools import audit, load_bank, script_json

ROOT = Path(__file__).resolve().parent
bank = load_bank(ROOT)
assert len(bank) >= 400, 'Preserve the original question release.'
report = audit(bank)
if report['errors']:
    raise ValueError('\n'.join(report['errors']))
assert len({q['id'] for q in bank}) == len(bank)
assert len({q['q'] for q in bank}) == len(bank)
font = base64.b64encode((ROOT / 'assets/NotoSansArabic-Regular.ttf').read_bytes()).decode()
license_text = (ROOT / 'assets/OFL.txt').read_text()
css = "@font-face{font-family:SeenArabic;font-style:normal;font-weight:400;font-display:swap;src:url(data:font/ttf;base64," + font + ") format('truetype')}\n"
css += (ROOT / 'ui.css').read_text() + '\n' + (ROOT / 'team-ui.css').read_text()
css += '\n:root{--font:SeenArabic,"Noto Sans Arabic",Tahoma,sans-serif}\n'
script = ('const QUESTION_BANK=' + script_json(bank) + ';\n'
          + 'const FONT_LICENSE=' + script_json(license_text) + ';\n'
          + (ROOT / 'graphics.js').read_text() + '\n' + (ROOT / 'media-v2.js').read_text() + '\n' + (ROOT / 'team-engine.js').read_text() + '\n' + (ROOT / 'app.js').read_text() + '\n' + (ROOT / 'team-ui.js').read_text())
# Prevent a future content edit from escaping its inline script context.
script = re.sub(r'</script', lambda m: '<\\/' + m.group()[2:], script, flags=re.IGNORECASE)
script = script.replace('<!--', '<\\!--')
page = f'''<!doctype html>
<html lang="ar" dir="rtl" data-theme="dark" data-motion="subtle">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#090d1e">
<meta name="description" content="سين جيم خالد: مسابقة عربية للفريقين تعمل دون إنترنت، مع تحكيم سريع ولوحة كلاسيكية أو مختصرة وأسئلة موثقة للمراجعة.">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; img-src data:; media-src blob:; connect-src 'none'; base-uri 'none'; form-action 'none'">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='%23eac57e'/%3E%3Ctext x='32' y='44' text-anchor='middle' font-size='40' fill='%23291e12'%3Eس%3C/text%3E%3C/svg%3E">
<title>سين جيم خالد | معرفة تجمعنا</title>
<style>{css}</style>
</head>
<body>
<a href="#main" class="skip-link">انتقل إلى المحتوى</a>
<div class="app-shell">
<header class="topbar">
<button class="brand" data-action="nav" data-route="home" aria-label="سين جيم خالد، الرئيسية"><b>س</b><div><strong>سين جيم خالد</strong><small>فريقان… ومعرفة تجمعنا</small></div></button>
<div class="nav-actions" id="header-actions"></div>
</header>
<div class="layout"><aside class="sidebar" id="sidebar" aria-label="التنقل الرئيسي"></aside><main id="main" tabindex="-1"></main></div>
<nav class="bottom-nav" id="bottom-nav" aria-label="التنقل السريع"></nav>
</div>
<dialog id="dialog" aria-label="نافذة معلومات وتأكيد"></dialog>
<div id="toast" class="toast" role="status" aria-live="polite"></div>
<div id="announcer" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
<div id="confetti" class="confetti" aria-hidden="true"></div>
<input type="file" id="import-file" accept="application/json,.json" hidden aria-label="اختيار ملف حفظ المباراة">
<noscript><p>تحتاج اللعبة إلى تفعيل جافاسكربت في متصفحك.</p></noscript>
<script>{script}</script>
</body>
</html>'''
output = ROOT / 'index.html'
temporary = ROOT / 'index.html.tmp'
temporary.write_text(page, encoding='utf-8')
temporary.replace(output)
print(f'Built index.html: {len(bank)} questions, {len(page.encode()):,} bytes; all fonts, images and logic embedded.')
