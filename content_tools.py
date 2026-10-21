"""Deterministic content normalization and release audits (standard library only)."""
import copy
import datetime
import json
import re
import unicodedata
from collections import Counter
from pathlib import Path
from urllib.parse import urlsplit

STATUSES = {'source-checked', 'editorial', 'pending', 'disputed'}
POINTS = (200, 400, 600)
DANGEROUS_KEYS = {'__proto__', 'prototype', 'constructor'}


def safe_json(text):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in DANGEROUS_KEYS or key in result:
                raise ValueError('Unsafe or duplicate JSON key: ' + key)
            result[key] = value
        return result
    return json.loads(text, object_pairs_hook=pairs,
                      parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))


def script_json(value):
    """JSON for an HTML script raw-text element, including mixed-case attacks."""
    return (json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
            .encode('utf-8', errors='backslashreplace').decode('utf-8')
            .replace('&', '\\u0026').replace('<', '\\u003c').replace('>', '\\u003e')
            .replace('\u2028', '\\u2028').replace('\u2029', '\\u2029'))


def normalized(value):
    value = unicodedata.normalize('NFKC', str(value)).lower()
    value = re.sub(r'[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]', '', value)
    value = re.sub('[أإآٱ]', 'ا', value)
    return ' '.join(''.join(c if c.isalnum() else ' ' for c in value).split())


def https_url(value):
    try:
        if not isinstance(value, str) or re.search(r'[\s\x00-\x1f\x7f]', value):
            return False
        parsed = urlsplit(value)
        return parsed.scheme == 'https' and bool(parsed.hostname) and not parsed.username and not parsed.password
    except (ValueError, TypeError):
        return False


def verification_complete(v):
    if not isinstance(v, dict):
        return False
    try:
        datetime.date.fromisoformat(v.get('verifiedAt', ''))
    except (TypeError, ValueError):
        return False
    def meaningful(key):
        return isinstance(v.get(key), str) and bool(v[key].strip())
    return (all(meaningful(key) for key in ('referenceTitle', 'section', 'notes'))
            and (https_url(v.get('referenceUrl')) or meaningful('bibliography')))


def default_eligible(q):
    """Release selection policy; structural validity alone never proves a fact.

    This mirrors the standard engine's conservative spoiler policy. A checked
    status is historical evidence, not a claim of a new independent recheck.
    """
    verification = q.get('verification', {})
    if (verification.get('status') != 'source-checked'
            or not verification_complete(verification)
            or q.get('disabled') or q.get('unavailable') or q.get('available') is False):
        return False
    if q.get('category') == 'anime':
        return q.get('spoilerLevel', 2 if q.get('spoiler') else 1) <= 1
    return not q.get('spoiler')


def category_inventory(bank):
    """Advertise availability only when every exact point tier can be filled."""
    result = {}
    for category in sorted({q['category'] for q in bank}):
        counts = {str(value): sum(q['category'] == category and q['points'] == value
                                  and default_eligible(q) for q in bank)
                  for value in POINTS}
        result[category] = {'eligibleByPoints': counts,
                            'quickAvailable': min(counts.values()) >= 1,
                            'classicAvailable': min(counts.values()) >= 2,
                            'classicShortages': [value for value, count in counts.items() if count < 2]}
    return result


def normalize_question(original):
    q = copy.deepcopy(original)
    q.setdefault('points', 200 if q['level'] == 1 else 400 if q['level'] == 2 else 600)
    q.setdefault('correctAnswer', q['options'][q['answer']])
    q.setdefault('acceptedAnswers', [])
    q.setdefault('type', 'image' if q.get('image') else 'text')
    q.setdefault('difficulty', {200: 'easy', 400: 'medium', 600: 'hard'}[q['points']])
    v = q.get('verification')
    if not v:
        q['verification'] = {'status': 'editorial', 'notes': 'محتوى الإصدار السابق؛ لم يُعَد فحص مصدره في هذا الإصدار.'}
    elif v.get('status') not in STATUSES or (v.get('status') == 'source-checked' and not verification_complete(v)):
        q.setdefault('historicalVerification', copy.deepcopy(v))
        q['verification'] = {'status': 'pending', 'notes': 'حُفظ ادعاء التحقق السابق في السجل التاريخي؛ يلزم فحص مستقل بالإحالة والتاريخ قبل اعتماده.'}
    return q


