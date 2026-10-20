// Runs the phrase finder off the main thread so the page stays responsive on large books.
import { findPhrases, parseFinderData, type FinderData } from './phrase-finder';

type Expressions = Parameters<typeof parseFinderData>[0];

let data: Promise<FinderData> | null = null;
const loadData = () => (data ??= Promise.all([
  fetch('/data/expressions.json').then(response => response.json() as Promise<Expressions>),
  fetch('/data/word-freq.txt').then(response => response.text()),
]).then(([expressions, frequencies]) => parseFinderData(expressions, frequencies)));

self.onmessage = async (event: MessageEvent<{ chapters: Array<{ title: string; text: string }> }>) => {
  try {
    const finderData = await loadData();
    const results = findPhrases(event.data.chapters, finderData, (done, total) => self.postMessage({ type: 'progress', done, total }));
    self.postMessage({ type: 'done', results });
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Phrase finder failed' });
  }
};
