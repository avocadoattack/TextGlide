# TextGlide

**Read in phrases, not word by word.**

TextGlide is a free, open-source web app that inserts empirically-calibrated spacing at phrase boundaries inside EPUB files, then hands back a Kindle-ready EPUB. The goal is to make the natural groupings of language visible on the page — the way fluent readers' eyes already move, just without the visual cue.

**Live app:** [textglide.replit.app](https://replit.com/@accounts571/EPUB-Phrase-Enhancer)

---

## What it does

Fluent readers don't process text word by word. They take in meaningful phrases per glance — the eye lands, the brain encodes the chunk, the eye moves on. For skilled readers this is automatic; for developing, non-native, or fatigued readers it often isn't, and it's the source of the gap in reading speed and comprehension.

TextGlide takes a DRM-free EPUB, parses every sentence, and inserts a fixed-width thin space (U+2009) at phrase boundaries — **inline**, not as a line-break cascade. The result is a file that reads identically on every e-reader and survives font-size changes and Kindle reflow, because it only edits whitespace. Words, markup, and layout are untouched.

---

## The evidence

TextGlide's algorithm is calibrated directly against the peer-reviewed literature. Ten papers were read in full; the core finding, replicated across roughly two dozen English-language studies (Bever et al. 1992):

- **+12.7% comprehension** (subject-weighted mean across significant studies)
- **+9.9% reading speed** (subject-weighted mean across significant studies)

Roughly half the studies in the full corpus found no significant effect. The gain is real but modest. Individual variation is high. The benefit concentrates in **developing, average, and non-native readers**, and in **harder or less-familiar material**:

| Reader group | Improvement |
|---|---|
| Weak / developing readers | ~+37% (Bever et al. 1992) |
| Average readers | Significant (Jandreau & Bever 1992) |
| Strong / fluent readers | ~+6%, not statistically significant |

**The key mechanistic finding:** the gain comes from *where* the gap lands, not from extra whitespace. Jandreau & Bever (1992) tested a matched control with the same total whitespace spread evenly — it produced zero benefit. This is why TextGlide fixes the gap at one calibrated width rather than exposing it as a slider.

**Gap width:** U+2009 thin space, ~1.8× a normal word space (additive, confirmed by XHTML inspection and visual verification on Kindle Paperwhite 12 / Amazon Ember). This sits at the evidence-calibrated center: Bever et al. (1992) tested two gap magnitudes (1.75× and 2.5×) and found no significant difference between them.

### Source papers

| Paper | Key finding |
|---|---|
| North & Jenkins (1951) | Inline phrase spacing beat line-break and standard formats on speed and comprehension |
| Coleman & Kim (1961) | Inline spacing held speed and raised comprehension; line-break arms were significantly slower |
| Jandreau, Muncer & Bever (1986) | +16% → +20% words read; gap 1.7–2.9× normal space |
| Keenan (1984) | Line-break chunking significantly slower than standard — line-length variability is the mechanism |
| Jandreau & Bever (1992) | Even-spaced control: zero benefit; phrase-spaced: significant for average readers |
| Bever et al. (1992, Visible Language) | Crude heuristic beat full grammar parse (p<.025); gap magnitude had no significant effect |
| Mason & Kendall (1978) | Low-ability readers' comprehension improved; high-ability: no effect |
| Negin (1987) | Segmentation significantly aided comprehension for hearing-impaired readers |
| Lefton, Nagle & Johnson (1979) | Eye-movement evidence: poor readers more fixations, longer durations, more regressions |

---

## How to use it

1. Open the [live app](https://replit.com/@accounts571/EPUB-Phrase-Enhancer)
2. Try the live preview with your own text — no file upload required
3. Upload a DRM-free EPUB
4. Choose your settings (see below)
5. Click **Process Book** and download your file

**For best results:** set your Kindle to left-aligned (ragged-right) text. Justified text stretches normal word spaces unpredictably, which can cancel out the phrase-gap contrast. TextGlide injects a left-alignment instruction into the processed file, which has successfully overridden the Kindle justified setting in testing — but setting it manually (Settings → Reading → Alignment) is the reliable fallback.

---

## Settings

### Processing mode

| Mode | What it does |
|---|---|
| **Natural Scan** *(default)* | A fast, statistical read of phrase onsets from word-pattern cues — no full grammar analysis. Mirrors the rough first-pass the eye already makes. This is the better-supported mode in the evidence: in the only direct comparison, the crude heuristic significantly outperformed the full grammar parse (Bever et al. 1992, p<.025). |
| **Grammar Parse** | A complete grammatical analysis via spaCy's dependency parser. More linguistically precise — but precision is not what the research shows helps reading. Kept for comparison while real-world A/B tests are ongoing. |

### Reading Support

| Setting | What it does |
|---|---|
| **Balanced** *(default)* | Breaks at main phrase boundaries, keeping groups around 2–3 words. Grounded in Bever et al. (1992) phrasetree: minimum phrase length 3 words; breaks at conjunctions and prepositions. Best for everyday reading. |
| **Strong** | Finer breaks into smaller groups. Research shows this extra support especially helps developing and non-native readers — and it can help any reader tackling dense or unfamiliar material (Jandreau, Muncer & Bever 1986, Exp. 2: adding minor boundaries lifted poor readers from +16% to +20%). |

There is no Spacing Width control. The gap is fixed at the evidence-calibrated value (U+2009 thin space). Making it wider has no measurable effect on reading performance.

---

## Architecture

### Inline-only, no line breaks

Three independent papers establish why TextGlide inserts inline gaps rather than restructuring text into phrase-per-line:

- **North & Jenkins (1951):** inline spacing significantly beat line-break format on both speed and comprehension.
- **Coleman & Kim (1961):** horizontal inline spacing outperformed vertical line-break arms, which were significantly slower.
- **Keenan (1984):** one chunk per line was read significantly *more slowly* than standard text in all conditions, due to line-length variability disrupting return sweeps.

Inline spacing also survives Kindle reflow and font-size changes; a fixed line-break structure does not.

### Algorithm constants

All calibration values live in a single source-of-truth file:

```
GAP_CHARACTER           = U+2009  # THIN SPACE — ~1.8× a normal word space
                                  # Bever et al. 1992: gap magnitude above threshold
                                  # has no significant effect on readability.

GAP_CHARACTER_FALLBACK  = U+2002  # EN SPACE — not user-exposed.
                                  # Reserved for future device testing only.

BALANCED_MIN_CHARS      = 14      # ~2.5-word minimum chunk.
                                  # Bever et al. 1992: phrasetree stops at phrases
                                  # under 3 words. Jandreau & Bever 1992: confirmed.

STRONG_MIN_CHARS        = 10      # Finer chunking for developing readers / dense material.
                                  # Jandreau, Muncer & Bever 1986 Exp. 2: adding minor
                                  # boundaries lifted poor readers from +16% to +20%.

MIN_PHRASE_LENGTH       = 3       # Bever et al. 1992 phrasetree specification.

BALANCED_TRIGGERS       = [CCONJ, SCONJ, ADP]
STRONG_TRIGGERS         = [CCONJ, SCONJ, ADP, who, which, whom]
```

### Processing pipeline

1. Validate the uploaded file is a real EPUB (a ZIP of XHTML)
2. DRM guard: if `encryption.xml` or other DRM markers are present, refuse clearly
3. Unzip; walk each XHTML document, editing **only text nodes** — never tags, attributes, scripts, styles, or word interiors
4. Insert U+2009 at boundaries chosen by the selected mode and Reading Support setting
5. Inject `text-align: left` into the EPUB stylesheet
6. Repack into a valid EPUB, preserving all metadata and markup; if a single document fails, leave it untouched rather than corrupting the file
7. Return to user; temp files deleted immediately

### Tech stack

- **Backend:** Python · Flask · `ebooklib` · `BeautifulSoup` / `bs4` · `spaCy` (`en_core_web_sm`, `es_core_news_sm`)
- **Frontend:** React · Lora serif
- **Hosting:** Replit

---

## What TextGlide does not do

- **Does not remove DRM.** It cannot, and it refuses to process DRM-protected files.
- **Does not change words, markup, or layout.** It edits whitespace only.
- **Does not store your books.** Files are processed in a temporary directory and deleted immediately after download. No IP addresses, no personal data, no retention.
- **Does not guarantee an improvement.** Roughly half of all studies in the research corpus found no significant effect. Your experience will vary with reading skill, material difficulty, and individual sensitivity to the cue.

---

## Limitations & honest caveats

- The benefit concentrates in **developing, average, and non-native readers**, and in **harder material**. For a fluent reader on easy, familiar text, expect a small comfort gain at most.
- **Justified text can cancel the effect.** Set your e-reader to left-aligned.
- The research base used **print and screen**, not Kindle specifically. The gap character has been verified on Kindle Paperwhite 12 / Amazon Ember but not exhaustively across all devices and fonts.
- **Both processing modes are retained** while real-world A/B testing is ongoing. Natural Scan is the current recommended default based on the literature. The Grammar Parse engine will be removed once tests confirm or refute Natural Scan's advantage.
- Language support is currently **English and Spanish** only. Other languages require additional spaCy models and break-trigger lists calibrated to their phrase structure.

---

## Contributing

Contributions welcome. The highest-value open items:

- **Real-world A/B reading tests** comparing Natural Scan vs. Grammar Parse on the same processed books — this is the data that will determine which engine survives.
- **Additional language support** (French, German, Italian are natural next candidates given spaCy model availability).
- **Device verification** — if you test a processed EPUB on a Kobo, Apple Books, or any non-Kindle device and can report whether the thin space renders visibly, that's directly useful data.
- **Bug reports** on DRM detection, EPUB structure edge cases, or processing failures.

Please open an issue before starting significant work so we can discuss scope and direction.

---

## License

MIT. See [LICENSE](LICENSE).

---

## Acknowledgments

TextGlide is directly inspired by Asym, a phrase-spacing tool developed by Asymmetrica Labs. Asym is no longer available. TextGlide is an independent, open-source reconstruction built from the published scientific literature rather than from Asym's code or copy.

The scientific foundation rests on a body of research stretching from North & Jenkins (1951) through Bever, Jandreau, and colleagues' work in the 1980s and 1990s. The core insight — that phrase-sensitive spacing helps reading, that the mechanism is perceptual not orthographic, and that the effect is strongest for readers who haven't yet automated phrase-grouping — belongs to that literature.