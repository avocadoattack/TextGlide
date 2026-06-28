"""
TextGlide — algorithm calibration (single source of truth).

All thresholds, gap characters, and trigger sets live here.
Both the Natural Scan and Grammar Parse engines
read their parameters from this module.
"""

# ---------------------------------------------------------------------------
# Gap characters
# ---------------------------------------------------------------------------

# Primary gap: THIN SPACE (U+2009, ~1/5 em).
# Calibrated centre supported by Jandreau, Muncer & Bever 1986 and Bever et al.
# 1992: gap magnitude above a perceptible threshold does not significantly change
# readability, so we use the narrowest clearly-perceptible gap (~1.8x a normal
# word space).
GAP_CHAR = "\u2009"  # THIN SPACE — used in all output

# Unused wider fallback, reserved for future A/B testing only. Not exposed to users.
# EN SPACE (U+2002, ~1/2 em).
_GAP_CHAR_WIDE = "\u2002"  # EN SPACE — do not use in production

# ---------------------------------------------------------------------------
# Chunk-density tiers
# ---------------------------------------------------------------------------

# Balanced — break at coordinating/subordinating conjunctions and prepositions.
# Minimum 14 characters in the left-hand chunk before a break is allowed.
# 14 chars ≈ 2.5-word average chunk, grounded in Bever et al. 1992 (phrase-tree
# stops at phrases under ~3 words) and Jandreau & Bever 1992.
# POS triggers: CCONJ, SCONJ, ADP (prepositions).
BALANCED_MIN_CHARS = 14
BALANCED_LEVEL = 2

# Strong — adds relative pronouns/clauses (who, which, whom) on top of Balanced.
# Minimum 10 characters before a break (raised from 7 in the old "obvious" tier
# to prevent over-fragmentation of short phrases).
# Especially beneficial for developing readers and dense material
# (Magloire 2002; Walker et al. 2005 VSTF: up to ~40% comprehension gain with
# finer cueing).
STRONG_MIN_CHARS = 10
STRONG_LEVEL = 3

# Minimum phrase length (words). Chunks shorter than this are never broken further.
# Grounded in Bever et al. 1992: phrase-tree stops at phrases under ~3 words.
MIN_PHRASE_WORDS = 3

# ---------------------------------------------------------------------------
# Convenience lookup for epub_processor
# ---------------------------------------------------------------------------

DENSITY_CFG: dict[str, dict] = {
    "balanced": {"min_chars": BALANCED_MIN_CHARS, "level": BALANCED_LEVEL},
    "strong":   {"min_chars": STRONG_MIN_CHARS,   "level": STRONG_LEVEL},
}
