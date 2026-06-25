"""
PhraseFlow EPUB processor.

Inserts subtle spacing at major phrase boundaries to aid reading comprehension.
Only text nodes are ever modified — tags, attributes, scripts, styles, and
intra-word characters are never touched.

Chunking levels:
  Simple  – keyword/punctuation heuristic, per-language function-word list
  Smart   – benepar constituency parse → spaCy dep-parse fallback → Simple fallback

DRM detection: refuses EPUBs that have <EncryptedData> in META-INF/encryption.xml.
"""

from __future__ import annotations

import io
import re
import zipfile
from pathlib import Path
from typing import Literal

from bs4 import BeautifulSoup, NavigableString, Tag

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Spacing width → Unicode gap character
GAP_CHARS: dict[str, str] = {
    "subtle": "\u2009",   # THIN SPACE  (~1/5 em)
    "medium": "\u2002",   # EN SPACE    (~1/2 em)
    "strong": "\u2003",   # EM SPACE    (1 em)
}

# Chunk density → (min_chars_per_chunk, boundary_level)
# boundary_level: 1=major only, 2=major+PP, 3=major+PP+NP
DENSITY_CFG: dict[str, dict] = {
    "subtle":  {"min_chars": 22, "level": 1},
    "medium":  {"min_chars": 14, "level": 2},
    "obvious": {"min_chars":  7, "level": 3},
}

# Simple-mode function words that signal phrase/clause beginnings — English
SIMPLE_BREAKS_EN: set[str] = {
    # coordinating conjunctions (clause-level)
    "and", "or", "but", "so", "yet", "nor",
    # subordinating conjunctions / relative markers
    "that", "which", "who", "whom", "whose", "when", "where", "while",
    "because", "although", "though", "unless", "until", "since", "if",
    # prepositions starting major PPs
    "to", "of", "in", "on", "at", "for", "with", "by", "from", "as", "about",
}

# Simple-mode function words — Spanish
SIMPLE_BREAKS_ES: set[str] = {
    # coordinating conjunctions
    "y", "e", "o", "u", "pero", "sino", "ni",
    # subordinating conjunctions / relative markers
    "que", "quien", "donde", "cuando", "como", "aunque", "porque",
    "si", "para", "mientras", "hasta", "desde", "antes",
    # prepositions starting major PPs
    "de", "en", "a", "con", "por", "sin", "sobre", "entre",
}

SENTENCE_END_RE = re.compile(r'([.!?]["\'\u201c\u201d\u2018\u2019]?)\s+')

# Tags whose text nodes we never touch
SKIP_TAGS = frozenset({"script", "style", "code", "pre", "kbd", "samp", "var"})

# EPUB content MIME types
CONTENT_MIME_TYPES = frozenset({"application/xhtml+xml", "text/html"})

# ---------------------------------------------------------------------------
# Language detection
# ---------------------------------------------------------------------------

_SPANISH_RE = re.compile(
    r'(?i)[ñáéíóúüÑÁÉÍÓÚÜ¿¡]'
    r'|\b(que|est[aá]|pero|tambi[eé]n|por|para|como|muy|m[aá]s|una|este|esta'
    r'|los|las|del|con|son|han|ser|fue|cuando|bien|todo|puede)\b'
)


def detect_language(text: str) -> Literal["en", "es"]:
    """Quick heuristic: return 'es' if ~10%+ of tokens are Spanish indicators."""
    sample = text[:800]
    words = sample.split()
    if not words:
        return "en"
    hits = len(_SPANISH_RE.findall(sample))
    return "es" if hits / len(words) > 0.08 else "en"


# ---------------------------------------------------------------------------
# Model registry
# ---------------------------------------------------------------------------

class _ModelState:
    def __init__(self) -> None:
        self.nlp = None
        self.has_benepar: bool = False
        self.tried: bool = False
        self.failed: bool = False


