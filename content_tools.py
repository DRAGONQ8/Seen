"""Deterministic content normalization and release audits (standard library only)."""
import argparse
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
TYPES = {'text', 'image', 'ordering', 'clues', 'multipart', 'logic'}
MAX_PACK_BYTES = 5_000_000
STATUS_LABELS = {'source-checked': 'مدقق بالمصدر', 'editorial': 'مراجعة تحريرية', 'pending': 'بانتظار التحقق', 'disputed': 'محل خلاف'}
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
    try:
        checked = datetime.date.fromisoformat(v.get('verifiedAt', ''))
        if checked > datetime.date.today():
            return False
    except (TypeError, ValueError):
        return False
    return (bool(v.get('referenceTitle') and v.get('section') and v.get('notes'))
            and all(isinstance(v.get(k), str) and v[k].strip() for k in ('referenceTitle', 'section', 'notes'))
            and (https_url(v.get('referenceUrl')) or isinstance(v.get('bibliography'), str) and bool(v['bibliography'].strip())))


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
        if not isinstance(qid, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,70}', qid) or qid in ids or qid in DANGEROUS_KEYS:
            fail('missing or duplicate ID')
        ids.add(qid)
        text = normalized(q.get('q', ''))
        if not text or text in texts:
            fail('empty or normalized duplicate question: ' + texts.get(text, ''))
        texts[text] = qid
        for key, maximum in (('q', 900), ('sub', 100), ('explanation', 1600)):
            if not isinstance(q.get(key), str) or not q[key].strip() or len(q[key]) > maximum:
                fail('missing or excessive text: ' + key)
        if not isinstance(q.get('category'), str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', q['category']):
            fail('unsafe category identifier')
        options = q.get('options', [])
        if not isinstance(options, list) or len(options) != 4 or len({normalized(x) for x in options}) != 4 or any(not isinstance(x,str) or not normalized(x) or len(x)>180 for x in options):
            fail('four distinct, nonempty options required')
        aliases = q.get('acceptedAnswers')
        if not isinstance(aliases,list) or len(aliases)>12 or any(not isinstance(a,str) or not a.strip() or len(a)>180 for a in aliases):
            fail('accepted aliases must be 0 to 12 short nonempty strings')
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
        if q.get('type', 'text') not in TYPES:
            fail('unsupported content type')
        for message in format_errors(q):
            fail(message)
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
        if re.search('[٠-٩۰-۹]', q.get('q', '') + ''.join(options) + q.get('explanation', '') + q.get('instructions','') + q.get('judging','') + ''.join(q.get('items',[])) + ''.join(q.get('clues',[])) + ''.join(q.get('parts',[]))):
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
            'types': dict(sorted(Counter(q.get('type', 'text') for q in bank).items())),
            'publicEligible': sum(public_eligible(q) for q in bank),
            'excludedQuestions': [{'id': q['id'], 'status': q['verification']['status'],
                                   'reason': q['verification'].get('notes', '')} for q in bank if not public_eligible(q)],
            'errors': errors, 'reviewCandidates': warnings}


def public_eligible(q):
    """Editorial status is explicit; a source URL never establishes verification."""
    return (not q.get('disabled') and q.get('publicEligible') is not False
            and (q.get('verification', {}).get('status') == 'editorial'
                 or q.get('verification', {}).get('status') == 'source-checked'
                 and verification_complete(q['verification'])))


