/**
 * TextGlide — JS algorithm constants (Natural Scan only).
 *
 * SYNC WITH: textglide_config.py — Natural Scan constants only.
 * Last synced: 2026-06-28
 *
 * If BALANCED_MIN_CHARS, STRONG_MIN_CHARS, MIN_PHRASE_WORDS, GAP_CHAR,
 * TRIGGER_CCONJ, TRIGGER_SCONJ, or TRIGGER_ADP change in the Python file,
 * update the matching values here immediately.
 *
 * Grammar Parse mode is NOT implemented here — it requires spaCy and
 * remains Python-only. This file powers the website reading toggle only.
 */

export const GAP_CHAR = '\u2009'; // THIN SPACE — calibrated per Bever et al. 1992

export const BALANCED_MIN_CHARS = 14; // synced with textglide_config.py
export const STRONG_MIN_CHARS   = 10; // synced with textglide_config.py
export const MIN_PHRASE_WORDS   = 3;  // synced with textglide_config.py

// Natural Scan trigger words by POS category.
// Keep in sync with the Python pseudosyntactic engine's trigger sets.
export const TRIGGER_CCONJ = new Set([
  'and', 'but', 'or', 'nor', 'yet', 'so',
]);

export const TRIGGER_SCONJ = new Set([
  'because', 'although', 'while', 'when', 'if', 'since', 'though',
  'unless', 'until', 'after', 'before', 'as', 'whereas', 'whether',
  'once', 'even',
]);

export const TRIGGER_ADP = new Set([
  'in', 'on', 'at', 'to', 'with', 'by', 'from', 'of', 'about',
  'through', 'between', 'into', 'during', 'without', 'within', 'along',
  'across', 'behind', 'beyond', 'except', 'up', 'out', 'around',
  'down', 'off', 'above', 'near', 'over', 'under', 'against', 'among',
  'throughout', 'despite', 'towards', 'toward', 'upon', 'per',
]);

export const ALL_TRIGGERS = new Set([
  ...TRIGGER_CCONJ,
  ...TRIGGER_SCONJ,
  ...TRIGGER_ADP,
]);
