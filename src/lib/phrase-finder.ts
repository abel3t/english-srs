// Finds learnable phrases in book text without AI. Runs in a Web Worker on the Import page.
//  1. Dictionary matching: ~16k Wiktionary phrasal verbs/idioms/prepositional phrases plus hand-written
//     workplace frames, matched on lemmas, with slots ("loop someone in") and separable verbs ("figure it out").
//  2. Collocations: verb+noun, adjective+preposition and adverb+adjective pairs that co-occur far more than
//     chance (Dunning log-likelihood).
//  3. Reference phrases: any 2-4 word stretch that is a strongly associated phrase in a large sample of spoken
//     and written English (scripts/build-reference-ngrams.py), so fixed phrases no dictionary lists are found too.
//  4. Advanced single words: mid-low general frequency, excluding jargon (frequent in the book, rare in speech).
// Each candidate is scored by type, frequency, spread across chapters and difficulty band, and gets the
// most dictionary-like example sentence from the book.
import nlp from 'compromise';
import { isBasicPhrase } from './basic-phrases';
import { foldWord, type ReferenceData } from './reference-data';

export type PhraseKind = 'frame' | 'phrasal_verb' | 'idiom' | 'prep_phrase' | 'collocation' | 'word';
export type FoundPhrase = { phrase: string; kind: PhraseKind; band: number; score: number; count: number; chapters: number; example: string };
export type FinderData = { entries: Array<{ text: string; words: string[]; kind: PhraseKind; gap: boolean }>; zipf: Map<string, number>; reference?: ReferenceData };

const STOP = new Set('a an the to of and or for in on at by with from as is are was were be been being am it its this that these those i you he she we they me him her us them my your his our their not no do does did have has had will would can could should may might must shall so if than then but just also very there here what which who whom whose when where why how all any some each every one two up out off over into about'.split(' '));
const POSSESSIVES = new Set(['my', 'your', 'his', 'her', 'its', 'our', 'their']);
const BE = new Set(['is', 'are', 'was', 'were', 'been', 'being', 'am', "'s", "'re", "'m"]);
// Verbs too general to form a verb+noun collocation on their own.
const GENERAL_VERBS = new Set(['be', 'have', 'do', 'say', 'let', 'can', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'get', 'go', 'see', 'use', 'need', 'want', 'like', 'know', 'think']);
// Light verbs carry little meaning; the noun after them forms the expression ("take place", "make sense", "pay attention").
// ("have" and "do" are left out: "have features", "do a build" are almost never expressions.)
const LIGHT_VERBS = new Set(['make', 'take', 'give', 'pay', 'play', 'draw', 'reach', 'raise', 'gain', 'keep', 'meet', 'bring', 'put', 'hold', 'lose', 'come']);
// Degree adverbs form real collocations with adjectives/participles ("highly available", "loosely coupled").
const INTENSIFIERS = new Set('highly widely loosely tightly fully clearly closely heavily largely deeply strongly absolutely extremely particularly relatively slightly significantly greatly immensely entirely completely easily readily commonly perfectly reasonably fairly potentially increasingly'.split(' '));
// Standard linking words: short, very reusable in speaking and writing.
const LINKERS = new Set('therefore thus hence moreover furthermore nevertheless nonetheless consequently accordingly likewise similarly conversely meanwhile subsequently otherwise whereas whereby albeit namely notably arguably essentially ultimately primarily merely regardless presumably admittedly undoubtedly inevitably alternatively additionally initially thereby specifically respectively'.split(' '));
const DEPENDENT_PREPOSITIONS = new Set(['to', 'of', 'for', 'with', 'by', 'about', 'on', 'in', 'from', 'at', 'against', 'toward', 'towards']);
const COMPLEX_PREP_START = new Set(['in', 'on', 'at', 'for', 'with', 'by', 'under', 'over', 'as', 'from', 'within']);
const COMPLEX_PREP_END = new Set(['of', 'to', 'for', 'with', 'from']);
const PURE_PREPOSITIONS = new Set(['to', 'in', 'on', 'at', 'for', 'with', 'from', 'of', 'by', 'into']);
const NUMBER_WORDS = new Set('one two three four five six seven eight nine ten hundred hundreds thousand thousands million millions billion billions tens dozen dozens'.split(' '));
const NOT_A_PHRASE_START = new Set(['more', 'most', 'less', 'least', 'very', 'too', 'so', 'how', 'much', 'many']);
const KIND_BASE: Record<PhraseKind, number> = { frame: 3, phrasal_verb: 2.2, idiom: 2, prep_phrase: 1.6, collocation: 1.4, word: 1.1 };
const BAND_BONUS = [-0.3, 0.4, 0.5, -0.8];
const SLOT = '*', POSSESSIVE = '#';
// Reference thresholds ("fair" normalized PMI, see scripts/build-reference-ngrams.py), tuned with pnpm eval:phrases.
export const REFERENCE_TUNING = { discover: 0.30, phrasalVerb: 0.25, bonusCenter: 0.35, burstiness: 1.4, basicSpokenPerMillion: 80, unattested: 0.8 };

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

