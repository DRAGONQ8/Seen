"""Build security and content-contract regressions. No third-party dependencies."""
import copy
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from content_tools import audit, load_bank, normalize_question, safe_json, script_json


class BuildTests(unittest.TestCase):
    def test_inline_script_hostile_text_roundtrip(self):
        hostile = ['</sCrIpT><script>globalThis.pwned=true</script>', '<!--', '-->',
                   '"\\\n\u2028\u2029', 'سؤال عربي؟ <IMG SRC=x onerror=alert(1)>', '\U0001f3ae', '\ud800', '\udfff']
        encoded = script_json(hostile)
        self.assertFalse(any(c in encoded for c in '<>&\u2028\u2029'))
        self.assertEqual(json.loads(encoded), hostile)
        encoded.encode('utf-8')

    def test_dangerous_and_duplicate_json_keys(self):
        for key in ('__proto__', 'constructor', 'prototype'):
            with self.assertRaises(ValueError):
                safe_json('{"nested":{"' + key + '": {"polluted": true}}}')
        with self.assertRaises(ValueError):
            safe_json('{"id":1,"id":2}')
        for number in ('NaN', 'Infinity', '-Infinity'):
            with self.assertRaises(ValueError):
                safe_json(number)

    def test_old_verification_claim_preserved_without_recertification(self):
        q = load_bank(Path(__file__).resolve().parents[1])[0]
        q.pop('historicalVerification', None)
        q['verification'] = {'status': 'source-checked', 'reference': 'historical claim'}
        old = copy.deepcopy(q)
        migrated = normalize_question(q)
        self.assertEqual(q, old)
        self.assertEqual(migrated['verification']['status'], 'pending')
        self.assertEqual(migrated['historicalVerification']['reference'], 'historical claim')

    def test_validated_bank_and_unique_ids(self):
        report = audit(load_bank(Path(__file__).resolve().parents[1]))
        self.assertGreaterEqual(report['questions'], 648)
        self.assertEqual(report['errors'], [])

    def test_existing_release_question_ids_are_preserved(self):
        root = Path(__file__).resolve().parents[1]
        baseline = json.loads((root / 'tests/fixtures/question-ids-v3.json').read_text())
        current = {q['id'] for q in load_bank(root)}
        self.assertEqual(len(baseline['ids']), 648)
        self.assertFalse(set(baseline['ids']) - current, 'Existing progress depends on stable question IDs.')

    def test_source_checked_requires_supporting_evidence_metadata(self):
        q = load_bank(Path(__file__).resolve().parents[1])[0]
        q['verification'] = {'status': 'source-checked', 'referenceTitle': 'Title',
                             'referenceUrl': 'https://example.org/reference', 'section': 'Section 1',
                             'verifiedAt': '2026-10-20', 'notes': 'Claim checked in the cited section.'}
        self.assertEqual(audit([q])['errors'], [])
        printed = copy.deepcopy(q)
        printed['source'].pop('url', None)
        printed['source']['bibliography'] = 'مرجع مطبوع، طبعة محددة، الجزء 1، الصفحة 20'
        self.assertEqual(audit([printed])['errors'], [])
        for bad in ('javascript:alert(1)', 'data:text/html,x', 'https://[', 'http://example.org',
                    'https://user:pass@example.org/', 'https://example.org/\nattack', 'https://example.org/a b'):
            altered = copy.deepcopy(q)
            altered['source']['url'] = bad
            self.assertTrue(audit([altered])['errors'])


if __name__ == '__main__':
    unittest.main()