_models: dict[str, _ModelState] = {"en": _ModelState(), "es": _ModelState()}

_MODEL_IDS = {
    "en": ("en_core_web_sm", "benepar_en3"),
    "es": ("es_core_news_sm", "benepar_es3"),
}


def _load_model(lang: str) -> _ModelState:
    state = _models[lang]
    if state.tried:
        return state
    state.tried = True
    spacy_id, benepar_id = _MODEL_IDS.get(lang, ("en_core_web_sm", "benepar_en3"))
    try:
        import spacy
        nlp = spacy.load(spacy_id)
        state.nlp = nlp
    except Exception:
        state.failed = True
        return state
    try:
        import benepar
        if not nlp.has_pipe("benepar"):
            nlp.add_pipe("benepar", config={"model": benepar_id})
        state.has_benepar = True
    except Exception:
        state.has_benepar = False
    return state


def get_smart_status(lang: str) -> str:
    """Return a human-readable string describing which mode will run."""
    state = _load_model(lang)
    if state.failed or state.nlp is None:
        return "simple"
    if state.has_benepar:
        return "smart_benepar"
    return "smart_dep"


# ---------------------------------------------------------------------------
# Glued-unit detection (positions where we must NOT break)
# ---------------------------------------------------------------------------

def _forbidden_breaks(tokens: list) -> set[int]:
    """
    Return absolute token indices before which a break is NEVER allowed.

    Glued-unit pairs — we forbid a break immediately before `tok` when the
    preceding token (`prev`) participates in one of these relationships:

      det        → governed noun/adj          ("the book")
      advmod     → governed verb/adj          ("gently cue", "actually read")
      aux/auxpass→ governed verb              ("will come", "was written")
      neg        → following token            ("don't read")
      prt / compound:prt → verb particle     ("pick up")
      mark "to"  → the token after "to"      ("to gently cue" — don't break into the VP)
      ADP (prep) → directly following obj    (don't orphan a bare preposition)
      nummod     → governed noun             ("three cats")
      amod       → governed noun             ("free open tool")
      compound/nn→ governed noun             ("phrase groups")
      poss       → governed noun             ("reader's eye")
    """
    forbidden: set[int] = set()
    for i, tok in enumerate(tokens):
        if i == 0:
            continue
        prev = tokens[i - 1]

        # det → noun/adj
        if prev.dep_ == "det" and prev.head == tok:
            forbidden.add(tok.i)

        # advmod → its head verb/adj (KEY FIX: prevents "gently  cue", "actually  read")
        if prev.dep_ == "advmod" and prev.head == tok:
            forbidden.add(tok.i)

        # aux / auxpass → head verb
        if prev.dep_ in ("aux", "auxpass") and prev.head == tok:
            forbidden.add(tok.i)

        # neg → following token
        if prev.dep_ == "neg":
            forbidden.add(tok.i)

        # verb particle
        if prev.dep_ in ("prt", "compound:prt"):
            forbidden.add(tok.i)

        # infinitival "to": don't break between "to" and what follows it
        if prev.dep_ == "mark" and prev.text.lower() == "to":
            forbidden.add(tok.i)

        # bare preposition → its object (never orphan a preposition)
        if prev.pos_ == "ADP" and tok.dep_ in ("pobj", "dobj", "nmod"):
            forbidden.add(tok.i)

        # nummod → noun
        if prev.dep_ == "nummod" and prev.head == tok:
            forbidden.add(tok.i)

        # amod → noun ("free, open tool")
        if prev.dep_ == "amod" and prev.head == tok:
            forbidden.add(tok.i)

        # compound / nn → noun ("phrase groups", "noun phrase")
        if prev.dep_ in ("compound", "nn") and prev.head == tok:
            forbidden.add(tok.i)

        # possessive → noun ("reader's eye")
        if prev.dep_ in ("poss", "possessive") and prev.head == tok:
            forbidden.add(tok.i)

    return forbidden


