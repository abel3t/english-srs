// Pure helpers for typing practice, shared by the browser and the server.

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

// Blank mode: every place in the text where one of the phrases occurs (inflected forms included), merged and sorted.
export function blankSpans(text: string, phrases: string[]): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  for (const phrase of phrases) {
    let offset = 0;
    while (offset < text.length) {
      const span = findPhraseSpan(text.slice(offset), phrase);
      if (!span || span.end === span.start) break;
      spans.push({ start: offset + span.start, end: offset + span.end });
      offset += span.end;
    }
  }
  spans.sort((a, b) => a.start - b.start);
  return spans.filter((span, index) => index === 0 || span.start >= spans[index - 1].end);
}