def load_bank(root):
    return [normalize_question(q) for path in sorted((Path(root) / 'content').glob('*.json'))
            for q in safe_json(path.read_text(encoding='utf-8'))]


def audit(bank):
    errors, warnings = [], []
    ids, texts = set(), {}
    for q in bank:
        qid = q.get('id', '?')
        def fail(message):
            errors.append(f'{qid}: {message}')
        if not isinstance(qid, str) or not qid or qid in ids or qid in DANGEROUS_KEYS:
            fail('missing or duplicate ID')
        ids.add(qid)
        text = normalized(q.get('q', ''))
        if not text or text in texts:
            fail('empty or normalized duplicate question: ' + texts.get(text, ''))
        texts[text] = qid
        options = q.get('options', [])
        if len(options) != 4 or len({normalized(x) for x in options}) != 4 or any(not normalized(x) for x in options):
            fail('four distinct, nonempty options required')
        answer = q.get('answer')
        if type(answer) is not int or not 0 <= answer < len(options):
            fail('invalid answer index')
        elif q.get('correctAnswer') != options[answer]:
            fail('canonical answer differs from answer index')
        else:
            wrong = {normalized(x) for i, x in enumerate(options) if i != answer}
            if any(normalized(a) in wrong for a in q.get('acceptedAnswers', [])):
                fail('accepted answer conflicts with distractor')
        if q.get('points') not in POINTS or q.get('level') not in (1, 2, 3, 4):
            fail('invalid points or difficulty')
        if not q.get('category') or not q.get('sub') or not q.get('explanation') or not isinstance(q.get('tags'), list):
            fail('missing category/subcategory/explanation/tags')
        source = q.get('source', {})
        if (not source.get('title') or not source.get('reference')
                or (source.get('url') and not https_url(source['url']))
                or (not source.get('url') and not source.get('bibliography'))):
            fail('source needs a title, precise reference and safe HTTPS URL or bibliography')
        v = q.get('verification', {})
        if v.get('status') not in STATUSES:
            fail('unsupported verification status')
        if v.get('status') == 'source-checked' and not verification_complete(v):
            fail('source-checked evidence incomplete')
        if re.search('[٠-٩۰-۹]', q.get('q', '') + ''.join(options) + q.get('explanation', '')):
            fail('non-Western digits in visible content')
        if qid.startswith('v3-'):
            for key in ('acceptedAnswers', 'difficulty', 'points', 'verification'):
                if key not in q:
                    fail('missing ' + key)
            if q.get('category') == 'anime' and (not q.get('franchiseId') or q.get('spoilerLevel') not in (1, 2, 3)):
                fail('anime franchise and spoiler level required')
    # Similarity only flags review candidates; never removes or rewrites questions.
    items = [(q['id'], q['category'], set(normalized(q['q']).split())) for q in bank]
    for i, (aid, category, a) in enumerate(items):
        for bid, bcat, b in items[i + 1:]:
            if category == bcat and min(len(a), len(b)) >= 5 and len(a & b) / len(a | b) >= .78:
                warnings.append({'type': 'possible-semantic-duplicate', 'questions': [aid, bid]})
    return {'questions': len(bank), 'images': sum(bool(q.get('image')) for q in bank),
            'categories': dict(sorted(Counter(q['category'] for q in bank).items())),
            'points': dict(sorted(Counter(q['points'] for q in bank).items())),
            'verification': dict(sorted(Counter(q['verification']['status'] for q in bank).items())),
            'defaultEligibleQuestions': sum(default_eligible(q) for q in bank),
            'defaultInventory': category_inventory(bank),
            'errors': errors, 'reviewCandidates': warnings}


if __name__ == '__main__':
    report = audit(load_bank(Path(__file__).resolve().parent))
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(bool(report['errors']))