# ---------------------------------------------------------------------------
# Min-chars guardrail
# ---------------------------------------------------------------------------

def _apply_min_chars(
    raw_breaks: set[int],
    tokens: list,
    min_chars: int,
    forced: set[int] = frozenset(),
) -> set[int]:
    """
    Remove soft break points that would leave a chunk shorter than min_chars chars.

    `forced` break positions (e.g. after semicolons/colons) are ALWAYS kept and
    reset the chunk counter so subsequent min-chars measurements start fresh from
    the forced break, not from the beginning of the sentence.
    """
    all_breaks = raw_breaks | forced
    if not all_breaks:
        return set()

    sent_start = tokens[0].i
    n = len(tokens)
    all_rel = sorted(b - sent_start for b in all_breaks)
    boundaries = [0] + all_rel + [n]

    result: list[int] = []
    pending = 0
    for idx in range(1, len(boundaries)):
        end = boundaries[idx]
        if end == n:
            break
        abs_pos = end + sent_start
        is_forced = abs_pos in forced
        chunk_text = "".join(
            t.text + t.whitespace_ for t in tokens[pending:end]
        ).strip()
        if is_forced or len(chunk_text) >= min_chars:
            result.append(abs_pos)
            pending = end
        # else: soft break, chunk too short — merge into the next chunk

    return set(result)


# ---------------------------------------------------------------------------
# Benepar-based chunker
# ---------------------------------------------------------------------------

def _is_direct_child_of_root(span, sent, all_spans: list) -> bool:
    """True if the smallest constituent properly containing span is the sentence itself."""
    ss, se = span.start, span.end
    smallest_parent_size = (sent.end - sent.start) + 1
    smallest_parent = None

    for other in all_spans:
        os, oe = other.start, other.end
        if os == ss and oe == se:
            continue
        if os <= ss and oe >= se:
            size = oe - os
            if size < smallest_parent_size:
                smallest_parent_size = size
                smallest_parent = other

    if smallest_parent is None:
        return True
    return smallest_parent.start == sent.start and smallest_parent.end == sent.end


def _breaks_benepar(sent, level: int, forbidden: set[int]) -> set[int]:
    breaks: set[int] = set()
    try:
        spans = list(sent._.constituents)
    except Exception:
        return breaks

    for span in spans:
        label = span.label_
        start = span.start
        if start == sent.start:
            continue
        if start in forbidden:
            continue

        if label in ("VP", "SBAR", "S", "SINV", "SQ"):
            if _is_direct_child_of_root(span, sent, spans):
                breaks.add(start)
        elif level >= 2 and label == "PP":
            if _is_direct_child_of_root(span, sent, spans):
                breaks.add(start)
        elif level >= 3 and label in ("NP", "ADJP", "ADVP"):
            if len(span) >= 2 and _is_direct_child_of_root(span, sent, spans):
                breaks.add(start)

    return breaks


# ---------------------------------------------------------------------------
# Forced punctuation breaks (always bypass min-chars guardrail)
# ---------------------------------------------------------------------------

def _forced_breaks_punct(sent, forbidden: set[int]) -> set[int]:
    """
    Semicolons and colons always open a new clause.  Return the position of the
    first token AFTER each such punctuation mark as a forced break — these are
    never suppressed by the min-chars guardrail.
    """
    forced: set[int] = set()
    for tok in sent:
        if tok.dep_ == "punct" and tok.text in (";", ":"):
            nxt = tok.i + 1
            if nxt < sent.end and nxt not in forbidden:
                forced.add(nxt)
    return forced


# ---------------------------------------------------------------------------
# Dependency-parse fallback chunker
# ---------------------------------------------------------------------------

