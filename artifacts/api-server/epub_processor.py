"""
EPUB phrase-spacing injector.

Walks every XHTML content document inside an EPUB and inserts thin-space
characters at phrase boundaries.  Only text nodes are ever touched — tags,
attributes, scripts, styles, and intra-word characters are untouched.

DRM detection: if META-INF/encryption.xml is present and contains <EncryptedData>
entries, the EPUB is considered DRM-protected and is refused.
"""

import os
import re
import zipfile
import tempfile
import shutil
import io
from pathlib import Path
from typing import Literal

from bs4 import BeautifulSoup, NavigableString, Tag

# ---------------------------------------------------------------------------
# Gap characters – width controlled by intensity
# ---------------------------------------------------------------------------

# Thin space U+2009 (~1/5 em), En space U+2002 (~1/2 em), Em space U+2003
GAP_CHARS = {
    "subtle": "\u2009",      # THIN SPACE
    "medium": "\u2002",      # EN SPACE
    "strong": "\u2003",      # EM SPACE
}

# ---------------------------------------------------------------------------
# Simple-mode vocabulary
# ---------------------------------------------------------------------------

STRUCTURE_WORDS = {
    "and", "or", "but", "so", "yet",
    "to", "of", "in", "on", "at", "for", "with", "by", "from", "as",
    "that", "which", "who", "whom", "whose", "when", "where",
    "the", "a", "an",
}

# Sentence-terminal punctuation followed by a space → insert gap after
SENTENCE_END_RE = re.compile(r'([.!?]["\'\u201c\u201d\u2018\u2019]?)\s+')


# ---------------------------------------------------------------------------
# DRM check
# ---------------------------------------------------------------------------

def is_drm_protected(epub_path: str) -> bool:
    """Return True if the EPUB contains DRM encryption entries."""
    with zipfile.ZipFile(epub_path, "r") as zf:
        names_lower = {n.lower() for n in zf.namelist()}
        if "meta-inf/encryption.xml" not in names_lower:
            return False
        # Find actual case
        real_name = next(n for n in zf.namelist() if n.lower() == "meta-inf/encryption.xml")
        content = zf.read(real_name).decode("utf-8", errors="replace")
        # If there are EncryptedData elements, it's DRM
        return "<EncryptedData" in content


# ---------------------------------------------------------------------------
# Text-node patching helpers
# ---------------------------------------------------------------------------

SKIP_TAGS = {"script", "style", "code", "pre", "kbd", "samp", "var"}


def _is_in_skip_tag(node) -> bool:
    for parent in node.parents:
        if isinstance(parent, Tag) and parent.name in SKIP_TAGS:
            return True
    return False


def _patch_text_simple(text: str, gap: str) -> str:
    """Insert gap before structure words and after sentence-end punctuation."""
    # After sentence-terminal punctuation
    text = SENTENCE_END_RE.sub(lambda m: m.group(1) + gap + " ", text)

    # Before structure words (word boundary on both sides)
    for word in STRUCTURE_WORDS:
        pattern = re.compile(
            r'(?<=[^\s])(\s+)(' + re.escape(word) + r')(?=\s)',
            re.IGNORECASE
        )
        text = pattern.sub(lambda m: gap + m.group(1) + m.group(2), text)

    return text


_nlp = None
_nlp_loaded = False
_nlp_failed = False


def _load_spacy():
    global _nlp, _nlp_loaded, _nlp_failed
    if _nlp_loaded:
        return _nlp
    try:
        import spacy
        _nlp = spacy.load("en_core_web_sm")
        _nlp_loaded = True
    except Exception:
        _nlp_failed = True
        _nlp_loaded = True
        _nlp = None
    return _nlp


def spacy_available() -> bool:
    """Return True if the spaCy model loaded successfully."""
    _load_spacy()
    return _nlp is not None


def _patch_text_smart(text: str, gap: str) -> str:
    """Use spaCy to find clause/phrase boundaries and insert gaps."""
    nlp = _load_spacy()
    if nlp is None:
        return _patch_text_simple(text, gap)

    try:
        doc = nlp(text)
        result = []
        prev_end = 0
        for sent in doc.sents:
            # Insert gap before the first token of each sentence (after the first)
            if sent.start > 0:
                result.append(text[prev_end:sent.start_char])
                result.append(gap)
            else:
                result.append(text[prev_end:sent.start_char])

            # Walk tokens inside the sentence to find noun-chunk and prep-phrase starts
            chunk_starts = {chunk.start for chunk in doc.noun_chunks
                            if sent.start <= chunk.start < sent.end}

            for token in sent:
                char_start = token.idx
                char_end = token.idx + len(token.text)

                # Add gap before certain dependency roles that signal phrase breaks
                if token.i > sent.start and token.i in chunk_starts:
                    result.append(gap)

                result.append(text[char_start:char_end])

                # Re-add whitespace that follows the token
                ws = text[char_end:char_end + len(token.whitespace_)]
                result.append(ws)

            prev_end = sent.end_char

        result.append(text[prev_end:])
        return "".join(result)
    except Exception:
        return _patch_text_simple(text, gap)


