"""
TextGlide EPUB processor.

Inserts a thin-space gap (U+2009) at major phrase boundaries to aid reading
comprehension. Only text nodes are ever modified — tags, attributes, scripts,
styles, and intra-word characters are never touched.

Chunking modes:
  Quick Pass (pseudosyntactic) — POS-tag heuristic (spaCy); keyword fallback if unavailable.
  Grammar Parser (syntactic)  — Full dependency-parse (spaCy); keyword fallback if unavailable.

Reading Support tiers (controls break frequency):
  Balanced — conjunctions + prepositions; min 14 chars per chunk.
  Strong   — same plus relative pronouns; min 10 chars per chunk.

DRM detection: refuses EPUBs that have <EncryptedData> in META-INF/encryption.xml.

All calibration constants imported from textglide_config (single source of truth).
"""

from __future__ import annotations

import io
import re
import zipfile
from pathlib import Path
from typing import Literal

from bs4 import BeautifulSoup, NavigableString, Tag

from textglide_config import DENSITY_CFG, GAP_CHAR

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Keyword fallback function words — English (used only when spaCy is unavailable)
_FALLBACK_WORDS_EN: set[str] = {
    "and", "or", "but", "so", "yet", "nor",
    "that", "which", "who", "whom", "whose", "when", "where", "while",
    "because", "although", "though", "unless", "until", "since", "if",
    "to", "of", "in", "on", "at", "for", "with", "by", "from", "as", "about",
}

# Keyword fallback function words — Spanish
_FALLBACK_WORDS_ES: set[str] = {
    "y", "e", "o", "u", "pero", "sino", "ni",
    "que", "quien", "donde", "cuando", "como", "aunque", "porque",
    "si", "para", "mientras", "hasta", "desde", "antes",
    "de", "en", "a", "con", "por", "sin", "sobre", "entre",
}

SENTENCE_END_RE = re.compile(r'([.!?]["\'\u201c\u201d\u2018\u2019]?)\s+')

# Tags whose text nodes we never touch
SKIP_TAGS = frozenset({"script", "style", "code", "pre", "kbd", "samp", "var"})

# EPUB content MIME types
CONTENT_MIME_TYPES = frozenset({"application/xhtml+xml", "text/html"})

# CSS injected into every processed content document for best-effort left-alignment.
# Justified text stretches normal spaces unpredictably and can cancel out phrase gaps.
_LEFT_ALIGN_CSS = "p,div,span,li,blockquote{text-align:left!important}"

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
        self.tried: bool = False
        self.failed: bool = False


_models: dict[str, _ModelState] = {"en": _ModelState(), "es": _ModelState()}

_MODEL_IDS = {
    "en": "en_core_web_sm",
    "es": "es_core_news_sm",
}


def _load_model(lang: str) -> _ModelState:
    state = _models[lang]
    if state.tried:
        return state
    state.tried = True
    spacy_id = _MODEL_IDS.get(lang, "en_core_web_sm")
    try:
        import spacy
        state.nlp = spacy.load(spacy_id)
    except Exception:
        state.failed = True
    return state


# ---------------------------------------------------------------------------
# Glued-unit detection (positions where we must NOT break) — Grammar Parser mode
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
      mark "to"  → the token after "to"      ("to gently cue")
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

        if prev.dep_ == "det" and prev.head == tok:
            forbidden.add(tok.i)
        if prev.dep_ == "advmod" and prev.head == tok:
            forbidden.add(tok.i)
        if prev.dep_ in ("aux", "auxpass") and prev.head == tok:
            forbidden.add(tok.i)
        if prev.dep_ == "neg":
            forbidden.add(tok.i)
        if prev.dep_ in ("prt", "compound:prt"):
            forbidden.add(tok.i)
        if prev.dep_ == "mark" and prev.text.lower() == "to":
            forbidden.add(tok.i)
        if prev.pos_ == "ADP" and tok.dep_ in ("pobj", "dobj", "nmod"):
            forbidden.add(tok.i)
        if prev.dep_ == "nummod" and prev.head == tok:
            forbidden.add(tok.i)
        if prev.dep_ == "amod" and prev.head == tok:
            forbidden.add(tok.i)
        if prev.dep_ in ("compound", "nn") and prev.head == tok:
            forbidden.add(tok.i)
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

    return set(result)


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
# POS-based chunker (Quick Pass / pseudosyntactic mode)
# ---------------------------------------------------------------------------

