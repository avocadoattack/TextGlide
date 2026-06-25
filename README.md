# PhraseFlow

**Read in phrases, not word by word.**

PhraseFlow adds subtle spacing at the natural phrase boundaries in your EPUBs, so your eyes group words the way fluent readers already do. Then it hands you a file ready for Kindle.

---

## What it does

PhraseFlow unpacks a DRM-free EPUB, walks every XHTML content document, and inserts thin Unicode space characters at major phrase boundaries. It repacks a valid EPUB — preserving all metadata, markup, cover, and structure — that you can send directly to Kindle.

Only text nodes are ever modified. Tags, attributes, scripts, styles, and intra-word characters are never touched. If any content document fails to process, it is left untouched rather than corrupting the file.

---

## The science

PhraseFlow is grounded in decades of reading research on chunking and phrase-based reading.

Visual-Syntactic Text Formatting studies (Walker et al., 2005; Park & Warschauer, 2016) show that segmenting text at clause and phrase boundaries — sized to the eye's natural fixation span of roughly 8 to 30 characters — can improve comprehension and reduce eyestrain. The eye takes in only about 9 to 15 characters per fixation (Legge et al., 1997), and breaks that mirror natural speech prosody aid processing (Hirotani, Frazier & Rayner, 2006).

The evidence is promising but not universal, and what helps varies from reader to reader, which is why the spacing is adjustable. **This is a reading aid, not a medical device.**

### Citations

- Walker, B., Schloss, P., Fletcher, C. R., Vogel, C. A., & Walker, R. C. (2005). Visual-syntactic text formatting: A new method to enhance online reading. *Reading Online*, 8(6).
- Park, Y., & Warschauer, M. (2016). Syntactic enhancement and language learning. *Language Learning & Technology*, 20(3), 116–134.
- Legge, G. E., Ahn, S. J., Klitz, T. S., & Luebker, A. (1997). Psychophysics of reading: XVI. The visual span in normal and low vision. *Vision Research*, 37(14), 1999–2010.
- Hirotani, M., Frazier, L., & Rayner, K. (2006). Punctuation and intonation effects on clause and sentence wrap-up: Evidence from eye movements. *Journal of Memory and Language*, 54(3), 425–443.

---

## Algorithm

### Simple mode

Inserts gaps:
- Before a configurable list of structure words that signal clause/phrase boundaries (English: *and, or, but, so, yet, that, which, when, where, to, of, in, on, for, with, by, from, as…*; Spanish equivalent list for es mode).
- After sentence-terminal punctuation (`.`, `!`, `?`).
- Respects the **Chunk density** slider: at Subtle density, a minimum character count is enforced so gaps are not placed too close together.

### Smart mode

Uses a three-tier system with automatic fallback:

**Tier 1 — Constituency parse (benepar)**
Adds the [Berkeley Neural Parser](https://github.com/nikitakit/self-attentive-parser) as a spaCy pipeline component. Uses true constituency parse trees to break at:
- Major constituent boundaries (between subject NP and predicate VP, before subordinate clauses SBAR, before coordinating conjunctions at clause level).
- Prepositional phrases at clause level (at Medium and Obvious density).
- Noun phrases (at Obvious density only).

Enforces **glued-unit rules** — never breaks:
- Determiner + noun (det → head)
- Infinitival "to" + verb
- Auxiliary + main verb
- Negation + following token
- Preposition + immediately following object

Applies **size guardrails** from VSTF research (Walker et al., 2005):
| Density | Min chars per chunk |
|---------|---------------------|
| Subtle  | 22 chars            |
| Medium  | 12 chars            |
| Obvious |  7 chars            |

**Tier 2 — Dependency parse (spaCy, fallback)**
If benepar is unavailable, uses spaCy dependency labels to identify major boundaries: ROOT, ccomp, xcomp, advcl, relcl, conj, parataxis, and clause-level prepositional phrases. Same min-chars guardrail applies.

**Tier 3 — Simple mode (final fallback)**
If the spaCy model cannot be loaded, falls back to Simple mode. The user is told which mode actually ran via the `X-Fallback-Warning` response header and the mode badge in the live preview.

### Languages

| Language | spaCy model | benepar model |
|----------|-------------|---------------|
| English  | en_core_web_sm | benepar_en3 |
| Spanish  | es_core_news_sm | benepar_es3 (if available) |

Auto-detect uses a lightweight character/word-frequency heuristic.

### Gap characters

| Spacing Width | Unicode | Name |
|---------------|---------|------|
| Subtle | U+2009 | THIN SPACE (~1/5 em) |
| Medium | U+2002 | EN SPACE (~1/2 em) |
| Strong | U+2003 | EM SPACE (1 em) |

**Default is Subtle** — less is more.

---

## Hard rules (never violated)

1. **DRM**: If `META-INF/encryption.xml` contains `<EncryptedData>` entries, the EPUB is refused with a clear message. DRM is never removed, bypassed, or circumvented.
2. **Validity**: If any content document fails to process, it is left untouched. A broken document is better than a corrupted one.
3. **Privacy**: Files are processed in a temporary directory that is always deleted after the request completes. No user books are retained.

---

## Stack

- **Backend**: Flask (Python), ebooklib, BeautifulSoup4/lxml, spaCy, benepar
- **Frontend**: React + Vite, TypeScript, shadcn/ui, Tailwind CSS
- **EPUB processing**: stdlib `zipfile` (no ebooklib write path, for maximum ZIP fidelity)

---

## Running locally

```bash
# Backend
cd artifacts/api-server
pip install flask ebooklib beautifulsoup4 lxml spacy benepar
python -m spacy download en_core_web_sm
python -m spacy download es_core_news_sm
python -c "import benepar; benepar.download('benepar_en3')"
python app.py

# Frontend
pnpm --filter @workspace/epub-injector run dev
```

---

## Contributing

Free and open. Contributions welcome — especially on algorithm quality, edge cases in EPUB structure, additional language support, and evidence from reading research.

This is a reading aid, not a medical device.
