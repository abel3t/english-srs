// Runs the phrase finder off the main thread so the page stays responsive on large books.
import { findPhrases, parseFinderData, type FinderData } from './phrase-finder';
import { parseReferenceData } from './reference-data';

type Expressions = Parameters<typeof parseFinderData>[0];

let data: Promise<FinderData> | null = null;
const text = (path: string) => fetch(path).then(response => {
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`);
  return response.text();
});
// ~2.6 MB compressed in total, fetched once when a book is first imported and then cached by the browser.
const loadData = () => (data ??= Promise.all([
  text('/data/expressions.json'), text('/data/word-freq.txt'), text('/data/reference-ngrams.tsv'), text('/data/reference-words.tsv'),
]).then(([expressions, frequencies, phrases, words]) => ({
  ...parseFinderData(JSON.parse(expressions) as Expressions, frequencies),
  reference: parseReferenceData(phrases, words),
})));

self.onmessage = async (event: MessageEvent<{ chapters: Array<{ title: string; text: string }> }>) => {
  try {
    const finderData = await loadData();
    const results = findPhrases(event.data.chapters, finderData, (done, total) => self.postMessage({ type: 'progress', done, total }));
    self.postMessage({ type: 'done', results });
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Phrase finder failed' });
  }
};