# POS tags that signal a new phrase boundary, by density level
_PSEUDO_POS_L1 = frozenset({"CCONJ", "SCONJ"})        # coordinating + subordinating conj
_PSEUDO_POS_L2 = frozenset({"CCONJ", "SCONJ", "ADP"}) # + prepositions
_PSEUDO_PRON_L3 = frozenset({"who", "which", "whom"})  # relative pronouns (strong only)


def _breaks_pos(sent, level: int) -> set[int]:
    """
    POS-based break candidates for Quick Pass mode.
    No dependency tree consulted — only POS tags and the token's position.
    """
    trigger_pos = _PSEUDO_POS_L2 if level >= 2 else _PSEUDO_POS_L1
    breaks: set[int] = set()
    for tok in sent:
        if tok.i == sent.start:
            continue
        if tok.pos_ in trigger_pos:
            breaks.add(tok.i)
        if level >= 3 and tok.pos_ == "PRON" and tok.text.lower() in _PSEUDO_PRON_L3:
            breaks.add(tok.i)
    return breaks


def _patch_pseudosyntactic(
    text: str, chunk_density: str, lang: str
) -> tuple[str, str]:
    """
    POS-heuristic chunker for Quick Pass mode.
    Returns (patched_text, mode_used).
    mode_used: 'pseudosyntactic' on success, 'keyword_fallback' if spaCy unavailable.
    """
    state = _load_model(lang)
    cfg = DENSITY_CFG[chunk_density]
    level = cfg["level"]
    min_chars = cfg["min_chars"]

    if state.failed or state.nlp is None:
        return _keyword_fallback(text, chunk_density, lang), "keyword_fallback"

    try:
        doc = state.nlp(text)
    except Exception:
        return _keyword_fallback(text, chunk_density, lang), "keyword_fallback"

    result_parts: list[str] = []
    for sent in doc.sents:
        tokens = list(sent)
        if not tokens:
            continue
        raw_breaks = _breaks_pos(sent, level)
        forced = _forced_breaks_punct(sent, set())
        breaks = _apply_min_chars(raw_breaks, tokens, min_chars, forced)
        result_parts.append(_insert_gaps(tokens, breaks, GAP_CHAR))

    return "".join(result_parts), "pseudosyntactic"


# ---------------------------------------------------------------------------
# Dependency-parse chunker (Grammar Parser / syntactic mode)
# ---------------------------------------------------------------------------

# dep labels that trigger a break at ALL density levels
_BREAK_L1 = frozenset({
    "prep",   # prepositional phrase boundary
    "advcl",  # adverbial clause ("while the city came awake")
    "relcl",  # relative clause  ("that works on the device")
    "ccomp",  # clausal complement ("I know that he came")
    "xcomp",  # open clausal complement ("to gently cue")
    "conj",   # coordinated clause ("they take in")
    "cc",     # coordinating conjunction itself ("and", "but")
    "mark",   # subordinating conjunction / clause introducer
})

_CLAUSE_DEPS = frozenset({"advcl", "relcl", "ccomp", "xcomp", "conj"})


def _breaks_dep(sent, level: int, forbidden: set[int]) -> set[int]:
    """
    Dependency-parse break candidates for Grammar Parser mode.

    For clause-introducing deps (advcl, relcl, ccomp, xcomp, conj) the break
    lands at tok.left_edge — the leftmost token of the entire subtree — so the
    relative pronoun, subject, or subordinator stays with its clause.

    Balanced : _CLAUSE_DEPS (left_edge) + prep, cc, mark (tok itself)
    Strong   : same as Balanced + nsubj/nsubjpass when head is ROOT
    """
    breaks: set[int] = set()

    for tok in sent:
        if tok.i == sent.start:
            continue
        d = tok.dep_
        if tok.i in forbidden:
            continue

        if d in _CLAUSE_DEPS:
            edge_i = tok.left_edge.i
            if edge_i == sent.start:
                continue
            if edge_i not in forbidden:
                breaks.add(edge_i)
            continue

        if d in _BREAK_L1:
            breaks.add(tok.i)
            continue

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

def _keyword_fallback(text: str, density: str, lang: str) -> str:
    """
    Last-resort keyword/structure-word heuristic — no spaCy required.
    Used only when spaCy itself fails to load.
    """
    words = _FALLBACK_WORDS_EN if lang == "en" else _FALLBACK_WORDS_ES
    min_chars = DENSITY_CFG[density]["min_chars"]
    gap = GAP_CHAR

    patched = SENTENCE_END_RE.sub(lambda m: m.group(1) + gap + " ", text)

    def maybe_gap(m: re.Match) -> str:
        before = patched[: m.start()]
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