def _patch_document(
    html_bytes: bytes,
    mode: Literal["simple", "smart"],
    intensity: Literal["subtle", "medium", "strong"],
    encoding: str = "utf-8",
) -> bytes:
    """Parse an XHTML document, patch text nodes, return patched bytes."""
    gap = GAP_CHARS[intensity]

    try:
        soup = BeautifulSoup(html_bytes, "lxml-xml")
    except Exception:
        try:
            soup = BeautifulSoup(html_bytes, "html.parser")
        except Exception:
            return html_bytes  # leave untouched if we can't parse

    patch_fn = _patch_text_smart if mode == "smart" else _patch_text_simple

    for node in soup.find_all(string=True):
        if not isinstance(node, NavigableString):
            continue
        if isinstance(node.parent, Tag) and node.parent.name in {"[document]"}:
            continue
        if _is_in_skip_tag(node):
            continue

        original = str(node)
        patched = patch_fn(original, gap)
        if patched != original:
            node.replace_with(NavigableString(patched))

    return str(soup).encode(encoding, errors="replace")


# ---------------------------------------------------------------------------
# EPUB round-trip
# ---------------------------------------------------------------------------

# MIME types for XHTML content documents
CONTENT_MIME_TYPES = {
    "application/xhtml+xml",
    "text/html",
}


def _get_content_doc_paths(zf: zipfile.ZipFile) -> set[str]:
    """Parse the OPF manifest to find content-document paths."""
    paths = set()
    opf_path = _find_opf(zf)
    if opf_path is None:
        # Fallback: treat any .html/.xhtml as content
        for name in zf.namelist():
            if name.lower().endswith((".xhtml", ".html", ".htm")):
                paths.add(name)
        return paths

    opf_bytes = zf.read(opf_path)
    opf_soup = BeautifulSoup(opf_bytes, "lxml-xml")
    opf_dir = str(Path(opf_path).parent)
    if opf_dir == ".":
        opf_dir = ""

    for item in opf_soup.find_all("item"):
        media_type = item.get("media-type", "").strip().lower()
        href = item.get("href", "")
        if media_type in CONTENT_MIME_TYPES and href:
            # Resolve relative to OPF directory
            if opf_dir:
                full = opf_dir + "/" + href
            else:
                full = href
            # Normalize
            full = str(Path(full))
            paths.add(full)

    return paths


def _find_opf(zf: zipfile.ZipFile) -> str | None:
    """Find the OPF file path from META-INF/container.xml."""
    try:
        container = zf.read("META-INF/container.xml")
        soup = BeautifulSoup(container, "lxml-xml")
        rootfile = soup.find("rootfile")
        if rootfile:
            return rootfile.get("full-path")
    except Exception:
        pass
    # Fallback
    for name in zf.namelist():
        if name.lower().endswith(".opf"):
            return name
    return None


def process_epub(
    input_path: str,
    mode: Literal["simple", "smart"],
    intensity: Literal["subtle", "medium", "strong"],
) -> tuple[bytes, bool]:
    """
    Process an EPUB file and return (processed_bytes, fell_back_to_simple).

    fell_back_to_simple is True when Smart mode was requested but spaCy
    was unavailable and Simple mode was used instead.
    """
    fell_back = False
    if mode == "smart" and not spacy_available():
        mode = "simple"
        fell_back = True

    with zipfile.ZipFile(input_path, "r") as zf_in:
        content_paths = _get_content_doc_paths(zf_in)
        # Normalise separators for comparison
        content_paths_norm = {p.replace("\\", "/") for p in content_paths}

        out_buf = io.BytesIO()
        with zipfile.ZipFile(out_buf, "w", compression=zipfile.ZIP_DEFLATED) as zf_out:
            # mimetype MUST be first and STORED (not deflated)
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

                if norm in content_paths_norm:
                    try:
                        patched = _patch_document(raw, mode, intensity)
                    except Exception:
                        patched = raw  # leave untouched on error

                    info = zipfile.ZipInfo(item.filename)
                    info.compress_type = zipfile.ZIP_DEFLATED
                    zf_out.writestr(info, patched)
                else:
                    zf_out.writestr(item, raw)

    return out_buf.getvalue(), fell_back
