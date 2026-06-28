import { GAP_CHAR, BALANCED_MIN_CHARS, MIN_PHRASE_WORDS, ALL_TRIGGERS } from './textglide_config.js';

/**
 * Apply Natural Scan phrase spacing to a plain text string.
 * Returns a new string with U+2009 thin-space gaps inserted at phrase boundaries.
 * Always uses Balanced density (BALANCED_MIN_CHARS = 14).
 *
 * Algorithm mirrors the Python pseudosyntactic engine in epub_processor.py.
 * Sync any logic changes with that file.
 */
export function applyNaturalScan(text: string): string {
  if (!text || text.trim().length === 0) return text;

  // Split on whitespace, preserving tokens with their trailing punctuation.
  const rawTokens = text.split(/(\s+)/);
  const tokens: string[] = [];
  const spaces: string[] = [];

  for (let i = 0; i < rawTokens.length; i++) {
    if (i % 2 === 0) tokens.push(rawTokens[i]);
    else spaces.push(rawTokens[i]);
  }

  const result: string[] = [];
  let chunkCharCount = 0;
  let chunkWordCount = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const space = spaces[i] ?? '';
    const word = token.replace(/^[^\w]+|[^\w]+$/g, '').toLowerCase();
    const isTrigger = ALL_TRIGGERS.has(word);

    if (
      isTrigger &&
      chunkCharCount >= BALANCED_MIN_CHARS &&
      chunkWordCount >= MIN_PHRASE_WORDS &&
      i > 0
    ) {
      // Insert gap before this trigger word
      result.push(GAP_CHAR + token + space);
      chunkCharCount = token.length;
      chunkWordCount = 1;
    } else {
      result.push(token + space);
      chunkCharCount += token.length + space.length;
      chunkWordCount += 1;
    }
  }

  return result.join('');
}