def _patch_syntactic(text: str, chunk_density: str, lang: str) -> tuple[str, str]:
    """
    Full dependency-parse chunker for Grammar Parser mode.
    Returns (patched_text, mode_used).
    mode_used: 'syntactic' on success, 'keyword_fallback' if spaCy unavailable.
    """
    state = _load_model(lang)
    if state.failed or state.nlp is None:
        return _keyword_fallback(text, chunk_density, lang), "keyword_fallback"

    cfg = DENSITY_CFG[chunk_density]
    level = cfg["level"]
    min_chars = cfg["min_chars"]

    try:
        doc = state.nlp(text)
    except Exception:
        return _keyword_fallback(text, chunk_density, lang), "keyword_fallback"

    result_parts: list[str] = []
    for sent in doc.sents:
        tokens = list(sent)
        if not tokens:
            continue
        forbidden = _forbidden_breaks(tokens)
        forced = _forced_breaks_punct(sent, forbidden)
        raw_breaks = _breaks_dep(sent, level, forbidden)
        breaks = _apply_min_chars(raw_breaks, tokens, min_chars, forced)
        result_parts.append(_insert_gaps(tokens, breaks, GAP_CHAR))

    return "".join(result_parts), "syntactic"


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
    chunk_density: str,
    language: str,
) -> tuple[bytes, str]:
    """
    Patch all text nodes in one XHTML document and inject left-align CSS.
    Returns (patched_bytes, mode_actually_used).
    """
    mode_used = mode

    try:
        soup = BeautifulSoup(html_bytes, "lxml-xml")
    except Exception:
        try:
            soup = BeautifulSoup(html_bytes, "html.parser")
        except Exception:
            return html_bytes, mode

    # Inject left-alignment as best effort — Kindle justification stretches normal
    # spaces and can cancel out phrase gaps. We inject into <head> so it applies
    # document-wide; the device setting can still override it.
    head = soup.find("head")
    if head:
        style_tag = soup.new_tag("style")
        style_tag.string = _LEFT_ALIGN_CSS
        head.insert(0, style_tag)

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

        eff_lang = language
        if language == "auto":
            eff_lang = detect_language(original)

        if mode == "syntactic":
            patched, mode_used = _patch_syntactic(original, chunk_density, eff_lang)
        else:
            patched, mode_used = _patch_pseudosyntactic(original, chunk_density, eff_lang)

        if patched != original:
            node.replace_with(NavigableString(patched))

    return str(soup).encode("utf-8", errors="replace"), mode_used


# ---------------------------------------------------------------------------
# Public: preview (plain text only, no EPUB)
# ---------------------------------------------------------------------------

def preview_text(
    text: str,
    mode: str,
    chunk_density: str,
    language: str,
) -> tuple[str, str]:
    """
    Run phrase-spacing on a plain-text snippet.
    Returns (spaced_text, mode_actually_used).
    """
    if not text.strip():
        return text, mode

    eff_lang = language
    if language == "auto":
        eff_lang = detect_language(text)

    if mode == "syntactic":
        return _patch_syntactic(text, chunk_density, eff_lang)
    return _patch_pseudosyntactic(text, chunk_density, eff_lang)


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
        if rf and rf.get("full-path"):
            return rf["full-path"]
    except Exception:
        pass
    for name in zf.namelist():
        if name.lower().endswith(".opf"):
            return name
    return None


def process_epub(
    epub_path: str,
    mode: str,
    chunk_density: str,
    language: str,
) -> tuple[bytes, str]:
    """
    Process every content document in the EPUB.
    Returns (epub_bytes, mode_actually_used).
    """
    with zipfile.ZipFile(epub_path, "r") as zf:
        content_paths = _get_content_doc_paths(zf)
        names = zf.namelist()
        mode_used = mode

        out_buf = io.BytesIO()
        with zipfile.ZipFile(out_buf, "w", compression=zipfile.ZIP_DEFLATED) as out_zf:
            for name in names:
                data = zf.read(name)
                if name in content_paths:
                    try:
                        patched, mu = _patch_document(
                            data, mode, chunk_density, language
                        )
                        data = patched
                        mode_used = mu
                    except Exception:
                        pass
                out_zf.writestr(name, data)

        return out_buf.getvalue(), mode_used
