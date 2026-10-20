// Measures the phrase finder against the hand-annotated chapters in eval/phrases.
// Usage: pnpm eval:phrases [--details] [--no-reference]
//   recall   = share of annotated good phrases the finder suggests (all results, and within the top 200 the app keeps)
//   precision@k = share of the top k suggestions that are good, among judged ones (good + pooledGood vs notGood)
// Chapters marked "blind" were annotated before the finder ever ran on them (held-out TEST set); suggestions
// judged afterwards go to pooledGood, which counts for precision but not for recall.
import nlp from 'compromise';
import { existsSync, readFileSync } from 'node:fs';
import { chunkChapter } from '../src/lib/book-parser.ts';
import { findPhrases, parseFinderData, type FoundPhrase } from '../src/lib/phrase-finder.ts';
import { parseReferenceData } from '../src/lib/reference-data.ts';

const details = process.argv.includes('--details');
const gold = JSON.parse(readFileSync('eval/phrases/gold.json', 'utf8')) as { chapters: Record<string, { good: string[]; notGood: string[]; pooledGood?: string[]; blind?: boolean }> };
const data = parseFinderData(JSON.parse(readFileSync('public/data/expressions.json', 'utf8')), readFileSync('public/data/word-freq.txt', 'utf8'));
if (!process.argv.includes('--no-reference') && existsSync('public/data/reference-ngrams.tsv')) {
  data.reference = parseReferenceData(readFileSync('public/data/reference-ngrams.tsv', 'utf8'), readFileSync('public/data/reference-words.tsv', 'utf8'));
}
console.log(data.reference ? `reference: ${data.reference.phrases.size} phrases, ${data.reference.words.size} words` : 'reference: off');

const IGNORED = new Set(['a', 'an', 'the', 'be', 'someone', 'something', "one's", 'oneself', 'its', 'their', 'his', 'her', 'it']);
const cache = new Map<string, string[]>();
// Lemma tokens without articles, "be" and slot words, so "be aware of" ~ "aware of" and "takes into account" ~ "take into account".
function key(phrase: string): string[] {
  if (cache.has(phrase)) return cache.get(phrase)!;
  const doc = nlp(phrase.replace(/-/g, ' '));
  doc.compute('root');
  const terms = (doc.json as (options: object) => Array<{ terms: Array<{ normal?: string; root?: string; text: string }> }>)({ terms: true }).flatMap(sentence => sentence.terms);
  const tokens = terms.map(term => (term.root ?? term.normal ?? term.text).toLowerCase().replace(/[^a-z']/g, '')).filter(token => token && !IGNORED.has(token));
  cache.set(phrase, tokens);
  return tokens;
}

// Same tokens, or (for 2+ tokens) one is an ordered subsequence of the other with gaps of at most 2 words.
function matches(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return false;
  if (a.join(' ') === b.join(' ')) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length < 2) return false;
  for (let start = 0; start < long.length; start++) {
    if (long[start] !== short[0]) continue;
    let i = start, k = 1, ok = true;
    while (k < short.length) {
      let found = -1;
      for (let j = i + 1; j <= Math.min(long.length - 1, i + 3); j++) if (long[j] === short[k]) { found = j; break; }
      if (found < 0) { ok = false; break; }
      i = found; k++;
    }
    if (ok) return true;
  }
  return false;
}

const anyMatch = (phrase: string, list: string[]) => list.some(entry => entry.split('|').some(form => matches(key(phrase), key(form))));
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');

type Totals = { gold: number; foundAll: number; found200: number; precision: Record<number, { good: number; judged: number }> };
const newTotals = (): Totals => ({ gold: 0, foundAll: 0, found200: 0, precision: { 50: { good: 0, judged: 0 }, 100: { good: 0, judged: 0 }, 200: { good: 0, judged: 0 } } });
const sets = { DEV: newTotals(), TEST: newTotals() };
const unjudged: string[] = [];

for (const [name, annotations] of Object.entries(gold.chapters)) {
  const text = readFileSync(`eval/phrases/${name}.txt`, 'utf8').split('\n').filter(line => !line.startsWith('#')).join('\n');
  const results: FoundPhrase[] = findPhrases([{ title: name, text: chunkChapter(text, 1_000_000).join('\n\n') }], data, undefined, 2000);
  const top200 = results.slice(0, 200);
  const covered = (list: FoundPhrase[]) => annotations.good.filter(entry => list.some(result => entry.split('|').some(form => matches(key(result.phrase), key(form)))));
  const all = covered(results), within = covered(top200);
  const totals = sets[annotations.blind ? 'TEST' : 'DEV'];
  totals.gold += annotations.good.length; totals.foundAll += all.length; totals.found200 += within.length;
  const judgedGood = [...annotations.good, ...(annotations.pooledGood ?? [])];

  const line = [`${name.padEnd(12)} recall ${pct(all.length, annotations.good.length)} (top 200: ${pct(within.length, annotations.good.length)}) of ${annotations.good.length}`];
  for (const k of [50, 100, 200]) {
    let good = 0, judged = 0;
    for (const result of results.slice(0, k)) {
      if (anyMatch(result.phrase, judgedGood)) { good++; judged++; }
      else if (anyMatch(result.phrase, annotations.notGood)) judged++;
      else if (k === 200) unjudged.push(`${name}\t${result.kind}\t${result.phrase}`);
    }
    totals.precision[k].good += good; totals.precision[k].judged += judged;
    line.push(`P@${k} ${pct(good, judged)}`);
  }
  console.log(line.join(' · '), `· ${results.length} suggestions${annotations.blind ? ' · held-out' : ''}`);
  if (details) console.log('  missed:', annotations.good.filter(entry => !all.includes(entry)).join(' · '));
}

console.log('');
for (const [label, totals] of Object.entries(sets)) {
  if (!totals.gold) continue;
  console.log(`${label.padEnd(12)} recall ${pct(totals.foundAll, totals.gold)} (top 200: ${pct(totals.found200, totals.gold)}) of ${totals.gold} · ${[50, 100, 200].map(k => `P@${k} ${pct(totals.precision[k].good, totals.precision[k].judged)}`).join(' · ')}`);
}
if (unjudged.length) console.log(`${unjudged.length} suggestions in the top 200 are not judged yet${details ? ':\n' + unjudged.join('\n') : ' (run with --details)'}`);
