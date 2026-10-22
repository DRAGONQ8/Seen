# Question editing and verification

The checked-in JSON files are the source of truth. `build.py` normalizes legacy fields, audits the complete bank, and embeds the bank and local media in `index.html`. Existing IDs never change when a correction is made. An active match retains its own question snapshots.

Run `python content_tools.py` for the structural audit, or `python content_tools.py --report content-audit.json` to write the owner report. Run `python -m unittest discover -s tests -p 'test_*.py'` to check security, preservation, editorial eligibility, format rules, and independently enumerated logic proofs. These commands use only the Python standard library. Run `python build.py` after source changes.

`docs/question-schema.json` documents the import shape. The application and Python `validate_pack` additionally check cross-field rules that JSON Schema cannot express: normalized unique question/option text, exact canonical answer, aliases that never conflict with distractors, a complete ordering permutation, Western digits, safe HTTPS URLs without credentials, local media identifiers, date validity, and dangerous JSON keys. The Python pack validator caps input at 5 MB; the browser caps imported files/envelopes at 28.1 MB and question packs at 1200 entries, with bounded individual fields. Validate the complete pack before applying any change. A malformed later question must reject the entire import.

Verification has four explicit states:

| Value | Meaning | Default gameplay |
| --- | --- | --- |
| `source-checked` | An actual reader checked the precise claim in the cited passage, recorded the real date, section, and notes. | Eligible |
| `editorial` | Editorial review, including inherited reviewed content or original logic with a checkable proof. No claim of an independent factual source check. | Eligible |
| `pending` | Unchecked/incomplete evidence or a legacy verification claim lacking its supporting metadata. | Excluded |
| `disputed` | Material uncertainty, conflicting traditions, or unresolved interpretation. | Excluded |

A URL alone never establishes source verification. The 155 source-checked records inherited from V3 retain their historical evidence metadata; this release does not claim that all those sources were independently reread. Historical incomplete source-verification claims are retained in `historicalVerification` and become pending. The known V2 `owner-reviewed` label migrates through the legacy importer to editorial review with its original metadata retained; unsupported explicit statuses are rejected. No old question or media asset is deleted.

V4 adds 24 science questions and 24 Kuwait questions whose exact claims were individually compared with accessible primary institutional pages during this session. The read evidence is recorded in `science-source-evidence.json` and `kuwait-source-evidence.json`. Blocked pages and questionable statements are recorded and were not used. The 24 original logic puzzles remain editorial, with proofs in their explanations and independent enumeration tests. Those puzzles cite this original collection bibliographically and do not invent external sources.

The owner library supports local review, corrections, disabling, imports, and exports. Keep it outside an active match to avoid exposing current answers. This is a local host tool rather than a network-authenticated administration service. Do not distribute a question pack until its claims and full-credit rules have been reviewed. No live automated content generation is used.

Six formats are implemented: text, bundled image, complete ordering, progressive clues, multipart, and logic. Every advanced question includes `instructions` and `judging`. Ordering requires the whole sequence (`correctOrder.join('، ثم ')`); multipart requires all parts. The host always reveals the canonical answer and chooses the same one-tap team/nobody scoring actions. Flags and maps are already bundled image questions; they do not require external APIs. No commercial audio or unlicensed movie/anime material is added.
