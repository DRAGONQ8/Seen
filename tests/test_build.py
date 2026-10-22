"""Build security and content-contract regressions. No third-party dependencies."""
import copy
import json
import sys
import itertools
import math
from fractions import Fraction
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from content_tools import audit, load_bank, normalize_question, safe_json, script_json, validate_pack, public_eligible, default_eligible, category_inventory, release_report, verification_complete, format_errors


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

    def test_multiplayer_distribution_has_no_removed_entry_points(self):
        root = Path(__file__).resolve().parents[1]
        page = (root / 'index.html').read_text()
        for removed in ('function makeSetup(', 'function startGame(', 'function renderPlay(',
                        'function soloStorageNotice(', 'const ACHIEVEMENTS=',
                        'data-action="solo-export"', 'data-mode="solo"',
                        'data-route="play"', 'data-team-action="next-step"'):
            self.assertNotIn(removed, page)

    def test_generated_document_has_no_runtime_urls(self):
        import re
        root = Path(__file__).resolve().parents[1]
        page = (root / 'index.html').read_text()
        self.assertNotRegex(page, r'<(?:script|iframe|img)[^>]+src=["\']https?:')
        self.assertNotRegex(page, r'<link[^>]+(?:stylesheet|preload)[^>]+https?:')
        self.assertIn("connect-src 'none'", page)


    def test_generated_manifest_matches_sources_and_output(self):
        import hashlib
        root = Path(__file__).resolve().parents[1]
        manifest = json.loads((root / 'build-manifest.json').read_text())
        self.assertEqual(manifest['format'], 'seen-standalone-build')
        self.assertEqual(manifest['runtimeDependencies'], [])
        output = (root / manifest['output']).read_bytes()
        self.assertEqual(hashlib.sha256(output).hexdigest(), manifest['sha256'])
        self.assertEqual(len(output), manifest['bytes'])
        for filename, expected in manifest['inputs'].items():
            self.assertEqual(hashlib.sha256((root / filename).read_bytes()).hexdigest(), expected,
                             filename + ' changed without rebuilding index.html')


    def test_owner_library_excludes_unresolved_and_disputed_content(self):
        question = load_bank(Path(__file__).resolve().parents[1])[0]
        for status in ('pending', 'disputed', 'unknown'):
            question['verification']['status'] = status
            self.assertFalse(public_eligible(question))
        question['verification']['status'] = 'editorial'
        self.assertTrue(public_eligible(question))
        question['verification'] = {'status': 'source-checked', 'referenceTitle': 'Title',
                                    'referenceUrl': 'https://example.org/reference',
                                    'section': 'Exact section', 'verifiedAt': '2026-10-20',
                                    'notes': 'Read and checked the exact factual claim.'}
        self.assertTrue(public_eligible(question))
        question['verification'].pop('section')
        self.assertFalse(public_eligible(question))
        question['disabled'] = True
        self.assertFalse(public_eligible(question))

    def test_merged_content_defaults_match_conservative_engine_policy(self):
        root = Path(__file__).resolve().parents[1]
        bank = load_bank(root)
        self.assertEqual(len(bank), 738)
        self.assertEqual(len({q['id'] for q in bank}), 738)
        self.assertEqual(sum(q['category'] == 'space' for q in bank), 18)
        for category in ('science', 'kuwait'):
            self.assertEqual(sum(q['category'] == category and default_eligible(q) for q in bank), 24)
        logic = [q for q in bank if q['category'] == 'logic']
        self.assertEqual(len(logic), 24)
        self.assertTrue(all(public_eligible(q) and not default_eligible(q) for q in logic))
        self.assertFalse(category_inventory(bank)['logic']['quickAvailable'])
        report = release_report(root)
        self.assertEqual(report['defaultEligibleByCategoryAndPoints']['logic'], {'200': 0, '400': 0, '600': 0})
        self.assertEqual(sum(sum(tiers.values()) for tiers in report['defaultEligibleByCategoryAndPoints'].values()),
                         sum(default_eligible(q) for q in bank))
        checked = copy.deepcopy(next(q for q in bank if default_eligible(q)))
        checked['publicEligible'] = False
        self.assertFalse(default_eligible(checked))
        checked['publicEligible'] = True
        checked['verification']['verifiedAt'] = '2999-01-01'
        self.assertFalse(default_eligible(checked))

    def test_reference_url_does_not_create_source_verification(self):
        question = load_bank(Path(__file__).resolve().parents[1])[0]
        question.pop('verification', None)
        normalized = normalize_question(question)
        self.assertEqual(normalized['verification']['status'], 'editorial')
        self.assertNotIn('verifiedAt', normalized['verification'])
        self.assertFalse(verification_complete({'referenceUrl': 'https://example.org'}))
        future = {'referenceTitle': 'Title', 'referenceUrl': 'https://example.org',
                  'section': 'Section', 'notes': 'Read', 'verifiedAt': '2999-01-01'}
        self.assertFalse(verification_complete(future))
        future['verifiedAt'] = '2026-02-30'
        self.assertFalse(verification_complete(future))

    def test_untrusted_packs_validate_before_applying_any_change(self):
        question = copy.deepcopy(load_bank(Path(__file__).resolve().parents[1])[0])
        original = copy.deepcopy(question)
        packed = json.dumps({'version': 4, 'questions': [question]})
        result = validate_pack(packed)
        self.assertEqual(result[0]['id'], question['id'])
        self.assertEqual(question, original)
        with self.assertRaises(ValueError):
            validate_pack(packed, existing_ids=[question['id']])
        self.assertEqual(validate_pack(packed, [question['id']], replace=True)[0]['id'], question['id'])
        attacks = [json.dumps({'version': 4, 'questions': [question, question]}),
                   '{"version":4,"questions":[{"__proto__":{"polluted":true}}]}',
                   json.dumps({'version': 4, 'questions': [None]}),
                   json.dumps({'version': 4, 'questions': [question, {'id': 'broken'}]}),
                   json.dumps({'version': 4, 'questions': []}),
                   json.dumps({'version': 4, 'questions': [{**question, 'verification': {'status': 'unverified'}}]}),
                   json.dumps({'version': 4, 'questions': [{**question, 'verification': {'status': 'source-checked', 'referenceUrl': 'https://example.org'}}]}),
                   'x' * 5_000_001]
        for attack in attacks:
            with self.assertRaises(ValueError):
                validate_pack(attack)
        self.assertEqual(question, original)

    def test_new_categories_balanced_and_publicly_reviewable(self):
        bank = load_bank(Path(__file__).resolve().parents[1])
        for category in ('science', 'kuwait', 'logic'):
            questions = [q for q in bank if q['category'] == category]
            self.assertEqual(len(questions), 24)
            for points in (200, 400, 600):
                self.assertEqual(sum(q['points'] == points and public_eligible(q) for q in questions), 8)

    def test_v4_source_claims_have_local_read_evidence(self):
        root = Path(__file__).resolve().parents[1]
        bank = load_bank(root)
        records = []
        for name in ('science-source-evidence.json', 'kuwait-source-evidence.json'):
            evidence = json.loads((root / 'docs' / name).read_text())
            records.extend(evidence['questions'])
        self.assertEqual(len(records), 48)
        indexed = {record['questionId']: record for record in records}
        for q in bank:
            if q['id'].startswith(('v4-sci-', 'v4-kwt-')):
                self.assertTrue(verification_complete(q['verification']), q['id'])
                self.assertIn(q['id'], indexed)
                record = indexed[q['id']]
                self.assertTrue(record.get('evidenceExcerpt') or record.get('evidence'), q['id'])
                self.assertEqual(record['retrievedAt'], q['verification']['verifiedAt'])

    def test_structured_formats_require_complete_unambiguous_judging(self):
        bank = load_bank(Path(__file__).resolve().parents[1])
        kinds = {'ordering', 'clues', 'multipart', 'logic'}
        self.assertEqual({q['type'] for q in bank if q['type'] in kinds}, kinds)
        for question in bank:
            self.assertEqual(format_errors(question), [], question['id'])
        question = copy.deepcopy(next(q for q in bank if q['type'] == 'ordering'))
        question['correctOrder'][0] = question['correctOrder'][1]
        self.assertTrue(format_errors(question))
        question = copy.deepcopy(next(q for q in bank if q['type'] == 'clues'))
        question['clues'] = ['Only one']
        self.assertTrue(format_errors(question))
        question = copy.deepcopy(next(q for q in bank if q['type'] == 'multipart'))
        question.pop('judging')
        self.assertTrue(format_errors(question))

    def test_logic_proofs_by_independent_enumeration(self):
        bank = {q['id']: q for q in load_bank(Path(__file__).resolve().parents[1])}
        answer = lambda number: bank[f'v4-logic-{number:03d}']['correctAnswer']
        self.assertEqual(sum(p[-1] % 2 == 0 for p in itertools.permutations((1, 2, 3))), int(answer(9)))
        unique = [x for x in 'ABC' if sum((x == 'B', x != 'B', x != 'A')) == 1]
        self.assertEqual(unique, ['A'])
        ages = [n for n in range(10, 100) if n // 10 + n % 10 == 9 and n - (n % 10 * 10 + n // 10) == 27]
        self.assertEqual(ages, [int(answer(17))])
        smallest = next(n for n in range(1, 106) if n % 3 == 2 and n % 5 == 3 and n % 7 == 2)
        self.assertEqual(smallest, int(answer(18)))
        types = [(a, b) for a, b in itertools.product((False, True), repeat=2)
                 if a == (not b) and b == (a == b)]
        self.assertEqual(types, [(True, False)])
        for number in (3, 20):
            q = bank[f'v4-logic-{number:03d}']
            self.assertEqual(q['correctOrder'], sorted(q['items'], key=Fraction))
        successful = sum(a + b == 8 for a, b in itertools.product(range(1, 7), repeat=2))
        self.assertEqual(Fraction(successful, 36), Fraction(answer(22)))
        doors = [False] * 101
        for step in range(1, 101):
            for door in range(step, 101, step):
                doors[door] = not doors[door]
        self.assertEqual(sum(doors), int(answer(23)))
        edges = {'A': {'B': 4, 'C': 2}, 'B': {'A': 4, 'C': 1, 'D': 5},
                 'C': {'A': 2, 'B': 1, 'D': 8}, 'D': {'B': 5, 'C': 8}}
        paths = [('A', *p, 'D') for length in range(3) for p in itertools.permutations(('B', 'C'), length)]
        costs = [sum(edges[a][b] for a, b in zip(path, path[1:])) for path in paths
                 if all(b in edges[a] for a, b in zip(path, path[1:]))]
        self.assertEqual(min(costs), int(answer(24)))

if __name__ == '__main__':
    unittest.main()
