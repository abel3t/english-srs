// Finds learnable phrases in book text without AI. Runs in a Web Worker on the Import page.
//  1. Dictionary matching: ~16k Wiktionary phrasal verbs/idioms/prepositional phrases plus hand-written
//     workplace frames, matched on lemmas, with slots ("loop someone in") and separable verbs ("figure it out").
//  2. Collocations: verb+noun, adjective+preposition and adverb+adjective pairs that co-occur far more than
//     chance (Dunning log-likelihood).
//  3. Advanced single words: verbs/adjectives/adverbs of mid-low general frequency (not jargon, not basic).
// Each candidate is scored by type, frequency, spread across chapters and difficulty band, and gets the
// most dictionary-like example sentence from the book.
import nlp from 'compromise';

export type PhraseKind = 'frame' | 'phrasal_verb' | 'idiom' | 'prep_phrase' | 'collocation' | 'word';
export type FoundPhrase = { phrase: string; kind: PhraseKind; band: number; score: number; count: number; chapters: number; example: string };
export type FinderData = { entries: Array<{ text: string; words: string[]; kind: PhraseKind; gap: boolean }>; zipf: Map<string, number> };

const STOP = new Set('a an the to of and or for in on at by with from as is are was were be been being am it its this that these those i you he she we they me him her us them my your his our their not no do does did have has had will would can could should may might must shall so if than then but just also very there here what which who whom whose when where why how all any some each every one two up out off over into about'.split(' '));
const POSSESSIVES = new Set(['my', 'your', 'his', 'her', 'its', 'our', 'their']);
const BE = new Set(['is', 'are', 'was', 'were', 'been', 'being', 'am', "'s", "'re", "'m"]);
const LIGHT_VERBS = new Set(['be', 'have', 'do', 'say', 'let', 'can', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'get', 'go', 'see', 'use', 'need', 'want', 'like', 'know', 'think']);
const KIND_BASE: Record<PhraseKind, number> = { frame: 3, phrasal_verb: 2.2, idiom: 2, prep_phrase: 1.6, collocation: 1.4, word: 1.1 };
const BAND_BONUS = [-0.3, 0.4, 0.5, -0.8];
const SLOT = '*', POSSESSIVE = '#';

export function parseFinderData(expressions: { kinds: string[]; entries: Array<[string, number, number]> }, frequencies: string): FinderData {
  const zipf = new Map<string, number>();
  for (const line of frequencies.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [word, value] = line.split('\t');
    zipf.set(word, Number(value));
  }
  const slot = (word: string) => (/^(one's|someone's|somebody's)$/.test(word) ? POSSESSIVE : /^(someone|somebody|something|oneself|sb|sth)$/.test(word) ? SLOT : BE.has(word) ? 'be' : word);
  return {
    zipf,
    entries: expressions.entries.map(([text, kind, gap]) => ({ text, words: text.split(/[\s-]+/).filter(Boolean).map(slot), kind: expressions.kinds[kind] as PhraseKind, gap: gap === 1 })),
  };
}

type Token = { text: string; normal: string; lemma: string; verb: boolean; noun: boolean; adjective: boolean; adverb: boolean; preposition: boolean; determiner: boolean; proper: boolean };

function tokenize(sentence: { terms: Array<{ text: string; normal?: string; root?: string; tags?: string[] }> }): Token[] {
  return sentence.terms.map(term => {
    const tags = new Set(term.tags ?? []);
    const normal = (term.normal ?? term.text).toLowerCase().replace(/[’‘]/g, "'").replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, '');
    const verb = tags.has('Verb') && !tags.has('Auxiliary');
    let lemma = normal;
    if (BE.has(normal) || term.root === 'is') lemma = 'be';
    else if ((tags.has('Verb') || (tags.has('Noun') && tags.has('Plural'))) && term.root) lemma = term.root.toLowerCase();
    return {
      text: term.text, normal, lemma, verb, noun: tags.has('Noun') && !tags.has('Pronoun'), adjective: tags.has('Adjective'),
      adverb: tags.has('Adverb'), preposition: tags.has('Preposition'), determiner: tags.has('Determiner') || tags.has('Possessive'),
      proper: tags.has('ProperNoun') || tags.has('Acronym'),
    };
  });
}

const same = (token: Token | undefined, word: string) => !!token && (token.lemma === word || token.normal === word);
const isPossessive = (token: Token | undefined) => !!token && (POSSESSIVES.has(token.normal) || token.normal.endsWith("'s"));

// Returns the index after the match, or -1.
function matchAt(words: string[], gap: boolean, tokens: Token[], start: number): number {
  let t = start;
  for (let k = 0; k < words.length; k++) {
    const word = words[k];
    if (word === SLOT) {
      const next = words[k + 1];
      if (next === undefined) { if (!tokens[t]) return -1; t += 1; continue; }
      let found = -1;
      for (let span = 1; span <= 3 && found < 0; span++) if (same(tokens[t + span], next) && !tokens.slice(t, t + span).some(token => token.verb)) found = t + span;
      if (found < 0) return -1;
      t = found; continue;
    }
    if (word === POSSESSIVE) { if (!isPossessive(tokens[t])) return -1; t += 1; continue; }
    if (!same(tokens[t], word)) {
      // Separable verb: "figure [it] out", "take [his concerns] into account".
      if (k === 1 && gap) {
        let found = -1;
        for (let span = 1; span <= 3 && found < 0; span++) if (same(tokens[t + span], word) && !tokens.slice(t, t + span).some(token => token.verb || !token.normal)) found = t + span;
        if (found < 0) return -1;
        t = found + 1; continue;
      }
      return -1;
    }
    t += 1;
  }
  return t;
}

// Dunning's log-likelihood ratio for a word pair.
function logLikelihood(pair: number, first: number, second: number, total: number): number {
  const cells = [[pair, first - pair], [second - pair, total - first - second + pair]];
  const rows = [first, total - first], cols = [second, total - second];
  let sum = 0;
  for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
    const observed = cells[r][c];
    if (observed > 0) sum += observed * Math.log((observed * total) / (rows[r] * cols[c]));
  }
  return 2 * sum;
}

