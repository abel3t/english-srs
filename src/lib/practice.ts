// Pure helpers for the review modes, shared by the browser and the tests.
import type { Rating } from './srs';

const normalizeWord = (word: string) => word.toLowerCase().replace(/[’‘]/g, "'").replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '');

// Finds the key expression inside its sentence even when it is inflected there
// ("boil down to" in "it boils down to"): short words must match, longer ones may differ after 4 letters.
export function findPhraseSpan(sentence: string, keyExpression: string): { start: number; end: number } | null {
  const keys = keyExpression.split(/\s+/).map(normalizeWord).filter(Boolean);
  if (!keys.length) return null;
  const words = [...sentence.matchAll(/\S+/g)].map(match => ({ word: normalizeWord(match[0]), start: match.index!, end: match.index! + match[0].replace(/[^\p{L}\p{N}']+$/u, '').length }));
  const same = (word: string, key: string) => word === key || (key.length >= 4 && word.length >= 4 && word.slice(0, 4) === key.slice(0, 4));
  for (let i = 0; i + keys.length <= words.length; i++) {
    if (keys.every((key, k) => same(words[i + k].word, key))) return { start: words[i].start, end: words[i + keys.length - 1].end };
  }
  return null;
}

const blank = (text: string) => text.replace(/[^\s]/g, '_');

// Blank out the key expression when it can be found; otherwise one longer word.
export function makeCloze(phrase: string, keyExpression: string, random = Math.random): string {
  const span = findPhraseSpan(phrase, keyExpression);
  if (span) return phrase.slice(0, span.start) + blank(phrase.slice(span.start, span.end)) + phrase.slice(span.end);
  const stop = new Set(['this', 'that', 'with', 'from', 'have', 'your', 'what', 'when', 'where', 'which', 'would', 'could', 'should', 'about', 'there', 'their']);
  const words = [...phrase.matchAll(/[A-Za-z][A-Za-z'-]{3,}/g)].filter(match => !stop.has(match[0].toLowerCase()));
  const chosen = words.length ? words[Math.floor(random() * words.length)] : null;
  return chosen ? phrase.slice(0, chosen.index) + blank(chosen[0]) + phrase.slice(chosen.index! + chosen[0].length) : phrase;
}

// Recall typing: type the key expression as it appears in the sentence, or the whole phrase when there is none.
export function typingTask(phrase: string, keyExpression: string): { prompt: string | null; target: string } {
  const span = findPhraseSpan(phrase, keyExpression);
  if (!span) return { prompt: null, target: phrase.trim() };
  return { prompt: phrase.slice(0, span.start) + '____' + phrase.slice(span.end), target: phrase.slice(span.start, span.end) };
}

export type DictationToken = { word: string; status: 'ok' | 'missing' | 'wrong'; typed?: string };
export type DictationResult = { tokens: DictationToken[]; extra: string[]; accuracy: number; insights: string[] };

const FUNCTION_WORDS = new Set(['a', 'an', 'the', 'to', 'of', 'and', 'or', 'for', 'in', 'on', 'at', 'is', 'are', 'was', 'were', 'be', 'it', 'that', 'have', 'has', 'had', 'will', 'would', 'can', 'could', 'do', 'does', 'you', 'we', 'they', 'he', 'she', 'i', 'as', 'but', 'if', 'so', 'than', 'then']);
const isEndingSlip = (expected: string, typed: string) => {
  const [long, short] = expected.length > typed.length ? [expected, typed] : [typed, expected];
  return long.startsWith(short) && /^(s|es|d|ed|ing)$/.test(long.slice(short.length));
};

// Word-level edit-distance alignment, so a wrong word shows as "you typed X" rather than a miss plus an extra.
export function compareDictation(expected: string, typed: string): DictationResult {
  const want = expected.split(/\s+/).filter(Boolean);
  const got = typed.split(/\s+/).filter(Boolean);
  const a = want.map(normalizeWord), b = got.map(normalizeWord);
  const cost = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    cost[i][j] = Math.min(cost[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), cost[i - 1][j] + 1, cost[i][j - 1] + 1);
  }
  const tokens: DictationToken[] = [];
  const extra: string[] = [];
  let i = a.length, j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && cost[i][j] === cost[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      tokens.unshift(a[i - 1] === b[j - 1] ? { word: want[i - 1], status: 'ok' } : { word: want[i - 1], status: 'wrong', typed: got[j - 1] }); i--; j--;
    } else if (i > 0 && cost[i][j] === cost[i - 1][j] + 1) {
      tokens.unshift({ word: want[i - 1], status: 'missing' }); i--;
    } else {
      extra.unshift(got[j - 1]); j--;
    }
  }

  const misses = tokens.filter(token => token.status !== 'ok');
  const insights: string[] = [];
  if (misses.some(token => FUNCTION_WORDS.has(normalizeWord(token.word)))) insights.push('Small words like “the”, “to”, “of” are unstressed and squeezed in fast speech. Listen for the weak sounds between the main words.');
  if (misses.some(token => token.typed && isEndingSlip(normalizeWord(token.word), normalizeWord(token.typed)))) insights.push('Word endings (-s, -ed, -ing) are short and easy to miss. They change the tense or number, so listen to the very end of each word.');
  if (misses.some(token => normalizeWord(token.word).includes("'"))) insights.push('Contractions (it’s, they’re, won’t) are said as one quick sound.');
  const accuracy = want.length ? (tokens.length - misses.length) / Math.max(want.length, want.length + extra.length * 0.5) : 0;
  return { tokens, extra, accuracy: Math.round(accuracy * 100) / 100, insights };
}

export function suggestDictationRating(accuracy: number, replays: number): Rating {
  if (accuracy === 1) return replays === 0 ? 'easy' : 'good';
  return accuracy >= 0.8 ? 'hard' : 'again';
}

export function suggestTypingRating(result: { errors: number; gaveUp: boolean; seconds: number }): Rating {
  if (result.gaveUp) return 'again';
  if (result.errors === 0) return result.seconds <= 8 ? 'easy' : 'good';
  return result.errors <= 2 ? 'hard' : 'again';
}

export const MAX_RECORDING_SECONDS = 90;

// One capture group, so String.split(FILLER) puts the fillers at odd indexes.
export const FILLER = /\b(uh+|um+|erm+|uhm+|hmm+|ah+|you know|i mean|kind of|sort of)\b/gi;

// Speaking metrics come from the verbatim transcript, so they are consistent between attempts.

export function speakingMetrics(transcript: string, durationSeconds: number): { wordsPerMinute: number; fillers: number; words: number } {
  const fillers = transcript.match(FILLER)?.length ?? 0;
  const words = transcript.replace(FILLER, ' ').replace(/\[unclear\]/gi, ' ').split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word)).length;
  return { words, fillers, wordsPerMinute: durationSeconds > 0 ? Math.round(words / (durationSeconds / 60)) : 0 };
}