def format_errors(q):
    errors = []
    kind = q.get('type', 'text')
    def strings(key, low, high):
        value = q.get(key)
        return (isinstance(value, list) and low <= len(value) <= high
                and all(isinstance(x, str) and x.strip() and len(x) <= 500 for x in value))
    if kind in ('ordering', 'clues', 'multipart', 'logic', 'proverb'):
        if not isinstance(q.get('instructions'), str) or not q['instructions'].strip():
            errors.append('format needs clear instructions')
        if not isinstance(q.get('judging'), str) or not q['judging'].strip():
            errors.append('format needs explicit full-credit judging')
    if kind == 'ordering':
        if not strings('items', 3, 6) or not strings('correctOrder', 3, 6):
            errors.append('ordering needs 3 to 6 items and complete answer order')
        elif (len(set(q['items'])) != len(q['items']) or len(q['items']) != len(q['correctOrder'])
              or set(q['items']) != set(q['correctOrder'])):
            errors.append('correct order must be a unique permutation of items')
        elif q.get('correctAnswer') != '، ثم '.join(q['correctOrder']):
            errors.append('ordering canonical answer must state the complete order')
    if kind == 'clues' and not strings('clues', 2, 5):
        errors.append('progressive clues need 2 to 5 clear clues')
    if kind == 'multipart' and not strings('parts', 2, 5):
        errors.append('multi-part question needs 2 to 5 explicit parts')
    if kind in ('image', 'flag', 'map', 'silhouette', 'crop', 'comparison') and not q.get('image'):
        errors.append('visual format requires a bundled image reference')
    if q.get('image') and (not isinstance(q['image'], str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,120}', q['image'])):
        errors.append('image must reference a bundled asset identifier')
    return errors


def validate_pack(text, existing_ids=(), replace=False):
    """Untrusted owner packs are validated as a whole before callers apply them."""
    if not isinstance(text, str) or len(text.encode('utf-8')) > MAX_PACK_BYTES:
        raise ValueError('Question pack exceeds the 5 MB limit.')
    pack = safe_json(text)
    questions = pack.get('questions') if isinstance(pack, dict) and pack.get('version') in (2, 3, 4) else None
    if not isinstance(questions, list) or not 1 <= len(questions) <= 1200:
        raise ValueError('A question pack requires 1 to 1200 questions and a supported version.')
    normalized_questions = []
    for item in questions:
        if not isinstance(item, dict):
            raise ValueError('Each question must be an object.')
        verification = item.get('verification')
        if verification is not None and (not isinstance(verification, dict) or verification.get('status') not in STATUSES):
            raise ValueError('Question verification status is unsupported.')
        if verification and verification.get('status') == 'source-checked' and not verification_complete(verification):
            raise ValueError('Source-checked metadata requires an actual valid date and complete claim evidence.')
        try:
            normalized_questions.append(normalize_question(item))
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise ValueError('Question metadata is incomplete.') from exc
    try:
        report = audit(normalized_questions)
    except (KeyError, TypeError, AttributeError) as exc:
        raise ValueError('Question data has an invalid structure.') from exc
    if report['errors']:
        raise ValueError('\n'.join(report['errors']))
    collisions = set(existing_ids) & {q['id'] for q in normalized_questions}
    if collisions and not replace:
        raise ValueError('Existing question IDs require explicit replacement: ' + ', '.join(sorted(collisions)))
    return normalized_questions


def release_report(root):
    root = Path(root)
    bank = load_bank(root)
    report = audit(bank)
    baseline_path = root / 'tests/fixtures/question-ids-v3.json'
    baseline = set(json.loads(baseline_path.read_text())['ids']) if baseline_path.exists() else set()
    current = {q['id'] for q in bank}
    eligible = [q for q in bank if public_eligible(q) and not q.get('spoiler')]
    return {
        'checkedAt': datetime.date.today().isoformat(),
        'scope': 'تدقيق بنيوي آلي كامل. التحقق المصدري الجديد يقتصر على ادعاءات V4 ذات سجل الأدلة المحلي؛ حالات V3 موروثة ولم تعاد مراجعتها كلها.',
        'baselineQuestions': len(baseline), 'questionAudit': report,
        'defaultEligibleByCategoryAndPoints': {c: {str(p): sum(q['category'] == c and q['points'] == p for q in eligible) for p in POINTS} for c in sorted({q['category'] for q in bank})},
        'preservation': {'questionIdsChanged': 0, 'questionsAdded': len(current - baseline), 'questionsRemoved': len(baseline - current), 'missingLegacyIds': sorted(baseline - current)},
        'verificationPolicy': {
            'source-checked': 'تاريخ فعلي وإحالة دقيقة وملاحظات تحقق؛ الرابط وحده لا يكفي. سجل أدلة V4 في docs/*source-evidence.json.',
            'editorial': 'مراجعة تحريرية موروثة، أو لغز أصلي مع برهان قابل لإعادة الحساب؛ لا يعني تحققًا خارجيًا مستقلًا.',
            'pending': 'غير مؤهل افتراضيًا حتى تتم مراجعة الادعاء؛ ادعاء التحقق القديم محفوظ دون إعادة اعتماد.',
            'disputed': 'محفوظ للمالك والمراجعة، ومستبعد من اللعب العام الافتراضي.'},
        'limitations': ['لم تُعَد مراجعة جميع حقائق الإصدارات السابقة فرديًا.', 'الألغاز الأصلية ليست منسوبة إلى مصادر خارجية؛ براهينها في الشروح والاختبارات.', 'لا صوت تجاري أو مولد أسئلة في المباريات.']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', type=Path, help='Write an auditable release report.')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    report = release_report(root) if args.report else audit(load_bank(root))
    rendered = json.dumps(report, ensure_ascii=False, indent=2) + '\n'
    if args.report:
        args.report.write_text(rendered, encoding='utf-8')
    else:
        print(rendered, end='')
    errors = report.get('questionAudit', report)['errors']
    raise SystemExit(bool(errors))