// Dictionary-example heuristics: medium length, self-contained, no symbols or other rare words.
function exampleQuality(sentence: string, tokens: Token[], zipf: Map<string, number>): number {
  const words = tokens.filter(token => token.normal).length;
  let score = -Math.abs(words - 16) / 4;
  if (words < 6 || words > 35) score -= 3;
  if (/^(it|this|that|these|those|they|he|she|such)\b/i.test(sentence.trim())) score -= 1;
  if (/[\d{}()[\]<>=_/\\|#@]/.test(sentence)) score -= 1.5;
  if (!/[.!?]["”’)]?$/.test(sentence.trim())) score -= 1;
  score -= 0.5 * tokens.filter(token => token.normal && (zipf.get(token.normal) ?? 0) < 2.5).length;
  return score;
}

type Tally = { phrase: string; kind: PhraseKind; count: number; chapters: Set<number>; example: string; exampleScore: number; contentWords: string[]; surfaces?: Map<string, number> };

export function findPhrases(chapters: Array<{ title: string; text: string }>, data: FinderData, onProgress?: (done: number, total: number) => void, limit = 200): FoundPhrase[] {
  const byFirstWord = new Map<string, FinderData['entries']>();
  for (const entry of data.entries) {
    const first = entry.words[0];
    if (first === SLOT || first === POSSESSIVE) continue;
    (byFirstWord.get(first) ?? byFirstWord.set(first, []).get(first)!).push(entry);
  }
  const zipfOf = (word: string) => data.zipf.get(word) ?? 0;
  const tallies = new Map<string, Tally>();
  const lemmaCounts = new Map<string, number>();
  const pairCounts = new Map<string, { count: number; first: string; second: string; kind: 'vn' | 'ap' | 'ra'; chapters: Set<number>; surfaces: Map<string, number>; example: string; exampleScore: number }>();
  let totalTokens = 0;

  const record = (key: string, phrase: string, kind: PhraseKind, chapter: number, sentence: string, quality: number, contentWords: string[]) => {
    const tally = tallies.get(key) ?? tallies.set(key, { phrase, kind, count: 0, chapters: new Set(), example: sentence, exampleScore: -Infinity, contentWords }).get(key)!;
    tally.count += 1; tally.chapters.add(chapter);
    if (quality > tally.exampleScore) { tally.example = sentence; tally.exampleScore = quality; }
  };

  chapters.forEach((chapter, chapterIndex) => {
    const doc = nlp(chapter.text);
    doc.compute('root');
    // `terms: true` (all term fields, including `root` from compute('root')) is supported at runtime but not in the typings.
    const sentences = (doc.json as (options: object) => Array<{ text: string; terms: Array<{ text: string; normal?: string; root?: string; tags?: string[] }> }>)({ terms: true });
    for (const sentence of sentences) {
      const tokens = tokenize(sentence);
      const text = sentence.text.trim();
      if (tokens.length < 3) continue;
      const quality = exampleQuality(text, tokens, data.zipf);
      const covered = new Set<number>();
      totalTokens += tokens.length;

      tokens.forEach((token, i) => {
        if (token.normal) lemmaCounts.set(token.lemma, (lemmaCounts.get(token.lemma) ?? 0) + 1);
        // 1. dictionary expressions: longest match at the earliest start; words inside it are not matched again
        if (covered.has(i)) return;
        const candidates = [...(byFirstWord.get(token.lemma) ?? []), ...(token.normal !== token.lemma ? byFirstWord.get(token.normal) ?? [] : [])];
        let best: { entry: FinderData['entries'][number]; end: number } | null = null;
        for (const entry of candidates) {
          const end = matchAt(entry.words, entry.gap, tokens, i);
          if (end > 0 && (!best || entry.words.length > best.entry.words.length)) best = { entry, end };
        }
        if (best) {
          for (let k = i; k < best.end; k++) covered.add(k);
          record(`x:${best.entry.text}`, best.entry.text, best.entry.kind, chapterIndex, text, quality, best.entry.words.filter(word => word !== SLOT && word !== POSSESSIVE && !STOP.has(word)));
        }
      });

      tokens.forEach((token, i) => {
        // 2. collocation pairs (skipping words already inside a dictionary expression)
        if (covered.has(i)) return;
        const pair = (j: number, kind: 'vn' | 'ap' | 'ra') => {
          const second = tokens[j];
          if (!second || covered.has(j) || second.proper || zipfOf(second.lemma) < 3) return;
          const key = `${kind}:${token.lemma} ${second.lemma}`;
          const surface = tokens.slice(i, j + 1).map(item => item.normal).join(' ');
          const entry = pairCounts.get(key) ?? pairCounts.set(key, { count: 0, first: token.lemma, second: second.lemma, kind, chapters: new Set(), surfaces: new Map(), example: text, exampleScore: -Infinity }).get(key)!;
          entry.count += 1; entry.chapters.add(chapterIndex); entry.surfaces.set(surface, (entry.surfaces.get(surface) ?? 0) + 1);
          if (quality > entry.exampleScore) { entry.example = text; entry.exampleScore = quality; }
        };
        if (token.verb && !LIGHT_VERBS.has(token.lemma)) {
          let j = i + 1;
          while (tokens[j] && (tokens[j].determiner || tokens[j].adjective) && j - i <= 3) j++;
          if (tokens[j]?.noun) pair(j, 'vn');
        }
        if (token.adjective && tokens[i + 1]?.preposition) pair(i + 1, 'ap');
        if (token.adverb && token.normal.endsWith('ly') && (tokens[i + 1]?.adjective || tokens[i + 1]?.verb)) pair(i + 1, 'ra');

        // 3. advanced single words
        const zipf = zipfOf(token.lemma);
        if ((token.verb || token.adjective || token.adverb) && !token.proper && token.lemma.length >= 4 && zipf >= 2.8 && zipf <= 4.3 && !STOP.has(token.lemma)) {
          record(`w:${token.lemma}`, token.lemma, 'word', chapterIndex, text, quality, [token.lemma]);
        }
      });
    }
    onProgress?.(chapterIndex + 1, chapters.length);
  });

  for (const [key, pair] of pairCounts) {
    if (pair.count < 3) continue;
    const g2 = logLikelihood(pair.count, lemmaCounts.get(pair.first) ?? pair.count, lemmaCounts.get(pair.second) ?? pair.count, totalTokens);
    if (g2 < 15) continue;
    const surface = [...pair.surfaces.entries()].sort((a, b) => b[1] - a[1])[0][0];
    tallies.set(key, { phrase: surface, kind: 'collocation', count: pair.count, chapters: pair.chapters, example: pair.example, exampleScore: pair.exampleScore, contentWords: [pair.first, pair.second].filter(word => !STOP.has(word)) });
  }

  // A word that is part of a found expression ("tightly" in "tightly coupled") is not offered on its own.
  const inExpressions = new Set([...tallies.values()].filter(tally => tally.kind !== 'word').flatMap(tally => tally.contentWords));
  const results: FoundPhrase[] = [];
  for (const tally of tallies.values()) {
    if (tally.kind === 'word' && inExpressions.has(tally.phrase)) continue;
    if (tally.kind === 'word' && tally.count < 2) continue;
    const minZipf = tally.contentWords.length ? Math.min(...tally.contentWords.map(zipfOf)) : 5;
    const band = minZipf >= 5 ? 0 : minZipf >= 4 ? 1 : minZipf >= 3 ? 2 : 3;
    const score = KIND_BASE[tally.kind] + 0.7 * Math.log2(1 + Math.min(tally.count, 15)) + (tally.chapters.size >= 2 ? 0.6 : 0) + (tally.chapters.size >= 4 ? 0.3 : 0)
      + BAND_BONUS[band] + Math.max(-1, Math.min(0.5, tally.exampleScore / 4));
    results.push({ phrase: tally.phrase, kind: tally.kind, band, score: Math.round(score * 100) / 100, count: tally.count, chapters: tally.chapters.size, example: tally.example });
  }
  // Keep the list mostly multi-word: single words are capped at 40%.
  let words = 0;
  return results.sort((a, b) => b.score - a.score).filter(result => result.kind !== 'word' || ++words <= limit * 0.4).slice(0, limit);
}