# dep labels that are valid break points at ALL density levels (level 1+)
_BREAK_L1 = frozenset({
    "prep",          # prepositional phrase boundary (break before the whole PP)
    "advcl",         # adverbial clause ("while the city came awake")
    "relcl",         # relative clause  ("that works on the device")
    "ccomp",         # clausal complement ("I know that he came")
    "xcomp",         # open clausal complement ("to gently cue")
    "conj",          # coordinated clause ("they take in")
    "cc",            # coordinating conjunction itself ("and", "but")
    "mark",          # subordinating conjunction / clause introducer
                     # (infinitival "to" is handled by _forbidden_breaks instead)
})


_CLAUSE_DEPS = frozenset({"advcl", "relcl", "ccomp", "xcomp", "conj"})


def _breaks_dep(sent, level: int, forbidden: set[int]) -> set[int]:
    """
    Insert a break before a token when:
      1. Its dep label is in the positive set for the current level, AND
      2. The chosen break position is not in the forbidden set, AND
      3. The left-chunk min-chars guardrail (applied later) is satisfied.

    Break-position rule:
      For clause-introducing deps (advcl, relcl, ccomp, xcomp, conj) we break
      before tok.left_edge — the leftmost token of the whole clause subtree —
      rather than before the clause head.  This ensures the relative pronoun
      ("that"), subject ("they"), or subordinator ("while") stays with the
      clause it introduces, rather than being orphaned to the left of the break.

    Positive rules by level:
      L1 (subtle)  : advcl, relcl, ccomp, xcomp, conj (left_edge)
                     + prep, cc, mark (tok itself)
      L2 (medium)  : same as L1
      L3 (obvious) : same as L2 + nsubj/nsubjpass when head is ROOT

    Semicolons and colons are handled separately by _forced_breaks_punct
    and always bypass the min-chars guardrail.
    """
    breaks: set[int] = set()

    for tok in sent:
        if tok.i == sent.start:
            continue

        d = tok.dep_

        if tok.i in forbidden:
            continue

        # Clause-level deps: break at the leftmost token of the subtree
        if d in _CLAUSE_DEPS:
            edge_i = tok.left_edge.i
            if edge_i == sent.start:
                # entire subtree starts the sentence — no useful break
                continue
            if edge_i not in forbidden:
                breaks.add(edge_i)
            continue

        # Remaining L1+ labels: break before tok itself
        if d in _BREAK_L1:
            breaks.add(tok.i)
            continue

        # L3 only: subject→predicate boundary when head is ROOT
        if level >= 3 and d in ("nsubj", "nsubjpass") and tok.head.dep_ == "ROOT":
            breaks.add(tok.i)

    return breaks


# ---------------------------------------------------------------------------
# Reconstruct text with gaps
# ---------------------------------------------------------------------------

def _insert_gaps(tokens: list, breaks: set[int], gap: str) -> str:
    parts: list[str] = []
    for tok in tokens:
        if tok.i in breaks:
            # Replace any whitespace before this token with gap + space
            if parts and parts[-1].endswith(" "):
                parts[-1] = parts[-1][:-1]
            parts.append(gap + " ")
        parts.append(tok.text)
        if tok.whitespace_:
            parts.append(tok.whitespace_)
    return "".join(parts)


# ---------------------------------------------------------------------------
# High-level patch functions
# ---------------------------------------------------------------------------

def _patch_simple(text: str, gap: str, density: str, lang: str) -> str:
    """Keyword + punctuation heuristic."""
    words = SIMPLE_BREAKS_EN if lang == "en" else SIMPLE_BREAKS_ES
    min_chars = DENSITY_CFG[density]["min_chars"]

    # After sentence-terminal punctuation
    patched = SENTENCE_END_RE.sub(lambda m: m.group(1) + gap + " ", text)

    # Before structure words — only if the preceding chunk is wide enough
    def maybe_gap(m: re.Match) -> str:
        before = patched[: m.start()]
        # Count chars since the last gap insertion
        last_gap = before.rfind(gap)
        chars_since = len(before) - (last_gap + len(gap)) if last_gap >= 0 else len(before)
        if chars_since >= min_chars:
            return gap + m.group(1) + m.group(2)
        return m.group(1) + m.group(2)

    for word in sorted(words, key=len, reverse=True):
        pattern = re.compile(
            r'(?<=[^\s])(\s+)(' + re.escape(word) + r')(?=[\s,;:.])',
            re.IGNORECASE,
        )
        patched = pattern.sub(maybe_gap, patched)

    return patched


