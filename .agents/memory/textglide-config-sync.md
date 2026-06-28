---
name: TextGlide config sync
description: Cross-language config duplication and the label-vs-API-enum split in TextGlide.
---

# Natural Scan constants are duplicated across two files

`artifacts/epub-injector/src/textglide_config.js` (web reading toggle) duplicates a subset
of `artifacts/api-server/textglide_config.py` (Natural Scan constants only — GAP_CHAR,
BALANCED_MIN_CHARS, STRONG_MIN_CHARS, MIN_PHRASE_WORDS, trigger word sets).

**Why:** the website's client-side Natural Scan engine (`naturalScan.ts`) can't import Python,
so the constants are hand-copied. Grammar Parse mode is Python-only (needs spaCy) and is NOT
ported to JS.

**How to apply:** if you change any Natural Scan constant in the Python config, update the JS
file in lockstep, or the website preview will silently diverge from the server output.

# Display labels are decoupled from API enum values

User-facing mode labels are "Natural Scan" and "Grammar Parse". The wire/API values are
`pseudosyntactic` and `syntactic` respectively.

**Why:** labels were renamed for clarity without touching the API contract.

**How to apply:** never change `pseudosyntactic`/`syntactic` when editing labels — they are the
request payload values and the backend `_VALID_MODES` whitelist in `app.py`. Rename only
human-readable strings/comments/docstrings.
