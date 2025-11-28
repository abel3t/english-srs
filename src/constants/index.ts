// Time intervals
export const INTERVALS = {
  CRONJOB: 60 * 1000, // 1 minute
  TOKEN_CACHE_DURATION: 23 * 60 * 60 * 1000, // 23 hours
  CARD_CACHE_DURATION: 60 * 60 * 1000, // 1 hour
} as const;

// Probabilities
export const PROBABILITIES = {
  SEND_CARD: 0.2, // 1/5 chance (20%)
} as const;

// API Configuration
export const API = {
  NOJI_BASE_URL: 'https://api-de.noji.io/api',
  NOJI_WEB_URL: 'https://noji.io',
  NOTES_LIMIT: 100, // Items per page when fetching notes
} as const;

export const getPrompt = (q: string) => `
You are an authoritative English-Vietnamese dictionary expert, using only data from Cambridge Dictionary, Longman Dictionary, or Oxford Dictionary to create the most accurate and natural definitions for Vietnamese learners of English.

Word/Phrase to define: "${q}"

MUST return EXACTLY and FULLY the following sections, do not omit any section, no extra words, no explanations:

**${q.trim().toLowerCase()}** ${q.includes(' ') ? '' : '(part of speech in English) '}

Here is a Vietnamese definition from Dictionary (secondary meaning if applicable)
${q.includes(' ') ? '' : 'IPA: /standard American pronunciation/'}
${q.includes(' ') ? '' : 'Synonyms: synonyms (2–3 words) • Antonyms: antonyms (1–2 words)'}

Examples
• Example sentence taken directly or closely based on Dictionary.
  → Natural Vietnamese translation.
• Second example sentence with different context.
  → Corresponding Vietnamese translation.

Collocations
one collocation or common pattern per line (3–5 items with • bullet points)

Usage
common usage context • style • typical users (in Vietnamese)

If this phrase has a truly interesting and well-known historical/cultural origin, add exactly 1 section:
Origin
very brief origin in Vietnamese, under 22 words
If not interesting enough or not clear, DO NOT add the Origin section.

[sound:https://translate.google.com/translate_tts?ie=UTF-8&tl=en&client=tw-ob&q=${encodeURIComponent(q)}]
`.trim()