def _patch_smart(text: str, gap: str, density: str, lang: str) -> tuple[str, str]:
    """
    Returns (patched_text, mode_used).
    mode_used is one of: 'smart_benepar', 'smart_dep', 'simple'.
    """
    state = _load_model(lang)
    if state.failed or state.nlp is None:
        return _patch_simple(text, gap, density, lang), "simple"

    cfg = DENSITY_CFG[density]
    level = cfg["level"]
    min_chars = cfg["min_chars"]

    try:
        doc = state.nlp(text)
    except Exception:
        return _patch_simple(text, gap, density, lang), "simple"

    result_parts: list[str] = []
    mode_used = "smart_benepar" if state.has_benepar else "smart_dep"

    for sent in doc.sents:
        tokens = list(sent)
        if not tokens:
            continue
        forbidden = _forbidden_breaks(tokens)

        forced = _forced_breaks_punct(sent, forbidden)

        if state.has_benepar:
            try:
                raw_breaks = _breaks_benepar(sent, level, forbidden)
            except Exception:
                raw_breaks = _breaks_dep(sent, level, forbidden)
                mode_used = "smart_dep"
        else:
            raw_breaks = _breaks_dep(sent, level, forbidden)

        breaks = _apply_min_chars(raw_breaks, tokens, min_chars, forced)
        result_parts.append(_insert_gaps(tokens, breaks, gap))
        # preserve trailing whitespace after sentence
        if sent.end < len(doc) and doc[sent.end - 1].whitespace_:
            pass  # already included via whitespace_ on last token

    return "".join(result_parts), mode_used


# ---------------------------------------------------------------------------
# EPUB HTML patching
# ---------------------------------------------------------------------------

def _is_in_skip_tag(node) -> bool:
    for parent in node.parents:
        if isinstance(parent, Tag) and parent.name in SKIP_TAGS:
            return True
    return False


def _patch_document(
    html_bytes: bytes,
    mode: str,
    spacing_width: str,
    chunk_density: str,
    language: str,
) -> tuple[bytes, str]:
    """
    Patch all text nodes in one XHTML document.
    Returns (patched_bytes, mode_actually_used).
    """
    gap = GAP_CHARS.get(spacing_width, GAP_CHARS["subtle"])
    mode_used = mode

    try:
        soup = BeautifulSoup(html_bytes, "lxml-xml")
    except Exception:
        try:
            soup = BeautifulSoup(html_bytes, "html.parser")
        except Exception:
            return html_bytes, mode

    for node in list(soup.find_all(string=True)):
        if not isinstance(node, NavigableString):
            continue
        if isinstance(node.parent, Tag) and node.parent.name == "[document]":
            continue
        if _is_in_skip_tag(node):
            continue

        original = str(node)
        if not original.strip():
            continue

        # Resolve "auto" language per text node
        eff_lang = language
        if language == "auto":
            eff_lang = detect_language(original)

        if mode == "smart":
            patched, mode_used = _patch_smart(original, gap, chunk_density, eff_lang)
        else:
            patched = _patch_simple(original, gap, chunk_density, eff_lang)

        if patched != original:
            node.replace_with(NavigableString(patched))

    return str(soup).encode("utf-8", errors="replace"), mode_used


# ---------------------------------------------------------------------------
# Public: preview (plain text only, no EPUB)
# ---------------------------------------------------------------------------