type Token = { text: string; normal: string; lemma: string; verb: boolean; participle: boolean; noun: boolean; adjective: boolean; adverb: boolean; preposition: boolean; determiner: boolean; proper: boolean; article: boolean };

function tokenize(sentence: { terms: Array<{ text: string; normal?: string; root?: string; tags?: string[] }> }): Token[] {
  return sentence.terms.map(term => {
    const tags = new Set(term.tags ?? []);
    const normal = (term.normal ?? term.text).toLowerCase().replace(/[’‘]/g, "'").replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, '');
    const verb = tags.has('Verb') && !tags.has('Auxiliary');
    let lemma = normal;
    if (BE.has(normal) || term.root === 'is') lemma = 'be';
    else if ((tags.has('Verb') || (tags.has('Noun') && tags.has('Plural'))) && term.root) lemma = term.root.toLowerCase();
    return {
      text: term.text, normal, lemma, verb, participle: verb && (tags.has('Participle') || tags.has('PastTense')) && !normal.endsWith('ing'),
      noun: tags.has('Noun') && !tags.has('Pronoun'), adjective: tags.has('Adjective'), article: normal === 'the' || normal === 'a' || normal === 'an',
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

type Tally = { phrase: string; kind: PhraseKind; count: number; chapters: Set<number>; example: string; exampleScore: number; contentWords: string[]; penalty?: number; folded?: string };

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
  // How often each lemma is capitalized mid-sentence: mostly-capitalized words are names ("Apache", "Flickr").
  const capitalized = new Map<string, number>();
  const pairCounts = new Map<string, { count: number; first: string; second: string; chapters: Set<number>; surfaces: Map<string, number>; example: string; exampleScore: number }>();
  let totalTokens = 0;

  const record = (key: string, phrase: string, kind: PhraseKind, chapter: number, sentence: string, quality: number, contentWords: string[], penalty = 0, folded?: string) => {
    const tally = tallies.get(key) ?? tallies.set(key, { phrase, kind, count: 0, chapters: new Set(), example: sentence, exampleScore: -Infinity, contentWords, penalty, folded }).get(key)!;
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
        if (i > 0 && /^[A-Z]/.test(token.text)) capitalized.set(token.lemma, (capitalized.get(token.lemma) ?? 0) + 1);
        // 1. dictionary expressions: longest match at the earliest start; words inside it are not matched again
        if (covered.has(i)) return;
        const candidates = [...(byFirstWord.get(token.lemma) ?? []), ...(token.normal !== token.lemma ? byFirstWord.get(token.normal) ?? [] : [])];
        let best: { entry: FinderData['entries'][number]; end: number } | null = null;
        for (const entry of candidates) {
          const end = matchAt(entry.words, entry.gap, tokens, i);
          if (end > 0 && (!best || entry.words.length > best.entry.words.length)) best = { entry, end };
        }
        // "in order" followed by "to" is the basic "in order to": not a phrase to offer.
        if (best && isBasicPhrase(`${best.entry.text} ${tokens[best.end]?.normal ?? ''}`)) best = null;
        if (best) {
          for (let k = i; k < best.end; k++) covered.add(k);
          const words = best.entry.words;
          // "run in", "set to": a common verb before a plain preposition is usually not the phrasal verb.
          const verbPlusPreposition = best.entry.kind === 'phrasal_verb' && words.length === 2 && PURE_PREPOSITIONS.has(words[1]);
          const association = data.reference?.phrases.get(`${foldWord(words[0])} ${foldWord(words[1])}`)?.npmi ?? 0;
          const literalRisk = !verbPlusPreposition ? 0 : data.reference ? (association < REFERENCE_TUNING.phrasalVerb ? 1.5 : 0) : (zipfOf(words[0]) >= 5.3 ? 1.5 : 0);
          const folded = words.some(word => word === SLOT || word === POSSESSIVE) ? undefined : words.map(foldWord).join(' ');
          record(`x:${best.entry.text}`, best.entry.text, best.entry.kind, chapterIndex, text, quality, words.filter(word => word !== SLOT && word !== POSSESSIVE && !STOP.has(word)), literalRisk, folded);
        }
      });

      // 2. reference phrases not in the dictionary: longest strongly-associated 4..2-word stretch first
      if (data.reference) {
        const burstinessOf = (lemma: string) => data.reference?.words.get(foldWord(lemma))?.burstiness ?? 0;
        const folds = tokens.map(token => foldWord(token.normal));
        for (let i = 0; i < tokens.length; i++) {
          for (let n = 4; n >= 2; n--) {
            const window = tokens.slice(i, i + n);
            if (window.length < n || window.some((item, k) => covered.has(i + k) || !item.normal || item.proper)) continue;
            const last = window[n - 1].normal;
            // An article may start a phrase only when it ends in a linking word ("a large number of", "the fact that").
            const articleStartOk = n >= 3 && ['of', 'to', 'for', 'with', 'that'].includes(last);
            if (window.every(item => STOP.has(item.normal)) || (window[0].article && !articleStartOk) || ['and', 'or', 'but'].includes(window[0].normal)) continue;
            // fragments ("lot of" in "a lot of"), comparatives, numbers, basic phrases
            if (tokens[i - 1]?.article || NOT_A_PHRASE_START.has(window[0].normal) || window.some(item => /\d/.test(item.normal) || NUMBER_WORDS.has(item.normal))) continue;
            const surface = window.map(item => item.normal).join(' ');
            // basic phrases, the tail of one ("well as" in "as well as"), and "number of" cut out of "the number of"
            if (isBasicPhrase(surface) || (i > 0 && isBasicPhrase(`${tokens[i - 1].normal} ${surface}`))) continue;
            if (n === 2 && last === 'of' && window[0].noun) continue;
            // Purely nominal stretches are usually technical terms ("web server"); keep them only when every word is
            // general vocabulary that is spread across many topics ("side effect").
            if (window.every(item => (item.noun || item.adjective) && !STOP.has(item.normal)) && window.some(item => burstinessOf(item.lemma) > 1.4 || !burstinessOf(item.lemma))) continue;
            const folded = folds.slice(i, i + n).join(' ');
            const reference = data.reference.phrases.get(folded);
            // An article lowers association ("a large amount of" < "large amount of"): judge such phrases by their core.
            const core = window[0].article ? data.reference.phrases.get(folds.slice(i + 1, i + n).join(' ')) : undefined;
            if (!reference || Math.max(reference.npmi, core?.npmi ?? 0) < REFERENCE_TUNING.discover) continue;
            const kind: PhraseKind = window[0].preposition && window[n - 1].preposition ? 'prep_phrase' : 'collocation';
            for (let k = i; k < i + n; k++) covered.add(k);
            record(`r:${folded}`, surface, kind, chapterIndex, text, quality, window.filter(item => !STOP.has(item.normal)).map(item => item.lemma), 0, folded);
            break;
          }
        }
      }

      tokens.forEach((token, i) => {
        // 3. patterns (skipping words already inside a dictionary or reference phrase)
        if (covered.has(i)) return;
        const usable = (t: Token | undefined) => !!t && !covered.has(tokens.indexOf(t)) && !t.proper;
        const span = (from: number, to: number) => tokens.slice(from, to + 1).map(item => item.normal).join(' ');
        const pair = (j: number) => {
          const second = tokens[j];
          if (!second || covered.has(j) || second.proper || zipfOf(second.lemma) < 3) return;
          const key = `vn:${token.lemma} ${second.lemma}`;
          const entry = pairCounts.get(key) ?? pairCounts.set(key, { count: 0, first: token.lemma, second: second.lemma, chapters: new Set(), surfaces: new Map(), example: text, exampleScore: -Infinity }).get(key)!;
          const surface = [token.lemma, ...tokens.slice(i + 1, j + 1).map(item => item.normal)].join(' ');
          entry.count += 1; entry.chapters.add(chapterIndex); entry.surfaces.set(surface, (entry.surfaces.get(surface) ?? 0) + 1);
          if (quality > entry.exampleScore) { entry.example = text; entry.exampleScore = quality; }
        };
        const next = tokens[i + 1];

        // light verb (+ determiner/adjective) + noun (+ preposition): "take place", "take advantage of", "make a case for"
        if (token.verb && LIGHT_VERBS.has(token.lemma)) {
          let j = i + 1;
          while (tokens[j] && (tokens[j].article || tokens[j].adjective) && j - i <= 2) j++;
          const noun = tokens[j];
          // "make the app faster" is causative, not an expression: only bare nouns or a/an.
          const theBefore = tokens.slice(i + 1, j).some(item => item.normal === 'the');
          if (noun?.noun && usable(noun) && !theBefore && !noun.normal.endsWith('ing') && zipfOf(noun.lemma) >= 3.5 && zipfOf(noun.lemma) <= 5.8) {
            const end = tokens[j + 1]?.preposition && COMPLEX_PREP_END.has(tokens[j + 1].normal) ? j + 1 : j;
            const phrase = [token.lemma, ...tokens.slice(i + 1, end + 1).filter(item => item.article || item === noun || item.preposition).map(item => item.normal)].join(' ');
            record(`lv:${token.lemma} ${noun.lemma}`, phrase, 'collocation', chapterIndex, text, quality, [noun.lemma], 0, phrase.split(' ').map(foldWord).join(' '));
          }
        } else if (token.verb && !GENERAL_VERBS.has(token.lemma)) {
          // other verb + noun: needs repetition and statistical association (checked after the pass)
          let j = i + 1;
          while (tokens[j] && (tokens[j].determiner || tokens[j].adjective) && j - i <= 3) j++;
          if (tokens[j]?.noun) pair(j);
        }

        // adjective/participle + dependent preposition: "aware of", "resilient to", "optimized for"
        // Participles only with to/of/with: "processed by", "stored on" are just passive voice.
        const dependent = next?.preposition && DEPENDENT_PREPOSITIONS.has(next.normal) && (token.adjective || (token.participle && ['to', 'of', 'with'].includes(next.normal)));
        if (dependent && usable(next)) {
          const z = zipfOf(token.normal) || zipfOf(token.lemma);
          if (z >= 2.5 && z <= 4.9) record(`ap:${token.normal} ${next.normal}`, `${token.normal} ${next.normal}`, 'collocation', chapterIndex, text, quality, [token.normal], 0, `${foldWord(token.normal)} ${foldWord(next.normal)}`);
        }

        // -ly adverb + adjective/participle: "loosely coupled", "widely used", "clearly defined"
        if (INTENSIFIERS.has(token.normal) && (next?.adjective || next?.participle) && usable(next)) {
          const z = zipfOf(token.normal);
          if (z >= 2.5 && z <= 5) record(`ra:${token.normal} ${next.normal}`, `${token.normal} ${next.normal}`, 'collocation', chapterIndex, text, quality, [token.normal, next.lemma], 0, `${foldWord(token.normal)} ${foldWord(next.normal)}`);
        }

        // complex preposition: "in the context of", "for the sake of", "in response to", "on top of"
        if (token.preposition && COMPLEX_PREP_START.has(token.normal)) {
          let j = i + 1;
          if (tokens[j]?.article) j++;
          const noun = tokens[j], end = tokens[j + 1];
          if (noun?.noun && usable(noun) && end?.preposition && COMPLEX_PREP_END.has(end.normal) && zipfOf(noun.lemma) >= 3.3 && zipfOf(noun.lemma) <= 5.6) {
            record(`pp:${span(i, j + 1)}`, span(i, j + 1), 'prep_phrase', chapterIndex, text, quality, [noun.lemma], 0, span(i, j + 1).split(' ').map(foldWord).join(' '));
          }
        }

        // 4. linking words and advanced single words
        if (LINKERS.has(token.normal)) { record(`l:${token.normal}`, token.normal, 'frame', chapterIndex, text, quality, [token.normal]); return; }
        const zipf = zipfOf(token.lemma);
        // Gerunds ("processing", "handling") are verb forms, not vocabulary of their own.
        const wordLike = (token.verb || token.adjective || token.adverb || token.noun) && !(token.noun && token.normal.endsWith('ing'));
        if (wordLike && !token.proper && token.lemma.length >= 4 && zipf >= 2.8 && zipf <= 4.5 && !STOP.has(token.lemma)) {
          record(`w:${token.lemma}`, token.lemma, 'word', chapterIndex, text, quality, [token.lemma], token.noun && !token.verb && !token.adjective ? 0.4 : 0);
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

  // Topic terms: far more frequent in this book than in general English (zipf = log10 per billion words) and
  // repeated, e.g. "partition", "shard". They are the book's subject, not general vocabulary.
  const keyness = (lemma: string) => (lemmaCounts.get(lemma) ?? 0) / Math.max(1e-9, totalTokens * 10 ** (zipfOf(lemma) - 9));
  const isTopicTerm = (lemma: string) => (lemmaCounts.get(lemma) ?? 0) >= 3 && keyness(lemma) > 50;
  const isName = (lemma: string) => (capitalized.get(lemma) ?? 0) >= Math.max(1, 0.5 * (lemmaCounts.get(lemma) ?? 0));
  // Topic vocabulary clusters in a few Wikipedia articles ("cache"); general academic words spread across many
  // ("mitigate"). Speech vs writing does not separate them: both kinds are rare in speech.
  const topicality = (lemma: string) => {
    const word = data.reference?.words.get(foldWord(lemma));
    if (!word?.burstiness || zipfOf(lemma) >= 4.6) return 0;
    return Math.max(0, Math.min(1.2, (word.burstiness - REFERENCE_TUNING.burstiness) * 1.5));
  };
  // Very frequent in speech means a B1 learner already knows it ("talk about", "go back to").
  const isBasic = (folded: string | undefined) => (folded ? data.reference?.phrases.get(folded)?.spoken ?? 0 : 0) >= REFERENCE_TUNING.basicSpokenPerMillion;
  // Usefulness from how common the phrase is (speech counts double) and fixedness from how strongly its words
  // belong together; phrases the reference has never seen get neither.
  const referenceBonus = (folded: string | undefined) => {
    const reference = folded ? data.reference?.phrases.get(folded) : undefined;
    if (!reference) return 0;
    return Math.min(1, 0.4 * Math.log10(1 + 2 * reference.spoken + reference.written)) + Math.max(-0.3, Math.min(0.6, (reference.npmi - REFERENCE_TUNING.bonusCenter) * 1.5));
  };

  // A word that is part of a found expression ("tightly" in "tightly coupled") is not offered on its own.
  const inExpressions = new Set([...tallies.values()].filter(tally => tally.kind !== 'word').flatMap(tally => tally.contentWords));
  const results: FoundPhrase[] = [];
  for (const tally of tallies.values()) {
    if (tally.contentWords.some(isName) || isBasicPhrase(tally.phrase)) continue;
    if (tally.kind === 'word') {
      const zipf = zipfOf(tally.phrase);
      // Rarer words count even once; more common ones only when the book repeats them.
      if (inExpressions.has(tally.phrase) || isTopicTerm(tally.phrase) || (zipf > 3.8 && tally.count < 2)) continue;
    }
    if (tally.kind !== 'frame' && isBasic(tally.folded)) continue;
    const technicalPenalty = tally.kind === 'frame' ? 0 : Math.max(0, ...tally.contentWords.map(topicality)) * (tally.kind === 'word' ? 1 : 0.6);
    // Dictionary entries never seen in 50M words of reference English are usually matched literally ("tool around").
    const unattested = data.reference && tally.folded && ['phrasal_verb', 'idiom', 'prep_phrase'].includes(tally.kind) && !data.reference.phrases.has(tally.folded) ? REFERENCE_TUNING.unattested : 0;
    const topicPenalty = tally.kind !== 'frame' && tally.contentWords.some(isTopicTerm) ? 1.5 : 0;
    const minZipf = tally.contentWords.length ? Math.min(...tally.contentWords.map(zipfOf)) : 5;
    const band = minZipf >= 5 ? 0 : minZipf >= 4 ? 1 : minZipf >= 3 ? 2 : 3;
    const score = KIND_BASE[tally.kind] + 0.7 * Math.log2(1 + Math.min(tally.count, 15)) + (tally.chapters.size >= 2 ? 0.6 : 0) + (tally.chapters.size >= 4 ? 0.3 : 0)
      + BAND_BONUS[band] + Math.max(-1, Math.min(0.5, tally.exampleScore / 4)) - topicPenalty - technicalPenalty - unattested - (tally.penalty ?? 0)
      + referenceBonus(tally.kind === 'word' ? undefined : tally.folded);
    results.push({ phrase: tally.phrase, kind: tally.kind, band, score: Math.round(score * 100) / 100, count: tally.count, chapters: tally.chapters.size, example: tally.example });
  }
  // Keep the list mostly multi-word: single words are capped at 40%.
  let words = 0;
  return results.sort((a, b) => b.score - a.score).filter(result => result.kind !== 'word' || ++words <= limit * 0.4).slice(0, limit);
}