def preview_text(
    text: str,
    mode: str,
    spacing_width: str,
    chunk_density: str,
    language: str,
) -> tuple[str, str]:
    """
    Run phrase-spacing on a plain-text snippet.
    Returns (spaced_text, mode_actually_used).
    """
    if not text.strip():
        return text, mode

    gap = GAP_CHARS.get(spacing_width, GAP_CHARS["subtle"])

    eff_lang = language
    if language == "auto":
        eff_lang = detect_language(text)

    if mode == "smart":
        return _patch_smart(text, gap, chunk_density, eff_lang)
    return _patch_simple(text, gap, chunk_density, eff_lang), "simple"


# ---------------------------------------------------------------------------
# Public: DRM check
# ---------------------------------------------------------------------------

def is_drm_protected(epub_path: str) -> bool:
    with zipfile.ZipFile(epub_path, "r") as zf:
        names_lower = {n.lower() for n in zf.namelist()}
        if "meta-inf/encryption.xml" not in names_lower:
            return False
        real = next(n for n in zf.namelist() if n.lower() == "meta-inf/encryption.xml")
        content = zf.read(real).decode("utf-8", errors="replace")
        return "<EncryptedData" in content


# ---------------------------------------------------------------------------
# Public: process EPUB
# ---------------------------------------------------------------------------

def _get_content_doc_paths(zf: zipfile.ZipFile) -> set[str]:
    opf = _find_opf(zf)
    if opf is None:
        return {n for n in zf.namelist() if n.lower().endswith((".xhtml", ".html", ".htm"))}

    opf_bytes = zf.read(opf)
    soup = BeautifulSoup(opf_bytes, "lxml-xml")
    opf_dir = str(Path(opf).parent)
    if opf_dir == ".":
        opf_dir = ""
    paths: set[str] = set()
    for item in soup.find_all("item"):
        mt = item.get("media-type", "").strip().lower()
        href = item.get("href", "")
        if mt in CONTENT_MIME_TYPES and href:
            full = (opf_dir + "/" + href) if opf_dir else href
            paths.add(str(Path(full)))
    return paths


def _find_opf(zf: zipfile.ZipFile) -> str | None:
    try:
        container = zf.read("META-INF/container.xml")
        s = BeautifulSoup(container, "lxml-xml")
        rf = s.find("rootfile")
        if rf:
            return rf.get("full-path")
    except Exception:
        pass
    for n in zf.namelist():
        if n.lower().endswith(".opf"):
            return n
    return None


def process_epub(
    input_path: str,
    mode: str,
    spacing_width: str,
    chunk_density: str,
    language: str,
) -> tuple[bytes, str]:
    """
    Process an EPUB file.
    Returns (epub_bytes, mode_actually_used).
    mode_actually_used may differ from mode when a fallback was triggered.
    """
    with zipfile.ZipFile(input_path, "r") as zf_in:
        content_paths = _get_content_doc_paths(zf_in)
        norm_paths = {p.replace("\\", "/") for p in content_paths}

        out_buf = io.BytesIO()
        mode_used = mode

        with zipfile.ZipFile(out_buf, "w", compression=zipfile.ZIP_DEFLATED) as zf_out:
            # mimetype MUST be first and uncompressed
            if "mimetype" in zf_in.namelist():
                zf_out.writestr(
                    zipfile.ZipInfo("mimetype"),
                    zf_in.read("mimetype"),
                )

            for item in zf_in.infolist():
                if item.filename == "mimetype":
                    continue
                raw = zf_in.read(item.filename)
                norm = item.filename.replace("\\", "/")

                if norm in norm_paths:
                    try:
                        patched, mu = _patch_document(
                            raw, mode, spacing_width, chunk_density, language
                        )
                        mode_used = mu
                    except Exception:
                        patched = raw

                    zi = zipfile.ZipInfo(item.filename)
                    zi.compress_type = zipfile.ZIP_DEFLATED
                    zf_out.writestr(zi, patched)
                else:
                    zf_out.writestr(item, raw)

    return out_buf.getvalue(), mode_used
